export const providerCatalog = [
  { id: "manual", kind: "local", requiresReference: true },
  { id: "openai", kind: "remote", requiresReference: false },
  { id: "nine-router", kind: "remote", requiresReference: false },
] as const;

export type ProviderId = (typeof providerCatalog)[number]["id"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && providerCatalog.some((provider) => provider.id === value);
}

export function getProviderDefinition(id: ProviderId) {
  return providerCatalog.find((provider) => provider.id === id) as (typeof providerCatalog)[number];
}
