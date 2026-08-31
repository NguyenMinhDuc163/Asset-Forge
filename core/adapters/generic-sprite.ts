import type { AssetAdapter, AdapterContext, AdapterOutput } from "./types";
import type { NormalizedAsset } from "../assets/types";
import { getDefaultNormalizeOptions } from "../image/normalize";

export class GenericSpriteAdapter implements AssetAdapter {
  readonly id = "generic-sprite-v1";
  readonly label = "Generic 2D Sprite";
  readonly supportedKinds = ["character", "environment", "item", "effect"] as const;

  getGenerationRecipe(context: AdapterContext) {
    return `Create a single ${context.kind} sprite centered on a transparent canvas. Keep all visible pixels inside the canvas with a crisp silhouette.`;
  }

  getNormalizeOptions(context: AdapterContext) {
    return getDefaultNormalizeOptions(context.kind);
  }

  async transform(input: NormalizedAsset, context: AdapterContext): Promise<AdapterOutput> {
    return {
      adapterId: this.id,
      kind: context.kind,
      files: [{ path: "processed.png", buffer: input.buffer, mimeType: "image/png" }],
      preview: { buffer: input.buffer, width: input.width, height: input.height, mimeType: "image/png" },
      metadata: { sprite: { width: input.width, height: input.height, pivot: { x: 0.5, y: 1 } } },
    };
  }

  async validate(output: AdapterOutput) {
    const image = output.files.find((file) => file.path === "processed.png");
    return {
      ready: Boolean(image),
      checks: [
        { id: "format", label: "Định dạng PNG hợp lệ", passed: Boolean(image) },
        { id: "dimensions", label: "Kích thước đã chuẩn hóa", passed: output.preview.width > 0 && output.preview.height > 0 },
        { id: "metadata", label: "Metadata đã tạo", passed: Boolean(output.metadata.sprite) },
      ],
    };
  }
}
