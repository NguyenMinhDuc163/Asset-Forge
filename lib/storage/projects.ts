import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { saveSettings } from "./settings";

export interface ProjectProfile {
  id: string;
  name: string;
  rootPath: string;
  adapterId: string;
  outputPath: string;
  defaults: { assetKind: "character" | "environment" | "item" | "effect" };
}

export function createProjectProfile(rootPath: string, adapterId: string): ProjectProfile {
  const absoluteRoot = isAbsolute(rootPath) ? resolve(rootPath) : resolve(process.cwd(), rootPath || ".");
  const name = absoluteRoot.split(/[\\/]/).filter(Boolean).at(-1) || "game-project";
  return { id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "game-project", name, rootPath: absoluteRoot, adapterId, outputPath: join(absoluteRoot, "generated-assets"), defaults: { assetKind: "character" } };
}

export async function ensureProjectProfile(rootPath: string, adapterId: string): Promise<ProjectProfile> {
  const profile = createProjectProfile(rootPath, adapterId);
  const configDir = join(profile.rootPath, ".contentforge");
  await mkdir(configDir, { recursive: true });
  const profilePath = join(configDir, "project.json");
  try {
    const existing = JSON.parse(await readFile(profilePath, "utf8")) as ProjectProfile;
    if (existing.adapterId === adapterId) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not read project profile", error);
  }
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await saveSettings({ projectRoot: profile.rootPath, adapterId: profile.adapterId });
  return profile;
}
