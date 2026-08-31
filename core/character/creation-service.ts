import type { AppSettings } from "@/lib/storage/settings";
import { getNineRouterKey, getOpenAIKey, hasCodexOAuth } from "@/lib/storage/settings";
import { normalizeImage } from "@/core/image/normalize";
import { createDesignMasterCharacter, createPoseSheetCharacter, createTemplateCharacter, isHumanoidCompatible } from "@/core/character-template/engine";
import { generateVisual } from "@/core/providers/generate";
import type { GeneratedVisual } from "@/core/providers/types";
import type { CharacterAsset, CharacterGenerationMode } from "./types";
import { resolveCreationMode } from "./mode-resolver";
import { createHash } from "node:crypto";

export interface CharacterCreationInput {
  name: string;
  prompt: string;
  referenceImage?: Buffer;
  referenceMimeType?: string;
  settings: AppSettings;
  generationRecipe: string;
}

export interface CharacterCreationResult {
  mode: CharacterGenerationMode;
  visual: GeneratedVisual;
  normalized: Awaited<ReturnType<typeof normalizeImage>>;
  asset: CharacterAsset;
  poseSheet?: GeneratedVisual;
}

export function createCharacterRequestHash(input: Pick<CharacterCreationInput, "prompt" | "referenceImage" | "settings" | "generationRecipe"> & { aiAccess?: boolean }) {
  const hash = createHash("sha256");
  hash.update("character-pipeline-v2.1-design-master-pose-sheet\0");
  hash.update(input.settings.provider);
  hash.update("\0");
  hash.update(input.settings.imageModel);
  hash.update("\0");
  hash.update(input.settings.creationMode);
  hash.update("\0");
  hash.update(input.aiAccess ? "ai-access" : "template-access");
  hash.update("\0");
  hash.update(input.generationRecipe);
  hash.update("\0");
  hash.update(input.prompt.trim().toLowerCase());
  hash.update("\0");
  if (input.referenceImage?.length) hash.update(input.referenceImage);
  return hash.digest("hex");
}

export async function hasCharacterAiAccess(settings: AppSettings) {
  if (settings.provider === "openai") {
    return settings.openaiAuthMode === "codex-oauth" ? await hasCodexOAuth() : Boolean(await getOpenAIKey());
  }
  if (settings.provider === "nine-router") return Boolean(await getNineRouterKey()) || Boolean(settings.nineRouterUrl);
  return false;
}

export async function createCharacter(input: CharacterCreationInput): Promise<CharacterCreationResult> {
  const mode = resolveCreationMode({ settings: input.settings, hasAiAccess: await hasCharacterAiAccess(input.settings), hasReference: Boolean(input.referenceImage?.length), hasPrompt: Boolean(input.prompt.trim()) });
  if (mode === "template-random" || mode === "template-reference") {
    const normalizedReference = input.referenceImage?.length
      ? await normalizeImage(input.referenceImage, { width: 192, height: 192, pixelArt: true, paletteColours: 128, removeSolidBackground: true })
      : undefined;
    if (mode === "template-reference" && normalizedReference && !await isHumanoidCompatible(normalizedReference.buffer)) {
      throw new Error("Ảnh tham chiếu không phù hợp với template Humanoid. Hãy dùng ảnh nhân vật đứng rõ chủ thể.");
    }
    const template = await createTemplateCharacter({
      name: input.name,
      mode,
      reference: normalizedReference?.buffer,
      prompt: input.prompt,
    });
    const visual: GeneratedVisual = input.referenceImage?.length
      ? { buffer: input.referenceImage, mimeType: input.referenceMimeType || "image/png", provider: "manual" }
      : { buffer: template.asset.previewFrames[0].buffer, mimeType: "image/png", provider: "manual" };
    const normalized = normalizedReference || { buffer: visual.buffer, width: 64, height: 128, format: "png" as const, hasAlpha: true, sourceWidth: 64, sourceHeight: 128 };
    return { mode, visual, normalized, asset: template.asset };
  }

  const visual = await generateVisual(input.settings.provider, {
    settings: input.settings,
    kind: "character",
    prompt: input.prompt,
    referenceImage: input.referenceImage,
    referenceMimeType: input.referenceMimeType,
    generationRecipe: input.generationRecipe,
  });
  const normalized = await normalizeImage(visual.buffer, { width: 192, height: 192, pixelArt: true, paletteColours: 128, removeSolidBackground: true });
  if (!await isHumanoidCompatible(normalized.buffer)) {
    throw new Error("Ảnh nguồn AI không tạo ra silhouette humanoid phù hợp với template game.");
  }
  let poseSheet: GeneratedVisual | undefined;
  try {
    poseSheet = await generateVisual(input.settings.provider, {
      settings: input.settings,
      kind: "character",
      prompt: input.prompt,
      referenceImage: normalized.buffer,
      referenceMimeType: "image/png",
      generationRecipe: [
        "Create a 4 by 3 transparent pose sheet of the exact same character from the reference design master.",
        "Use this exact cell order left-to-right, top-to-bottom: idle-0, idle-1, run-0, run-1, run-2, jump, fall, hurt, attack-0, attack-1, attack-2, fly.",
        "Keep the same hairstyle, face, clothing, colors, proportions and readable pixel-art silhouette in every cell. No labels, borders, scenery or extra characters.",
      ].join(" "),
    });
    const generated = await createPoseSheetCharacter({ name: input.name, poseSheet: poseSheet.buffer, prompt: input.prompt });
    return { mode, visual, normalized, asset: generated.asset, poseSheet };
  } catch (error) {
    console.warn("AI pose sheet was not usable; using deterministic template transfer", error instanceof Error ? error.message : error);
    const template = await createDesignMasterCharacter({ name: input.name, designMaster: normalized.buffer, prompt: input.prompt });
    return { mode, visual, normalized, asset: template.asset };
  }
}
