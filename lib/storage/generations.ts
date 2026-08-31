import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AssetKind, NormalizedAsset } from "@/core/assets/types";
import type { AdapterOutput, ValidationResult } from "@/core/adapters/types";
import type { GeneratedVisual } from "@/core/providers/types";
import type { ProviderId } from "@/core/providers/catalog";
import { safeJoin } from "@/lib/fs/safe-path";

export interface GenerationRecord {
  version: 1;
  id: string;
  name: string;
  kind: AssetKind;
  createdAt: string;
  source: { provider: ProviderId; model?: string; file: string };
  visual: { width: number; height: number; format: "png"; file: string };
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
}): Promise<GenerationRecord> {
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const root = safeJoin(cacheRoot(), id);
  await mkdir(root, { recursive: true });

  const sourceExtension = input.source.mimeType === "image/jpeg" ? "jpg" : input.source.mimeType === "image/webp" ? "webp" : "png";
  const sourcePath = `source.${sourceExtension}`;
  await writeFile(safeJoin(root, sourcePath), input.source.buffer);
  await writeFile(safeJoin(root, "processed.png"), input.normalized.buffer);
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
    source: { provider: input.source.provider, model: input.source.model, file: sourcePath },
    visual: { width: input.normalized.width, height: input.normalized.height, format: "png", file: "processed.png" },
    adapter: { id: input.output.adapterId, metadata: input.output.metadata },
    validation: input.validation,
    files: input.output.files.map(({ path, mimeType }) => ({ path, mimeType })),
  };
  await writeFile(safeJoin(root, "generation.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return record;
}

export async function getGeneration(id: string): Promise<{ root: string; record: GenerationRecord }> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("Mã kết quả không hợp lệ.");
  const root = safeJoin(cacheRoot(), id);
  const record = JSON.parse(await readFile(safeJoin(root, "generation.json"), "utf8")) as GenerationRecord;
  return { root, record };
}
