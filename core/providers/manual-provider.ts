import type { AssetGenerationProvider, ProviderGenerateInput } from "./types";

export class ManualImageProvider implements AssetGenerationProvider {
  readonly id = "manual" as const;
  readonly label = "No-AI image processing";
  readonly canGenerateFromText = false;
  readonly canEditImage = false;

  async generate(input: ProviderGenerateInput) {
    if (!input.referenceImage || !input.referenceMimeType) {
      throw new Error("Thêm ảnh nguồn để dùng chế độ Không AI.");
    }
    return { buffer: input.referenceImage, mimeType: input.referenceMimeType, provider: this.id };
  }
}
