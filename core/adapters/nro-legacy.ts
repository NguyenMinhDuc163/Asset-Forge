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
      return context.provider === "openai"
        ? { width: partSize * 3, height: partSize, pixelArt: true, paletteColours: 128 }
        : { width: partSize, height: partSize * 3, pixelArt: true, paletteColours: 128 };
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

    const horizontal = context.provider === "openai";
    const parts = await Promise.all(partNames.map(async (name, index) => {
      const extracted = await sharp(input.buffer)
        .extract(horizontal
          ? { left: index * partSize, top: 0, width: partSize, height: partSize }
          : { left: 0, top: index * partSize, width: partSize, height: partSize })
        .png({ palette: true, colours: 128 })
        .toBuffer();
      return { name, buffer: extracted };
    }));

    const atlas = await sharp({ create: { width: partSize * 3, height: partSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: index * partSize, top: 0 })))
      .png({ palette: true, colours: 128 })
      .toBuffer();

    const preview = await sharp({ create: { width: partSize, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: 0, top: index * 32 })))
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
      metadata: { partSize, layout: "head-body-legs", smallImages },
    };
  }

  async validate(output: AdapterOutput) {
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
