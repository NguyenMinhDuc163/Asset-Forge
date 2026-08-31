import { generateCodexOAuthImage } from "@/lib/codex/client";
import type { AssetGenerationProvider, GeneratedVisual, ProviderGenerateInput } from "./types";

export class CodexOAuthImageProvider implements AssetGenerationProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI Codex OAuth";
  readonly canGenerateFromText = true;
  readonly canEditImage = true;

  async generate(input: ProviderGenerateInput): Promise<GeneratedVisual> {
    const model = input.model || "gpt-5.5-image";
    const prompt = [input.prompt?.trim() || "Adapt the supplied image into a clean game asset.", input.generationRecipe, "Create one isolated game asset with a clear silhouette, centered composition, no text, and transparent background."].filter(Boolean).join("\n\n");
    const result = await generateCodexOAuthImage({ model, prompt, referenceImage: input.referenceImage, referenceMimeType: input.referenceMimeType });
    return { ...result, provider: this.id, model };
  }
}
