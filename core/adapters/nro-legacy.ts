import sharp from "sharp";
import type { NormalizedAsset } from "../assets/types";
import type { AdapterContext, AdapterFile, AdapterOutput, AssetAdapter } from "./types";
import { getDefaultNormalizeOptions } from "../image/normalize";

const partNames = ["head", "body", "legs"] as const;
const partSize = 64;

export class NroLegacyAdapter implements AssetAdapter {
  readonly id = "nro-legacy-v1";
  readonly label = "NRO Legacy";
  readonly supportedKinds = ["character", "environment", "item", "effect"] as const;

  getGenerationRecipe(context: AdapterContext) {
    if (context.kind !== "character") return `Create one isolated ${context.kind} sprite on a transparent background.`;
    return [
      "Create a character parts sheet on a transparent 3:1 canvas with exactly three equal square cells from left to right: HEAD, BODY, LEGS.",
      "Each cell must contain only that body part, centered, front-facing, and aligned so the three exported parts can be composed vertically.",
      "Do not draw labels, grid lines, shadows, scenery, duplicate parts, or a complete character.",
    ].join(" ");
  }

  getNormalizeOptions(context: AdapterContext) {
    if (context.kind === "character") {
      return context.provider !== "manual"
        ? { width: partSize * 3, height: partSize, pixelArt: true, paletteColours: 128 }
        : { width: partSize * 3, height: partSize * 3, pixelArt: true, paletteColours: 128, removeSolidBackground: true };
    }
    return getDefaultNormalizeOptions(context.kind);
  }

  async transform(input: NormalizedAsset, context: AdapterContext): Promise<AdapterOutput> {
    if (context.kind !== "character") {
      return {
        adapterId: this.id,
        kind: context.kind,
        files: [{ path: "sprites/asset.png", buffer: input.buffer, mimeType: "image/png" }],
        preview: { buffer: input.buffer, width: input.width, height: input.height, mimeType: "image/png" },
        metadata: { smallImages: [{ id: 0, file: "sprites/asset.png", x: 0, y: 0 }] },
      };
    }

    const horizontal = context.provider !== "manual";
    const extraction = horizontal
      ? { mode: "generated-sheet", regions: partNames.map((_, index) => ({ left: index * partSize, top: 0, width: partSize, height: partSize })) }
      : await this.getManualRegions(input);
    const parts = await Promise.all(partNames.map(async (name, index) => {
      const extracted = await sharp(input.buffer)
        .extract(extraction.regions[index])
        .resize(partSize, partSize, { fit: "contain", kernel: sharp.kernel.nearest, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ palette: true, colours: 128 })
        .toBuffer();
      return { name, buffer: extracted };
    }));

    const atlas = await sharp({ create: { width: partSize * 3, height: partSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: index * partSize, top: 0 })))
      .png({ palette: true, colours: 128 })
      .toBuffer();

    const preview = await sharp({ create: { width: partSize, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: 0, top: index * 32 })).reverse())
      .png({ palette: true, colours: 128 })
      .toBuffer();

    const smallImages = parts.map((part, index) => ({
      id: index,
      name: part.name,
      file: `sprites/${part.name}.png`,
      atlas: { x: index * partSize, y: 0, width: partSize, height: partSize },
      pivot: { x: 32, y: part.name === "head" ? 54 : part.name === "body" ? 32 : 10 },
      offset: { x: 0, y: index * 32 },
    }));

    const files: AdapterFile[] = [
      ...parts.map((part) => ({ path: `sprites/${part.name}.png`, buffer: part.buffer, mimeType: "image/png" })),
      { path: "atlas.png", buffer: atlas, mimeType: "image/png" },
      { path: "atlas.json", buffer: Buffer.from(JSON.stringify({ width: 192, height: 64, parts: smallImages }, null, 2)), mimeType: "application/json" },
      { path: "integration/small-images.json", buffer: Buffer.from(JSON.stringify({ format: "nro-small-image-v1", images: smallImages }, null, 2)), mimeType: "application/json" },
    ];

    return {
      adapterId: this.id,
      kind: context.kind,
      files,
      preview: { buffer: preview, width: partSize, height: 128, mimeType: "image/png" },
      metadata: { partSize, layout: "head-body-legs", extractionMode: extraction.mode, smallImages },
    };
  }

  private async getManualRegions(input: NormalizedAsset) {
    const { data, info } = await sharp(input.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width;
    let right = -1;
    let top = info.height;
    let bottom = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * info.channels + 3] <= 12) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left || bottom < top) throw new Error("Ảnh nguồn không có chủ thể rõ ràng sau khi tách nền.");

    const height = bottom - top + 1;
    const isVerticalSheet = input.sourceWidth / input.sourceHeight <= 0.42;
    const ranges = isVerticalSheet
      ? [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]
      : [[0, 0.28], [0.24, 0.64], [0.55, 1]];
    const regions = ranges.map(([start, end]) => {
      const regionTop = top + Math.floor(height * start);
      const regionBottom = Math.min(info.height, top + Math.ceil(height * end));
      let regionLeft = right;
      let regionRight = left;
      for (let y = regionTop; y < regionBottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (data[(y * info.width + x) * info.channels + 3] <= 12) continue;
          regionLeft = Math.min(regionLeft, x);
          regionRight = Math.max(regionRight, x);
        }
      }
      const padding = 2;
      regionLeft = Math.max(0, regionLeft - padding);
      regionRight = Math.min(info.width - 1, regionRight + padding);
      return { left: regionLeft, top: regionTop, width: Math.max(1, regionRight - regionLeft + 1), height: Math.max(1, regionBottom - regionTop) };
    });
    return { mode: isVerticalSheet ? "vertical-parts-sheet" : "foreground-body-zones", regions };
  }

  async validate(output: AdapterOutput) {
    if (output.kind !== "character") {
      const spriteReady = output.files.some((file) => file.path === "sprites/asset.png" && file.mimeType === "image/png");
      return {
        ready: spriteReady,
        checks: [
          { id: "format", label: "Định dạng PNG hợp lệ", passed: spriteReady },
          { id: "sprite", label: "Sprite NRO đã tạo", passed: spriteReady },
          { id: "metadata", label: "Metadata SmallImage đã tạo", passed: Array.isArray(output.metadata.smallImages) },
        ],
      };
    }
    const required = ["sprites/head.png", "sprites/body.png", "sprites/legs.png", "atlas.png", "integration/small-images.json"];
    const available = new Set(output.files.map((file) => file.path));
    const partsReady = required.every((path) => available.has(path));
    return {
      ready: partsReady,
      checks: [
        { id: "format", label: "Định dạng PNG hợp lệ", passed: output.files.filter((file) => file.mimeType === "image/png").length >= 4 },
        { id: "parts", label: "Đủ bộ phận HEAD, BODY, LEGS", passed: partsReady },
        { id: "metadata", label: "Dữ liệu SmallImage đã tạo", passed: available.has("integration/small-images.json") },
      ],
    };
  }
}
