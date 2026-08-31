import type { CharacterPose, CharacterAsset } from "@/core/character/types";

export type PaletteRole = "hair" | "skin" | "shirtPrimary" | "shirtSecondary" | "pantsPrimary" | "boots" | "accent";

export type SemanticPalette = Record<PaletteRole, [string, string, string]>;

export interface PartTemplate {
  id: "head" | "body" | "leg";
  width: number;
  height: number;
  semanticPalette: Record<PaletteRole, PaletteRole[]>;
}

export interface CharacterTemplate {
  id: string;
  name: string;
  referenceCharacter: { headPartId: number; bodyPartId: number; legPartId: number };
  poses: CharacterPose[];
  parts: { head: PartTemplate; body: PartTemplate; leg: PartTemplate };
}

export interface TemplateCharacterResult {
  asset: CharacterAsset;
  palette: SemanticPalette;
}
