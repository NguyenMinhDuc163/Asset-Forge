import type { AssetKind } from "../assets/types";

export interface ProviderGenerateInput {
  kind: AssetKind;
  prompt?: string;
  referenceImage?: Buffer;
  referenceMimeType?: string;
  model?: string;
  generationRecipe?: string;
}

export interface GeneratedVisual {
  buffer: Buffer;
  mimeType: string;
  provider: "openai" | "nine-router" | "manual";
  model?: string;
  revisedPrompt?: string;
}

export interface AssetGenerationProvider {
  readonly id: "openai" | "nine-router" | "manual";
  readonly label: string;
  readonly canGenerateFromText: boolean;
  readonly canEditImage: boolean;
  generate(input: ProviderGenerateInput): Promise<GeneratedVisual>;
}
