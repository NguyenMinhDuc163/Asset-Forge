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
  provider: "openai" | "manual";
  model?: string;
  revisedPrompt?: string;
}

export interface AssetGenerationProvider {
  readonly id: "openai" | "manual";
  readonly label: string;
  readonly canGenerateFromText: boolean;
  readonly canEditImage: boolean;
  generate(input: ProviderGenerateInput): Promise<GeneratedVisual>;
}
