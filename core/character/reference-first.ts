import { createHash } from "node:crypto";
import sharp from "sharp";
import type { NormalizedAsset } from "@/core/assets/types";
import { renderCharacterPose } from "@/core/character-preview/renderer";
import type { CharacterAsset, CharacterFrame, CharacterPoseMapping } from "./types";

const gameCanvas = { width: 64, height: 128 } as const;
const partCanvas = 64;

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ReferenceStaticAnalysis {
  backgroundRemoved: boolean;
  sourceComplete: boolean;
  partsReady: boolean;
  similarity: number;
  splitRows: { headEnd: number; bodyEnd: number };
}

export interface ProcessedReference {
  normalized: NormalizedAsset;
  backgroundRemoved: boolean;
  sourceComplete: boolean;
}

function colourDistance(data: Buffer, offset: number, colour: readonly number[]) {
  return Math.max(
    Math.abs(data[offset] - colour[0]),
    Math.abs(data[offset + 1] - colour[1]),
    Math.abs(data[offset + 2] - colour[2]),
  );
}

function findAlphaBounds(data: Buffer, width: number, height: number, channels: number): Bounds | undefined {
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top ? undefined : { left, right, top, bottom };
}

function dominantBorderColour(data: Buffer, width: number, height: number, channels: number) {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number }>();
  const visit = (x: number, y: number) => {
    const offset = (y * width + x) * channels;
    if (data[offset + 3] < 220) return;
    const key = `${Math.floor(data[offset] / 24)},${Math.floor(data[offset + 1] / 24)},${Math.floor(data[offset + 2] / 24)}`;
    const bucket = buckets.get(key) || { count: 0, red: 0, green: 0, blue: 0 };
    bucket.count += 1;
    bucket.red += data[offset];
    bucket.green += data[offset + 1];
    bucket.blue += data[offset + 2];
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x += 1) {
    visit(x, 0);
    visit(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(0, y);
    visit(width - 1, y);
  }
  const dominant = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  const borderPixels = Math.max(1, width * 2 + Math.max(0, height - 2) * 2);
  if (!dominant || dominant.count / borderPixels < 0.18) return undefined;
  return [
    Math.round(dominant.red / dominant.count),
    Math.round(dominant.green / dominant.count),
    Math.round(dominant.blue / dominant.count),
  ] as const;
}

/**
 * Preserve the reference at working resolution and remove only background
 * pixels connected to the image border. This avoids erasing light clothing,
 * eyes, or highlights that happen to share the background colour.
 */
