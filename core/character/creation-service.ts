import type { AppSettings } from "@/lib/storage/settings";
import { getNineRouterKey, getOpenAIKey, hasCodexOAuth } from "@/lib/storage/settings";
import { normalizeImage } from "@/core/image/normalize";
import { createTemplateCharacter, isHumanoidCompatible } from "@/core/character-template/engine";
import { createReferenceStaticCharacter, processReferenceCharacter } from "./reference-first";
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
  splitLines?: { neck: number; hip: number };
}

export interface CharacterCreationResult {
  mode: CharacterGenerationMode;
  visual: GeneratedVisual;
  normalized: Awaited<ReturnType<typeof normalizeImage>>;
  asset: CharacterAsset;
  poseSheet?: GeneratedVisual;
}

export function createCharacterRequestHash(input: Pick<CharacterCreationInput, "prompt" | "referenceImage" | "settings" | "generationRecipe" | "splitLines"> & { aiAccess?: boolean }) {
  const hash = createHash("sha256");
  hash.update("character-pipeline-v2.2-joint-split-static\0");
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
  if (input.splitLines) hash.update(`${input.splitLines.neck.toFixed(4)}|${input.splitLines.hip.toFixed(4)}\0`);
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
  if (input.settings.provider === "manual" && !input.referenceImage?.length) {
    throw new Error("Hãy thêm ảnh nguồn để xử lý nhân vật Không AI.");
  }
  if (mode === "reference-static") {
    if (!input.referenceImage?.length) throw new Error("Hãy thêm ảnh nguồn để xử lý nhân vật Không AI.");
    const processed = await processReferenceCharacter(input.referenceImage);
    if (!await isHumanoidCompatible(processed.normalized.buffer)) {
      throw new Error("Ảnh nguồn cần hiển thị đầy đủ một nhân vật đứng, rõ đầu, thân và chân.");
    }
    const reference = await createReferenceStaticCharacter({
      name: input.name,
      processed: processed.normalized.buffer,
      backgroundRemoved: processed.backgroundRemoved,
      sourceComplete: processed.sourceComplete,
      splitLines: input.splitLines,
    });
    return {
      mode: "reference-static",
      visual: { buffer: input.referenceImage, mimeType: input.referenceMimeType || "image/png", provider: "manual" },
      normalized: processed.normalized,
      asset: reference.asset,
    };
  }
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
  const processed = await processReferenceCharacter(visual.buffer);
  if (!await isHumanoidCompatible(processed.normalized.buffer)) {
    throw new Error("Ảnh nguồn AI không tạo ra silhouette humanoid đầy đủ đầu, thân và chân.");
  }
  const generated = await createReferenceStaticCharacter({
    name: input.name,
    processed: processed.normalized.buffer,
    backgroundRemoved: processed.backgroundRemoved,
    sourceComplete: processed.sourceComplete,
    generationMode: "ai",
    designMaster: "ai",
    splitLines: input.splitLines,
  });
  return { mode, visual, normalized: processed.normalized, asset: generated.asset };
}
