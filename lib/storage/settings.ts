import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Locale } from "@/lib/i18n";

export type ProviderId = "openai" | "nine-router" | "manual";
export type ThemePreference = "light" | "dark" | "system";
export type OpenAIAuthMode = "api-key" | "codex-oauth";
export type ExportMode = "download" | "browser-folder";

export interface AppSettings {
  provider: ProviderId;
  imageModel: string;
  openaiAuthMode: OpenAIAuthMode;
  nineRouterUrl: string;
  projectRoot: string;
  adapterId: string;
  locale: Locale;
  theme: ThemePreference;
  exportMode: ExportMode;
}

export interface CodexOAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresAt: number;
  accountId?: string;
  email?: string;
}

interface AppSecrets { openaiApiKey?: string; nineRouterApiKey?: string; codexOAuth?: CodexOAuthTokens }

const defaults: AppSettings = { provider: "openai", imageModel: "auto", openaiAuthMode: "api-key", nineRouterUrl: "http://localhost:20128", projectRoot: process.env.CONTENTFORGE_EXPORT_ROOT || join(homedir(), "ContentForge", "exports"), adapterId: "nro-legacy-v1", locale: "vi", theme: "system", exportMode: "download" };

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

export async function getSettings(): Promise<AppSettings> {
  const settings = await readJson(settingsPath(), defaults);
  return { ...settings, projectRoot: settings.projectRoot?.trim() || defaults.projectRoot };
}
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
export async function hasNineRouterKey(): Promise<boolean> { return Boolean((await readJson<AppSecrets>(secretsPath(), {})).nineRouterApiKey); }
export async function getNineRouterKey(): Promise<string | undefined> { return (await readJson<AppSecrets>(secretsPath(), {})).nineRouterApiKey; }
export async function saveNineRouterKey(apiKey: string): Promise<void> {
  const secrets = await readJson<AppSecrets>(secretsPath(), {});
  await atomicWriteJson(secretsPath(), { ...secrets, nineRouterApiKey: apiKey.trim() }, 0o600);
}
export async function getCodexOAuthTokens(): Promise<CodexOAuthTokens | undefined> { return (await readJson<AppSecrets>(secretsPath(), {})).codexOAuth; }
export async function hasCodexOAuth(): Promise<boolean> { return Boolean((await getCodexOAuthTokens())?.refreshToken); }
export async function saveCodexOAuthTokens(tokens: CodexOAuthTokens): Promise<void> {
  const secrets = await readJson<AppSecrets>(secretsPath(), {});
  await atomicWriteJson(secretsPath(), { ...secrets, codexOAuth: tokens }, 0o600);
}
export async function clearCodexOAuthTokens(): Promise<void> {
  const secrets = await readJson<AppSecrets>(secretsPath(), {});
  const { codexOAuth: _removed, ...remaining } = secrets;
  void _removed;
  await atomicWriteJson(secretsPath(), remaining, 0o600);
}
