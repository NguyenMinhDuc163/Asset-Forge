import type { AssetAdapter } from "./types";
import { GenericSpriteAdapter } from "./generic-sprite";
import { NroLegacyAdapter } from "./nro-legacy";

const adapters: AssetAdapter[] = [new NroLegacyAdapter(), new GenericSpriteAdapter()];

export function getAdapter(adapterId: string): AssetAdapter {
  return adapters.find((adapter) => adapter.id === adapterId) || adapters[1];
}

export function listAdapters() {
  return adapters.map(({ id, label, supportedKinds }) => ({ id, label, supportedKinds }));
}
