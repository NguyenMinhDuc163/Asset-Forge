import type { AppSettings } from "@/lib/storage/settings";
import type { CharacterGenerationMode } from "./types";

export interface CreationModeInput {
  settings: AppSettings;
  hasAiAccess: boolean;
  hasReference: boolean;
  hasPrompt?: boolean;
}

export function resolveCreationMode(input: CreationModeInput): CharacterGenerationMode {
  if (input.settings.provider === "manual") return input.hasReference ? "reference-static" : "template-random";
  if (input.settings.creationMode === "ai") return "ai";
  if (input.settings.creationMode === "template") return input.hasReference ? "reference-static" : "template-random";
  if (input.hasAiAccess && (input.hasReference || input.hasPrompt)) return "ai";
  return input.hasReference ? "reference-static" : "template-random";
}
