import type { AssetGenerationProvider, ProviderGenerateInput } from "./types";

export class ManualImageProvider implements AssetGenerationProvider {
  readonly id = "manual" as const;
  readonly label = "No-AI image processing";
  readonly canGenerateFromText = false;
  readonly canEditImage = false;

  async generate(input: ProviderGenerateInput) {
    if (!input.referenceImage || !input.referenceMimeType) {
      throw new Error("Add a source image to use No-AI mode.");
    }
    return { buffer: input.referenceImage, mimeType: input.referenceMimeType, provider: this.id };
  }
}
