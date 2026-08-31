import sharp from "sharp";
import type { CharacterAsset, CharacterFrame, CharacterPoseMapping } from "@/core/character/types";

const canvas = { width: 64, height: 128 } as const;

/** Render the exact layered data the NRO adapter exports, including pose offsets. */
export async function renderCharacterPose(asset: CharacterAsset, pose: CharacterPoseMapping): Promise<Buffer> {
  const frames: Record<string, CharacterFrame> = {};
  for (const part of ["head", "body", "leg"] as const) {
    for (const frame of asset.parts[part].frames) frames[frame.id] = frame;
  }
  const layer = (frameId: string, left: number, top: number) => {
    const frame = frames[frameId];
    if (!frame?.buffer) throw new Error(`Missing character frame ${frameId}.`);
    return { input: frame.buffer, left, top };
  };
  const rendered = sharp({ create: { ...canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      layer(pose.legFrame, pose.legOffset.x, 64 + pose.legOffset.y),
      layer(pose.bodyFrame, pose.bodyOffset.x, 32 + pose.bodyOffset.y),
      layer(pose.headFrame, pose.headOffset.x, pose.headOffset.y),
    ]);
  return asset.pipeline?.poseSource === "static"
    ? rendered.png({ compressionLevel: 9 }).toBuffer()
    : rendered.png({ palette: true, colours: 128 }).toBuffer();
}

export async function renderCharacterPreview(asset: CharacterAsset, state = "idle") {
  const poses = asset.poses.filter((pose) => pose.state === state);
  return Promise.all((poses.length ? poses : asset.poses.slice(0, 1)).map(async (pose) => ({
    poseId: pose.id,
    state: pose.state,
    buffer: await renderCharacterPose(asset, pose),
    width: canvas.width,
    height: canvas.height,
  })));
}
