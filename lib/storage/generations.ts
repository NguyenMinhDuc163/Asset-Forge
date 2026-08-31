import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AssetKind, NormalizedAsset } from "@/core/assets/types";
import type { AdapterOutput, ValidationResult } from "@/core/adapters/types";
import type { GeneratedVisual } from "@/core/providers/types";
import type { ProviderId } from "@/core/providers/catalog";
import type { CharacterAsset, CharacterGenerationMode } from "@/core/character/types";
import { safeJoin } from "@/lib/fs/safe-path";

export interface GenerationRecord {
  version: 1;
  id: string;
  name: string;
  kind: AssetKind;
  createdAt: string;
  requestHash?: string;
  status: ValidationResult["status"];
  template?: string;
  generation?: { mode: "ai" | "template" | "generic"; detail?: CharacterGenerationMode };
  animations?: string[];
  character?: {
    templateId: string;
    generationMode: CharacterGenerationMode;
    pipeline?: CharacterAsset["pipeline"];
    poses: Array<{ id: string; state: string; headFrame: string; bodyFrame: string; legFrame: string; headOffset: { x: number; y: number }; bodyOffset: { x: number; y: number }; legOffset: { x: number; y: number } }>;
  };
  source: { provider: ProviderId; model?: string; file: string };
  visual: { width: number; height: number; format: "png"; file: string };
  preview: { width: number; height: number; mimeType: "image/png"; file: string };
  previewFrames?: Array<{ poseId: string; state: string; width: number; height: number; mimeType: "image/png"; file: string }>;
  intermediate?: { poseSheet?: { width: number; height: number; mimeType: string; file: string } };
  adapter: { id: string; metadata: Record<string, unknown> };
  validation: ValidationResult;
  files: Array<{ path: string; mimeType: string }>;
}

function cacheRoot() {
  return join(process.env.CONTENTFORGE_HOME || join(homedir(), ".contentforge"), "cache");
}

export async function saveGeneration(input: {
  name: string;
  kind: AssetKind;
  source: GeneratedVisual;
  normalized: NormalizedAsset;
  output: AdapterOutput;
  validation: ValidationResult;
  characterAsset?: CharacterAsset;
  creationMode?: CharacterGenerationMode;
  requestHash?: string;
  intermediate?: { poseSheet?: GeneratedVisual };
}): Promise<GenerationRecord> {
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const root = safeJoin(cacheRoot(), id);
  await mkdir(root, { recursive: true });

  const sourceExtension = input.source.mimeType === "image/jpeg" ? "jpg" : input.source.mimeType === "image/webp" ? "webp" : "png";
  const sourcePath = `source.${sourceExtension}`;
  await writeFile(safeJoin(root, sourcePath), input.source.buffer);
  await writeFile(safeJoin(root, "processed.png"), input.normalized.buffer);
  await writeFile(safeJoin(root, "preview.png"), input.output.preview.buffer);
  const previewFrames = input.output.previewFrames?.map((frame) => ({
    poseId: frame.poseId,
    state: frame.state,
    width: frame.width,
    height: frame.height,
    mimeType: "image/png" as const,
    file: `preview/${frame.poseId}.png`,
  }));
  for (const [index, frame] of (input.output.previewFrames || []).entries()) {
    const recordFrame = previewFrames?.[index];
    if (recordFrame) {
      await mkdir(dirname(safeJoin(root, recordFrame.file)), { recursive: true });
      await writeFile(safeJoin(root, recordFrame.file), frame.buffer);
    }
  }
  const poseSheet = input.intermediate?.poseSheet;
  if (poseSheet) {
    await mkdir(dirname(safeJoin(root, "intermediate/pose-sheet.png")), { recursive: true });
    await writeFile(safeJoin(root, "intermediate/pose-sheet.png"), poseSheet.buffer);
  }
  for (const file of input.output.files) {
    const destination = safeJoin(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.buffer);
  }

  const record: GenerationRecord = {
    version: 1,
    id,
    name: input.name,
    kind: input.kind,
    createdAt: new Date().toISOString(),
    ...(input.requestHash ? { requestHash: input.requestHash } : {}),
    status: input.validation.status,
    ...(input.characterAsset ? {
      template: input.characterAsset.templateId,
      generation: { mode: input.characterAsset.generationMode === "ai" ? "ai" : "template", detail: input.characterAsset.generationMode },
      animations: [...new Set(input.characterAsset.poses.map((pose) => pose.state))],
      character: {
        templateId: input.characterAsset.templateId,
        generationMode: input.characterAsset.generationMode,
        pipeline: input.characterAsset.pipeline,
        poses: input.characterAsset.poses,
      },
    } : { generation: { mode: "generic" } }),
    source: { provider: input.source.provider, model: input.source.model, file: sourcePath },
    visual: { width: input.normalized.width, height: input.normalized.height, format: "png", file: "processed.png" },
    preview: { width: input.output.preview.width, height: input.output.preview.height, mimeType: "image/png", file: "preview.png" },
    ...(previewFrames?.length ? { previewFrames } : {}),
    ...(poseSheet ? { intermediate: { poseSheet: { width: 1024, height: 1024, mimeType: poseSheet.mimeType, file: "intermediate/pose-sheet.png" } } } : {}),
    adapter: { id: input.output.adapterId, metadata: input.output.metadata },
    validation: input.validation,
    files: input.output.files.map(({ path, mimeType }) => ({ path, mimeType })),
  };
  await writeFile(safeJoin(root, "generation.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

/** Find a completed generation without touching provider APIs. */
export async function findCachedGeneration(requestHash: string): Promise<{ root: string; record: GenerationRecord } | undefined> {
  let entries;
  try {
    entries = await readdir(cacheRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9-]+$/.test(entry.name)) continue;
    try {
      const root = safeJoin(cacheRoot(), entry.name);
      const record = JSON.parse(await readFile(safeJoin(root, "generation.json"), "utf8")) as GenerationRecord;
      if (record.requestHash === requestHash) return { root, record };
    } catch {
      // Ignore an incomplete cache entry; the next create can finish it.
    }
  }
  return undefined;
}

export async function getGeneration(id: string): Promise<{ root: string; record: GenerationRecord }> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Mã kết quả không hợp lệ.");
  const root = safeJoin(cacheRoot(), id);
  const record = JSON.parse(await readFile(safeJoin(root, "generation.json"), "utf8")) as GenerationRecord;
  return { root, record };
}
