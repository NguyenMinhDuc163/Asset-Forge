import { generateNineRouterImage } from "@/lib/nine-router/client";
import type { AssetGenerationProvider, GeneratedVisual, ProviderGenerateInput } from "./types";

export class NineRouterImageProvider implements AssetGenerationProvider {
  readonly id = "nine-router" as const;
  readonly label = "9Router";
  readonly canGenerateFromText = true;
  readonly canEditImage = true;

  constructor(private readonly baseUrl: string, private readonly apiKey?: string) {}

  async generate(input: ProviderGenerateInput): Promise<GeneratedVisual> {
    const prompt = [
      input.prompt?.trim() || "Adapt the supplied image into a clean game asset.",
      input.generationRecipe,
      "Create one isolated game asset with a clear silhouette, centered composition, no text, and transparent background when supported.",
    ].filter(Boolean).join("\n\n");
    const result = await generateNineRouterImage({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      model: input.model || "auto",
      prompt,
      referenceImage: input.referenceImage,
      referenceMimeType: input.referenceMimeType,
    });
    return { ...result, provider: this.id, model: input.model };
  }
}
