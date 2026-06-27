import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliConfig } from "./types.js";

const CONFIG_FILE = "config.json";

export async function readConfig(dir = defaultConfigDir()): Promise<CliConfig | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, CONFIG_FILE), "utf8"));
    return isConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeConfig(config: CliConfig, dir = defaultConfigDir()): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + "\n");
}

export async function clearConfig(dir = defaultConfigDir()): Promise<void> {
  await rm(join(dir, CONFIG_FILE), { force: true });
}

export function defaultConfigDir(): string {
  return join(homedir(), ".config", "cdp-us");
}

function isConfig(value: unknown): value is CliConfig {
  if (!isRecord(value)) return false;
  return (
    typeof value.endpoint === "string" &&
    typeof value.tenantId === "string" &&
    typeof value.token === "string" &&
    (value.writeKey === undefined || typeof value.writeKey === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
