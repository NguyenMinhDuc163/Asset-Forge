import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type ProviderId = "openai" | "manual";

export interface AppSettings {
  provider: ProviderId;
  imageModel: string;
  projectRoot: string;
  adapterId: string;
}

interface AppSecrets { openaiApiKey?: string }

const defaults: AppSettings = { provider: "openai", imageModel: "auto", projectRoot: "", adapterId: "nro-legacy-v1" };

function configRoot() { return process.env.CONTENTFORGE_HOME || join(homedir(), ".contentforge"); }
function settingsPath() { return join(configRoot(), "settings.json"); }
function secretsPath() { return join(configRoot(), "secrets.json"); }

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return { ...fallback, ...JSON.parse(await readFile(path, "utf8")) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    console.error(`Could not read ContentForge configuration at ${path}`, error);
    return fallback;
  }
}

async function atomicWriteJson(path: string, value: unknown, mode?: number) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  await rename(temporaryPath, path);
  if (mode) await chmod(path, mode);
}

export async function getSettings(): Promise<AppSettings> { return readJson(settingsPath(), defaults); }
export async function saveSettings(update: Partial<AppSettings>): Promise<AppSettings> {
  const settings = { ...(await getSettings()), ...update };
  await atomicWriteJson(settingsPath(), settings);
  return settings;
}
export async function hasOpenAIKey(): Promise<boolean> { return Boolean((await readJson<AppSecrets>(secretsPath(), {})).openaiApiKey); }
export async function getOpenAIKey(): Promise<string | undefined> { return (await readJson<AppSecrets>(secretsPath(), {})).openaiApiKey; }
export async function saveOpenAIKey(apiKey: string): Promise<void> {
  const secrets = await readJson<AppSecrets>(secretsPath(), {});
  await atomicWriteJson(secretsPath(), { ...secrets, openaiApiKey: apiKey.trim() }, 0o600);
}
