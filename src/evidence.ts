import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import type { ChasingConfig } from "./config.ts";
import type { ChasingState, EvidenceEvent } from "./domain.ts";
import type { EvidenceSynchronizer } from "./langfuse.ts";

export interface PiEvidenceAPI {
  appendEntry<T>(customType: string, data: T): void;
}

export class EvidenceRecorder {
  readonly syncErrors: Error[] = [];
  private readonly cwd: string;
  private readonly config: ChasingConfig;
  private readonly pi: PiEvidenceAPI;
  private readonly synchronizer: EvidenceSynchronizer;
  private readonly now: () => Date;
  private activeFlush: Promise<number> | undefined;
  private fileOperation: Promise<void> = Promise.resolve();
  private recordChain: Promise<unknown> = Promise.resolve();

  private evidenceDirectory(): string {
    return isAbsolute(this.config.evidenceDirectory)
      ? this.config.evidenceDirectory
      : join(this.cwd, this.config.evidenceDirectory);
  }

  private outboxPath(): string {
    return join(this.evidenceDirectory(), ".langfuse-outbox.jsonl");
  }

  constructor(
    cwd: string,
    config: ChasingConfig,
    pi: PiEvidenceAPI,
    synchronizer: EvidenceSynchronizer,
    now: () => Date = () => new Date(),
  ) {
    this.cwd = cwd;
    this.config = config;
    this.pi = pi;
    this.synchronizer = synchronizer;
    this.now = now;
  }

  private async readEvents(path: string): Promise<EvidenceEvent[]> {
    try {
      const content = await readFile(path, "utf8");
      return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as EvidenceEvent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeOutbox(events: EvidenceEvent[]): Promise<void> {
    const directory = this.evidenceDirectory();
    await mkdir(directory, { recursive: true });
    const target = this.outboxPath();
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : ""), "utf8");
    await rename(temporary, target);
  }

  private async withOutboxLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.fileOperation;
    let release = () => {};
    this.fileOperation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private eventKey(event: EvidenceEvent): string {
    return `${event.sessionId}:${event.sequence}`;
  }

  private async queue(event: EvidenceEvent): Promise<void> {
    await this.withOutboxLock(async () => {
      const directory = this.evidenceDirectory();
      await mkdir(directory, { recursive: true });
      await appendFile(this.outboxPath(), `${JSON.stringify(event)}\n`, "utf8");
    });
  }

  private async performFlush(): Promise<number> {
    if (!this.synchronizer.enabled) return 0;
    const events = await this.withOutboxLock(() => this.readEvents(this.outboxPath()));
    let synced = 0;
    const syncedKeys = new Set<string>();
    for (const event of events) {
      try {
        await this.synchronizer.sync(event);
        synced += 1;
        syncedKeys.add(this.eventKey(event));
      } catch (error) {
        this.syncErrors.push(error instanceof Error ? error : new Error(String(error)));
        break;
      }
    }
    if (syncedKeys.size > 0) {
      await this.withOutboxLock(async () => {
        const current = await this.readEvents(this.outboxPath());
        await this.writeOutbox(current.filter((event) => !syncedKeys.has(this.eventKey(event))));
      });
    }
    return synced;
  }

  async flushOutbox(): Promise<number> {
    if (this.activeFlush) {
      const firstPass = await this.activeFlush;
      return firstPass + await this.flushOutbox();
    }
    const flush = this.performFlush().finally(() => {
      if (this.activeFlush === flush) this.activeFlush = undefined;
    });
    this.activeFlush = flush;
    return flush;
  }

  async replaySession(sessionId: string): Promise<{ synced: number; queued: number }> {
    if (!this.synchronizer.enabled) return { synced: 0, queued: 0 };
    const events = await this.readEvents(join(this.evidenceDirectory(), `${sessionId}.jsonl`));
    let synced = 0;
    let queued = 0;
    for (const event of events) {
      try {
        await this.synchronizer.sync(event);
        synced += 1;
      } catch (error) {
        this.syncErrors.push(error instanceof Error ? error : new Error(String(error)));
        await this.queue(event);
        queued += 1;
      }
    }
    if (queued === 0) {
      await this.withOutboxLock(async () => {
        const pending = await this.readEvents(this.outboxPath());
        await this.writeOutbox(pending.filter((event) => event.sessionId !== sessionId));
      });
    }
    return { synced, queued };
  }

  // Parallel tool calls record concurrently; chaining keeps the JSONL in sequence order.
  record(state: ChasingState, type: string, data: Record<string, unknown>): Promise<EvidenceEvent> {
    const recorded = this.recordChain.then(() => this.append(state, type, data));
    this.recordChain = recorded.catch(() => {});
    return recorded;
  }

  private async append(state: ChasingState, type: string, data: Record<string, unknown>): Promise<EvidenceEvent> {
    state.sequence += 1;
    const event: EvidenceEvent = {
      schemaVersion: state.versions.evidence,
      sessionId: state.sessionId,
      sequence: state.sequence,
      timestamp: this.now().toISOString(),
      type,
      phase: state.phase,
      evaluationEligible: state.evaluationEligible,
      ...(state.mode ? { mode: state.mode } : {}),
      ...(state.mission ? { mission: state.mission } : {}),
      ...(state.model ? { model: state.model } : {}),
      versions: state.versions,
      data,
    };
    const directory = this.evidenceDirectory();
    await mkdir(directory, { recursive: true });
    await appendFile(join(directory, `${state.sessionId}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");

    this.pi.appendEntry("chasing:event", event);
    this.pi.appendEntry("chasing:state", structuredClone(state));
    if (this.synchronizer.enabled) {
      await this.queue(event);
      void this.flushOutbox();
    }
    return event;
  }
}
