import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.ts";

test("global Langfuse config applies regardless of Pi startup directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "chasing-config-"));
  const globalConfigPath = join(root, "global", "config.json");
  const unrelatedCwd = join(root, "random-project");
  await mkdir(join(root, "global"), { recursive: true });
  await mkdir(unrelatedCwd, { recursive: true });
  await writeFile(
    globalConfigPath,
    JSON.stringify({
      langfuse: {
        enabled: true,
        baseUrl: "http://localhost:3000",
        publicKey: "lf_pk_test",
        secretKey: "lf_sk_test",
      },
    }),
    "utf8",
  );

  const previousPath = process.env.CHASING_CONFIG_PATH;
  process.env.CHASING_CONFIG_PATH = globalConfigPath;
  try {
    const config = await loadConfig(unrelatedCwd);
    assert.deepEqual(config.langfuse, {
      enabled: true,
      baseUrl: "http://localhost:3000",
      publicKey: "lf_pk_test",
      secretKey: "lf_sk_test",
    });
  } finally {
    if (previousPath === undefined) delete process.env.CHASING_CONFIG_PATH;
    else process.env.CHASING_CONFIG_PATH = previousPath;
  }
});

test("project config overrides only its declared global settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "chasing-config-"));
  const globalConfigPath = join(root, "global.json");
  const cwd = join(root, "project");
  await mkdir(join(cwd, ".chasing"), { recursive: true });
  await writeFile(
    globalConfigPath,
    JSON.stringify({
      evidenceDirectory: ".global-evidence",
      langfuse: { enabled: true, baseUrl: "http://localhost:3000", publicKey: "global-pk", secretKey: "global-sk" },
    }),
    "utf8",
  );
  await writeFile(
    join(cwd, ".chasing", "config.json"),
    JSON.stringify({ langfuse: { enabled: false } }),
    "utf8",
  );

  const previousPath = process.env.CHASING_CONFIG_PATH;
  process.env.CHASING_CONFIG_PATH = globalConfigPath;
  try {
    const config = await loadConfig(cwd);
    assert.equal(config.evidenceDirectory, ".global-evidence");
    assert.equal(config.langfuse.enabled, false);
    assert.equal(config.langfuse.baseUrl, "http://localhost:3000");
    assert.equal(config.langfuse.publicKey, undefined);
    assert.equal(config.langfuse.secretKey, undefined);
  } finally {
    if (previousPath === undefined) delete process.env.CHASING_CONFIG_PATH;
    else process.env.CHASING_CONFIG_PATH = previousPath;
  }
});
