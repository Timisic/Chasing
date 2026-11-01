import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_VERSION = "chasing-config-v1";

export interface ChasingConfig {
  evidenceDirectory: string;
  maxMaterialBytes: number;
  langfuse: {
    enabled: boolean;
    baseUrl: string;
    publicKey?: string;
    secretKey?: string;
  };
}

const DEFAULT_CONFIG: ChasingConfig = {
  evidenceDirectory: ".chasing/sessions",
  maxMaterialBytes: 1_000_000,
  langfuse: {
    enabled: false,
    baseUrl: "https://cloud.langfuse.com",
  },
};

type RawConfig = Omit<Partial<ChasingConfig>, "langfuse"> & {
  langfuse?: Partial<ChasingConfig["langfuse"]>;
};

async function readConfig(path: string): Promise<RawConfig> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as RawConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function loadConfig(cwd: string): Promise<ChasingConfig> {
  const globalPath = process.env.CHASING_CONFIG_PATH ?? join(homedir(), ".config", "chasing", "config.json");
  const globalConfig = await readConfig(globalPath);
  const projectConfig = await readConfig(join(cwd, ".chasing", "config.json"));
  const raw: RawConfig = {
    ...globalConfig,
    ...projectConfig,
    langfuse: {
      ...globalConfig.langfuse,
      ...projectConfig.langfuse,
    },
  };

  const langfuseEnabled = raw.langfuse?.enabled === true;
  const publicKey = raw.langfuse?.publicKey ?? process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = raw.langfuse?.secretKey ?? process.env.LANGFUSE_SECRET_KEY;
  return {
    evidenceDirectory: raw.evidenceDirectory ?? DEFAULT_CONFIG.evidenceDirectory,
    maxMaterialBytes: raw.maxMaterialBytes ?? DEFAULT_CONFIG.maxMaterialBytes,
    langfuse: {
      enabled: langfuseEnabled,
      baseUrl: raw.langfuse?.baseUrl ?? process.env.LANGFUSE_BASE_URL ?? DEFAULT_CONFIG.langfuse.baseUrl,
      ...(langfuseEnabled && publicKey ? { publicKey } : {}),
      ...(langfuseEnabled && secretKey ? { secretKey } : {}),
    },
  };
}
