import type { AssetKind, NormalizedAsset } from "../assets/types";
import type { ProviderId } from "@/lib/storage/settings";
import type { NormalizeOptions } from "../image/normalize";

export interface AdapterContext {
  kind: AssetKind;
  provider: ProviderId;
}

export interface AdapterFile {
  path: string;
  buffer: Buffer;
  mimeType: string;
}

export interface AdapterOutput {
  adapterId: string;
  kind: AssetKind;
  files: AdapterFile[];
  preview: { buffer: Buffer; width: number; height: number; mimeType: "image/png" };
  metadata: Record<string, unknown>;
}

export interface ValidationResult {
  ready: boolean;
  checks: Array<{ id: string; label: string; passed: boolean; message?: string }>;
}

export interface AssetAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportedKinds: readonly AssetKind[];
  getGenerationRecipe(context: AdapterContext): string;
  getNormalizeOptions(context: AdapterContext): NormalizeOptions;
  transform(input: NormalizedAsset, context: AdapterContext): Promise<AdapterOutput>;
  validate(output: AdapterOutput): Promise<ValidationResult>;
}
