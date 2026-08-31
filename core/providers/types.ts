import type { AssetKind } from "../assets/types";
import type { ProviderId } from "./catalog";

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
  provider: ProviderId;
  model?: string;
  revisedPrompt?: string;
}

export interface AssetGenerationProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly canGenerateFromText: boolean;
  readonly canEditImage: boolean;
  generate(input: ProviderGenerateInput): Promise<GeneratedVisual>;
}