export async function processReferenceCharacter(input: Buffer): Promise<ProcessedReference> {
  if (!input.length) throw new Error("Ảnh nguồn không có dữ liệu.");
  let metadata;
  try {
    metadata = await sharp(input, { failOn: "error", limitInputPixels: 64_000_000 }).metadata();
  } catch {
    throw new Error("Ảnh nguồn bị hỏng hoặc không thuộc định dạng được hỗ trợ.");
  }
  if (!metadata.width || !metadata.height) throw new Error("Không thể xác định kích thước ảnh nguồn.");

  const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 64_000_000 })
    .rotate()
    .resize({ width: 768, height: 1024, fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hadTransparency = false;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] < 250) {
      hadTransparency = true;
      break;
    }
  }
  const background = dominantBorderColour(data, info.width, info.height, info.channels);
  let removedPixels = 0;
  if (background) {
    const visited = new Uint8Array(info.width * info.height);
    const queue = new Int32Array(info.width * info.height);
    let read = 0;
    let write = 0;
    const enqueue = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
      const index = y * info.width + x;
      if (visited[index]) return;
      const offset = index * info.channels;
      if (data[offset + 3] > 12 && colourDistance(data, offset, background) > 58) return;
      visited[index] = 1;
      queue[write] = index;
      write += 1;
    };
    for (let x = 0; x < info.width; x += 1) {
      enqueue(x, 0);
      enqueue(x, info.height - 1);
    }
    for (let y = 1; y < info.height - 1; y += 1) {
      enqueue(0, y);
      enqueue(info.width - 1, y);
    }
    while (read < write) {
      const index = queue[read];
      read += 1;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      const offset = index * info.channels;
      const distance = colourDistance(data, offset, background);
      if (data[offset + 3] <= 12 || distance <= 30) data[offset + 3] = 0;
      else data[offset + 3] = Math.min(data[offset + 3], Math.round(((distance - 30) / 28) * 255));
      removedPixels += 1;
      enqueue(x - 1, y);
      enqueue(x + 1, y);
      enqueue(x, y - 1);
      enqueue(x, y + 1);
    }
  }

  const bounds = findAlphaBounds(data, info.width, info.height, info.channels);
  if (!bounds) throw new Error("Ảnh nguồn không có chủ thể rõ ràng sau khi tách nền.");
  const sourceComplete = bounds.left > 1 && bounds.right < info.width - 2 && bounds.top > 1 && bounds.bottom < info.height - 2;
  const cropWidth = bounds.right - bounds.left + 1;
  const cropHeight = bounds.bottom - bounds.top + 1;
  const padding = Math.max(4, Math.round(Math.max(cropWidth, cropHeight) * 0.025));
  const processed = await sharp(data, { raw: info })
    .extract({ left: bounds.left, top: bounds.top, width: cropWidth, height: cropHeight })
    .extend({ top: padding, right: padding, bottom: padding, left: padding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const processedMetadata = await sharp(processed).metadata();
  const backgroundRemoved = removedPixels / (info.width * info.height) >= 0.01 || hadTransparency;

  return {
    normalized: {
      buffer: processed,
      width: processedMetadata.width || cropWidth + padding * 2,
      height: processedMetadata.height || cropHeight + padding * 2,
      format: "png",
      hasAlpha: true,
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
    },
    backgroundRemoved,
    sourceComplete,
  };
}

function findSplitRow(widths: number[], start: number, end: number, target: number) {
  const maxWidth = Math.max(1, ...widths);
  let best = target;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let row = start; row <= end; row += 1) {
    const emptyPenalty = widths[row] === 0 ? 0.45 : 0;
    const score = widths[row] / maxWidth + Math.abs(row - target) / Math.max(1, end - start) * 0.28 + emptyPenalty;
    if (score < bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

async function countVisible(input: Buffer) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) if (data[offset + 3] > 12) visible += 1;
  return visible;
}

async function makePart(source: Buffer, start: number, end: number) {
  const height = end - start;
  if (height < 1 || height > partCanvas) throw new Error("Không thể chia ảnh thành HEAD, BODY và LEG hợp lệ.");
  const band = await sharp(source).extract({ left: 0, top: start, width: gameCanvas.width, height }).png().toBuffer();
  return sharp({ create: { width: partCanvas, height: partCanvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: band, left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function imageSimilarity(left: Buffer, right: Buffer) {
  const [a, b] = await Promise.all([
    sharp(left).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(right).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height || a.info.channels !== b.info.channels) return 0;
  let difference = 0;
  for (let index = 0; index < a.data.length; index += 1) difference += Math.abs(a.data[index] - b.data[index]);
  return Math.max(0, 1 - difference / (a.data.length * 255));
}

/** Split the real processed reference into static NRO-sized parts without redrawing it. */
export async function createReferenceStaticCharacter(input: {
  name: string;
  processed: Buffer;
  backgroundRemoved: boolean;
  sourceComplete: boolean;
}): Promise<{ asset: CharacterAsset; analysis: ReferenceStaticAnalysis; gameImage: Buffer }> {
  const fitted = await sharp(input.processed, { limitInputPixels: 64_000_000 })
    .resize(60, 124, { fit: "contain", kernel: sharp.kernel.lanczos3, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 2, right: 2, bottom: 2, left: 2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const { data, info } = await sharp(fitted).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = findAlphaBounds(data, info.width, info.height, info.channels);
  if (!bounds) throw new Error("Ảnh nguồn không có silhouette nhân vật rõ ràng.");
  const characterHeight = bounds.bottom - bounds.top + 1;
  const widths = Array.from({ length: gameCanvas.height }, (_, y) => {
    let visible = 0;
    for (let x = 0; x < gameCanvas.width; x += 1) if (data[(y * gameCanvas.width + x) * info.channels + 3] > 12) visible += 1;
    return visible;
  });
  const headTarget = bounds.top + Math.round(characterHeight * 0.34);
  const bodyTarget = bounds.top + Math.round(characterHeight * 0.68);
  const headEnd = Math.max(24, Math.min(58, findSplitRow(widths, bounds.top + Math.round(characterHeight * 0.25), bounds.top + Math.round(characterHeight * 0.43), headTarget)));
  const bodyEnd = Math.max(66, Math.min(104, findSplitRow(widths, bounds.top + Math.round(characterHeight * 0.56), bounds.top + Math.round(characterHeight * 0.76), bodyTarget)));

  const [head, body, leg] = await Promise.all([
    makePart(fitted, 0, headEnd),
    makePart(fitted, headEnd, bodyEnd),
    makePart(fitted, bodyEnd, gameCanvas.height),
  ]);
  const visibleCounts = await Promise.all([countVisible(head), countVisible(body), countVisible(leg)]);
  const partsReady = visibleCounts.every((count) => count >= 12);
  const frames: Record<"head" | "body" | "leg", CharacterFrame> = {
    head: { id: "head-static", imagePath: "sprites/head.png", dx: 0, dy: 0, width: 64, height: 64, buffer: head },
    body: { id: "body-static", imagePath: "sprites/body.png", dx: 0, dy: 0, width: 64, height: 64, buffer: body },
    leg: { id: "leg-static", imagePath: "sprites/leg.png", dx: 0, dy: 0, width: 64, height: 64, buffer: leg },
  };
  const pose: CharacterPoseMapping = {
    id: "static",
    state: "idle",
    headFrame: frames.head.id,
    bodyFrame: frames.body.id,
    legFrame: frames.leg.id,
    headOffset: { x: 0, y: 0 },
    bodyOffset: { x: 0, y: headEnd - 32 },
    legOffset: { x: 0, y: bodyEnd - 64 },
  };
  const id = createHash("sha1").update(input.name).update(input.processed).digest("hex").slice(0, 16);
  const assetBase: CharacterAsset = {
    id,
    name: input.name,
    templateId: "reference-static-v1",
    generationMode: "reference-static",
    parts: { head: { frames: [frames.head] }, body: { frames: [frames.body] }, leg: { frames: [frames.leg] } },
    poses: [pose],
    previewFrames: [],
    status: "draft",
    pipeline: { designMaster: "reference", poseSource: "static" },
  };
  const preview = await renderCharacterPose(assetBase, pose);
  const similarity = await imageSimilarity(fitted, preview);
  const staticReady = input.backgroundRemoved && input.sourceComplete && partsReady && similarity >= 0.985;
  const analysis: ReferenceStaticAnalysis = {
    backgroundRemoved: input.backgroundRemoved,
    sourceComplete: input.sourceComplete,
    partsReady,
    similarity,
    splitRows: { headEnd, bodyEnd },
  };
  const asset: CharacterAsset = {
    ...assetBase,
    status: staticReady ? "static-ready" : "draft",
    previewFrames: [{ poseId: pose.id, state: pose.state, buffer: preview, width: gameCanvas.width, height: gameCanvas.height }],
    referenceAnalysis: analysis,
  };
  return { asset, analysis, gameImage: fitted };
}
