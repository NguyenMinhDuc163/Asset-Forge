import type { CharacterPose } from "@/core/character/types";
import type { CharacterTemplate, PartTemplate, SemanticPalette } from "./types";

const partPalette: Record<PartTemplate["id"], PartTemplate["semanticPalette"]> = {
  head: {
    hair: ["hair"], skin: ["skin"], accent: ["accent"],
    shirtPrimary: [], shirtSecondary: [], pantsPrimary: [], boots: [],
  },
  body: {
    skin: ["skin"], shirtPrimary: ["shirtPrimary"], shirtSecondary: ["shirtSecondary"], accent: ["accent"],
    hair: [], pantsPrimary: [], boots: [],
  },
  leg: {
    pantsPrimary: ["pantsPrimary"], boots: ["boots"], accent: ["accent"],
    hair: [], skin: [], shirtPrimary: [], shirtSecondary: [],
  },
};

const pose = (id: string, state: CharacterPose["state"], headFrame: string, bodyFrame: string, legFrame: string, offsets: Partial<Pick<CharacterPose, "headOffset" | "bodyOffset" | "legOffset">> = {}): CharacterPose => ({
  id,
  state,
  headFrame,
  bodyFrame,
  legFrame,
  headOffset: offsets.headOffset || { x: 0, y: 0 },
  bodyOffset: offsets.bodyOffset || { x: 0, y: 0 },
  legOffset: offsets.legOffset || { x: 0, y: 0 },
});

export const nroHumanoidPoses: CharacterPose[] = [
  pose("idle-0", "idle", "head-idle", "body-idle", "leg-idle"),
  pose("idle-1", "idle", "head-idle", "body-idle", "leg-idle", { bodyOffset: { x: 0, y: 1 } }),
  pose("run-0", "run", "head-idle", "body-run-0", "leg-run-0", { bodyOffset: { x: -1, y: 0 }, legOffset: { x: 1, y: 0 } }),
  pose("run-1", "run", "head-idle", "body-run-1", "leg-run-1", { headOffset: { x: 1, y: 0 }, legOffset: { x: -1, y: 0 } }),
  pose("run-2", "run", "head-idle", "body-run-0", "leg-run-0", { bodyOffset: { x: 1, y: 0 }, legOffset: { x: 1, y: 0 } }),
  pose("jump", "jump", "head-idle", "body-jump", "leg-jump", { headOffset: { x: 0, y: -2 }, bodyOffset: { x: 0, y: -1 }, legOffset: { x: 0, y: -1 } }),
  pose("fall", "fall", "head-idle", "body-jump", "leg-fall", { headOffset: { x: 0, y: 1 }, bodyOffset: { x: 0, y: 1 }, legOffset: { x: 0, y: 1 } }),
  pose("hurt", "hurt", "head-hurt", "body-hurt", "leg-hurt", { headOffset: { x: -2, y: 0 }, bodyOffset: { x: -2, y: 0 }, legOffset: { x: -2, y: 0 } }),
  pose("attack-0", "attack", "head-idle", "body-attack-0", "leg-idle"),
  pose("attack-1", "attack", "head-idle", "body-attack-1", "leg-idle", { bodyOffset: { x: 2, y: 0 } }),
  pose("attack-2", "attack", "head-idle", "body-attack-2", "leg-idle", { bodyOffset: { x: 1, y: 0 } }),
  pose("fly", "fly", "head-idle", "body-jump", "leg-fall", { headOffset: { x: 0, y: -2 }, bodyOffset: { x: 0, y: -2 }, legOffset: { x: 0, y: -2 } }),
];

export const nroHumanoidTemplate: CharacterTemplate = {
  id: "nro-humanoid-v1",
  name: "NRO Humanoid",
  referenceCharacter: { headPartId: 64, bodyPartId: 1, legPartId: 2 },
  poses: nroHumanoidPoses,
  parts: {
    head: { id: "head", width: 64, height: 64, semanticPalette: partPalette.head },
    body: { id: "body", width: 64, height: 64, semanticPalette: partPalette.body },
    leg: { id: "leg", width: 64, height: 64, semanticPalette: partPalette.leg },
  },
};

export const defaultSemanticPalette: SemanticPalette = {
  hair: ["#1d2430", "#3c4657", "#8792a3"],
  skin: ["#8f4f3d", "#d18b68", "#f0c0a0"],
  shirtPrimary: ["#244c73", "#3876a8", "#7eb0d4"],
  shirtSecondary: ["#15263d", "#243c5a", "#496a92"],
  pantsPrimary: ["#26324b", "#3e527a", "#7185ab"],
  boots: ["#171b28", "#394155", "#7a879d"],
  accent: ["#a84a38", "#df7445", "#f2b05f"],
};
