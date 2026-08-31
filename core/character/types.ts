export type CharacterPoseState = "idle" | "run" | "jump" | "fall" | "attack" | "hurt" | "fly";

export interface Offset { x: number; y: number }

export interface CharacterPose {
  id: string;
  state: CharacterPoseState;
  headFrame: string;
  bodyFrame: string;
  legFrame: string;
  headOffset: Offset;
  bodyOffset: Offset;
  legOffset: Offset;
}

export interface CharacterFrame {
  id: string;
  imagePath: string;
  dx: number;
  dy: number;
  width: number;
  height: number;
  buffer?: Buffer;
}

export interface CharacterPart {
  frames: CharacterFrame[];
}

export interface CharacterPoseMapping {
  id: string;
  state: CharacterPose["state"];
  headFrame: string;
  bodyFrame: string;
  legFrame: string;
  headOffset: Offset;
  bodyOffset: Offset;
  legOffset: Offset;
}

export type CharacterGenerationMode = "ai" | "reference-static" | "template-reference" | "template-random";
export type CharacterAssetStatus = "draft" | "static-ready" | "playable" | "game-ready";

export interface CharacterAsset {
  id: string;
  name: string;
  templateId: string;
  generationMode: CharacterGenerationMode;
  parts: { head: CharacterPart; body: CharacterPart; leg: CharacterPart };
  poses: CharacterPoseMapping[];
  previewFrames: Array<{ poseId: string; state: CharacterPose["state"]; buffer: Buffer; width: number; height: number }>;
  status: CharacterAssetStatus;
  pipeline?: { designMaster: "ai" | "reference" | "template"; poseSource: "ai" | "template" | "static" };
  referenceAnalysis?: {
    backgroundRemoved: boolean;
    sourceComplete: boolean;
    partsReady: boolean;
    headJointReady: boolean;
    bodyJointReady: boolean;
    legJointReady: boolean;
    similarity: number;
    splitRows: { headEnd: number; bodyEnd: number };
    splitLines: { neck: number; hip: number };
  };
}
