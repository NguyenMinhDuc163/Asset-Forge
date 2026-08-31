import vi from "@/locales/vi.json";
import en from "@/locales/en.json";

export type Locale = "vi" | "en";
export type Copy = typeof vi;

export const dictionaries: Record<Locale, Copy> = { vi, en };

export function getCopy(locale: Locale): Copy {
  return dictionaries[locale] || dictionaries.vi;
}
