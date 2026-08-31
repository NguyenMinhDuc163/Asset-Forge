import type { AssetGenerationProvider, GeneratedVisual, ProviderGenerateInput } from "./types";

export class OpenAIImageProvider implements AssetGenerationProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";
  readonly canGenerateFromText = true;
  readonly canEditImage = true;

  async generate(input: ProviderGenerateInput): Promise<GeneratedVisual> {
    void input;
    throw new Error("OpenAI image generation is not configured yet.");
  }
}
