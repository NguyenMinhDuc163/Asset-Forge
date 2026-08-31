import type { AssetKind } from "./types";
import type { GeneratedVisual } from "../providers/types";
import { getDefaultNormalizeOptions, normalizeImage } from "../image/normalize";

export async function processGeneratedVisual(kind: AssetKind, visual: GeneratedVisual) {
  return normalizeImage(visual.buffer, getDefaultNormalizeOptions(kind));
}
