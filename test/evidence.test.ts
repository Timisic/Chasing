import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ChasingConfig } from "../src/config.ts";
import { createInitialState, type EvidenceEvent } from "../src/domain.ts";
import { EvidenceRecorder } from "../src/evidence.ts";
import type { EvidenceSynchronizer } from "../src/langfuse.ts";

class ToggleSynchronizer implements EvidenceSynchronizer {
  readonly enabled = true;
  readonly synced: EvidenceEvent[] = [];
  failing = true;

  async sync(event: EvidenceEvent): Promise<void> {
    if (this.failing) throw new Error("Langfuse unavailable");
    this.synced.push(event);
  }
}

const config: ChasingConfig = {
  evidenceDirectory: ".chasing/sessions",
  maxMaterialBytes: 1_000_000,
  langfuse: { enabled: true, baseUrl: "http://localhost:3000", publicKey: "pk", secretKey: "sk" },
};

test("failed Langfuse events persist in an outbox and flush after recovery", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chasing-outbox-"));
  const synchronizer = new ToggleSynchronizer();
  const pi = { appendEntry() {} };
  const recorder = new EvidenceRecorder(cwd, config, pi, synchronizer);
  const state = createInitialState("outbox-session", new Date("2026-08-17T00:00:00.000Z"));

  await recorder.record(state, "session_started", { source: "test" });
  const outboxPath = join(cwd, ".chasing", "sessions", ".langfuse-outbox.jsonl");
  const queued = (await readFile(outboxPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(queued.length, 1);
  assert.equal(queued[0].sessionId, "outbox-session");

  synchronizer.failing = false;
  assert.equal(await recorder.flushOutbox(), 1);
  assert.equal(synchronizer.synced.length, 1);
  assert.equal(await readFile(outboxPath, "utf8"), "");
});

test("a historical local session can be replayed into Langfuse", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chasing-replay-"));
  const offline = new ToggleSynchronizer();
  const pi = { appendEntry() {} };
  const recorder = new EvidenceRecorder(cwd, config, pi, offline);
  const state = createInitialState("replay-session", new Date("2026-08-17T00:00:00.000Z"));
  await recorder.record(state, "session_started", {});
  await recorder.record(state, "mode_confirmed", { mode: "learn" });

  const online = new ToggleSynchronizer();
  online.failing = false;
  const replay = new EvidenceRecorder(cwd, config, pi, online);
  const result = await replay.replaySession("replay-session");
  assert.deepEqual(result, { synced: 2, queued: 0 });
  assert.deepEqual(online.synced.map(({ sequence }) => sequence), [1, 2]);
});

test("a hung synchronizer cannot block canonical local recording", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chasing-nonblocking-"));
  const synchronizer: EvidenceSynchronizer = {
    enabled: true,
    sync: async () => new Promise<void>(() => {}),
  };
  const recorder = new EvidenceRecorder(cwd, config, { appendEntry() {} }, synchronizer);
  const state = createInitialState("nonblocking-session", new Date("2026-08-17T00:00:00.000Z"));

  const verdict = await Promise.race([
    recorder.record(state, "session_started", {}).then(() => "recorded"),
    new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 50)),
  ]);
  assert.equal(verdict, "recorded");
  const canonical = await readFile(join(cwd, ".chasing", "sessions", "nonblocking-session.jsonl"), "utf8");
  assert.match(canonical, /session_started/);
  const outbox = await readFile(join(cwd, ".chasing", "sessions", ".langfuse-outbox.jsonl"), "utf8");
  assert.match(outbox, /session_started/);
});

test("a new event queued during an active flush is never overwritten", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "chasing-concurrent-outbox-"));
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const synced: number[] = [];
  const synchronizer: EvidenceSynchronizer = {
    enabled: true,
    async sync(event) {
      if (event.sequence === 1) await firstBlocked;
      synced.push(event.sequence);
    },
  };
  const recorder = new EvidenceRecorder(cwd, config, { appendEntry() {} }, synchronizer);
  const state = createInitialState("concurrent-session", new Date("2026-08-17T00:00:00.000Z"));

  await recorder.record(state, "question_prepared", {});
  await recorder.record(state, "assistant_turn_completed", {});
  releaseFirst?.();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await recorder.flushOutbox();

  assert.deepEqual(synced, [1, 2]);
  assert.equal(
    await readFile(join(cwd, ".chasing", "sessions", ".langfuse-outbox.jsonl"), "utf8"),
    "",
  );
});
