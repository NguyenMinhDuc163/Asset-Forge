import OpenAI, { toFile } from "openai";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import type { AssetGenerationProvider, GeneratedVisual, ProviderGenerateInput } from "./types";

export class OpenAIImageProvider implements AssetGenerationProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";
  readonly canGenerateFromText = true;
  readonly canEditImage = true;

  constructor(private readonly apiKey: string) {}

  async generate(input: ProviderGenerateInput): Promise<GeneratedVisual> {
    const client = new OpenAI({ apiKey: this.apiKey });
    const model = input.model || "gpt-image-2";
    const prompt = [
      input.prompt?.trim() || "Adapt the supplied image into a clean game asset.",
      input.generationRecipe,
      "Create one isolated game asset with a clear silhouette, centered composition, no text, and transparent background.",
    ].filter(Boolean).join("\n\n");

    try {
      const response = input.referenceImage
        ? await client.images.edit({
            model,
            prompt,
            image: await toFile(input.referenceImage, "reference-image", { type: input.referenceMimeType || "image/png" }),
            background: "transparent",
            output_format: "png",
            quality: "medium",
            size: "1024x1024",
          })
        : await client.images.generate({
            model,
            prompt,
            background: "transparent",
            output_format: "png",
            quality: "medium",
            size: "1024x1024",
          });

      const image = response.data?.[0];
      if (!image?.b64_json) throw new Error("OpenAI returned no image data.");
      return {
        buffer: Buffer.from(image.b64_json, "base64"),
        mimeType: "image/png",
        provider: this.id,
        model,
        revisedPrompt: image.revised_prompt,
      };
    } catch (error) {
      throw toOpenAIProviderError(error);
    }
  }
}
