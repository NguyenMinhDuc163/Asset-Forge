export const assetKinds = ["character", "environment", "item", "effect"] as const;

export type AssetKind = (typeof assetKinds)[number];

export interface CreateAssetInput {
  projectId: string;
  kind: AssetKind;
  prompt?: string;
  referenceImage?: Buffer;
  referenceMimeType?: string;
  provider: "openai" | "manual";
}

export interface NormalizedAsset {
  buffer: Buffer;
  width: number;
  height: number;
  format: "png";
  hasAlpha: boolean;
}
