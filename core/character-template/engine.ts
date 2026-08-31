import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { CharacterAsset, CharacterFrame, CharacterPoseMapping } from "@/core/character/types";
import { renderCharacterPose } from "@/core/character-preview/renderer";
import { defaultSemanticPalette, nroHumanoidTemplate } from "./nro-humanoid-v1";
import type { PaletteRole, SemanticPalette, TemplateCharacterResult } from "./types";

const roleOrder: PaletteRole[] = ["hair", "skin", "shirtPrimary", "shirtSecondary", "pantsPrimary", "boots", "accent"];
const colourWords: Array<{ roles: PaletteRole[]; words: string[]; colour: string }> = [
  { roles: ["hair"], words: ["white", "silver", "bạc", "trắng"], colour: "#e8edf5" },
  { roles: ["hair"], words: ["black", "đen"], colour: "#161a22" },
  { roles: ["hair"], words: ["red", "đỏ"], colour: "#ad3f38" },
  { roles: ["shirtPrimary", "shirtSecondary"], words: ["black", "đen"], colour: "#1b202b" },
  { roles: ["shirtPrimary", "accent"], words: ["red", "đỏ"], colour: "#c94f3c" },
  { roles: ["shirtPrimary", "accent"], words: ["blue", "xanh dương", "xanh"], colour: "#3469a7" },
  { roles: ["shirtPrimary", "accent"], words: ["green", "xanh lá", "lục"], colour: "#3c8367" },
  { roles: ["shirtPrimary", "accent"], words: ["yellow", "vàng", "gold"], colour: "#cf9a3f" },
  { roles: ["shirtPrimary", "accent"], words: ["purple", "tím"], colour: "#7655a6" },
  { roles: ["pantsPrimary"], words: ["black", "đen"], colour: "#1b202b" },
  { roles: ["pantsPrimary"], words: ["red", "đỏ"], colour: "#a8443b" },
  { roles: ["pantsPrimary"], words: ["blue", "xanh dương", "xanh"], colour: "#2e4d7c" },
];

function clamp(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }

function parseHex(value: string) {
  const clean = value.replace("#", "");
  return [Number.parseInt(clean.slice(0, 2), 16), Number.parseInt(clean.slice(2, 4), 16), Number.parseInt(clean.slice(4, 6), 16)];
}

function hex([red, green, blue]: number[]) {
  return `#${[red, green, blue].map((value) => clamp(value).toString(16).padStart(2, "0")).join("")}`;
}

function shades(base: string): [string, string, string] {
  const rgb = parseHex(base);
  return [hex(rgb.map((value) => value * 0.58)), hex(rgb), hex(rgb.map((value) => value + (255 - value) * 0.35))];
}

function luminance([red, green, blue]: number[]) { return red * 0.2126 + green * 0.7152 + blue * 0.0722; }
function saturation([red, green, blue]: number[]) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function clonePalette(palette: SemanticPalette): SemanticPalette {
  return Object.fromEntries(roleOrder.map((role) => [role, [...palette[role]]])) as SemanticPalette;
}

function applyPromptColours(palette: SemanticPalette, prompt: string) {
  const normalized = prompt.toLowerCase();
  for (const entry of colourWords) {
    if (!entry.words.some((word) => normalized.includes(word))) continue;
    for (const role of entry.roles) palette[role] = shades(entry.colour);
  }
}

function applyProceduralVariant(palette: SemanticPalette, seed: string) {
  const variants = [
    { hair: "#252a38", shirt: "#2f6fa3", pants: "#3f5277", accent: "#df7445" },
    { hair: "#6a3b2f", shirt: "#7b3f76", pants: "#3c4c68", accent: "#e4b04e" },
    { hair: "#343b44", shirt: "#3b8067", pants: "#4c4f5e", accent: "#c95b48" },
    { hair: "#a8a9b4", shirt: "#39486e", pants: "#6d4f3c", accent: "#cf9a3f" },
  ];
  const digest = createHash("sha1").update(seed).digest();
  const variant = variants[digest[0] % variants.length];
  palette.hair = shades(variant.hair);
  palette.shirtPrimary = shades(variant.shirt);
  palette.pantsPrimary = shades(variant.pants);
  palette.accent = shades(variant.accent);
}

export async function extractSemanticPalette(reference?: Buffer, prompt = ""): Promise<SemanticPalette> {
  const palette = clonePalette(defaultSemanticPalette);
  if (reference?.length) {
    const { data, info } = await sharp(reference, { limitInputPixels: 64_000_000 })
      .resize(48, 48, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const buckets = new Map<string, { colour: number[]; count: number }>();
    for (let offset = 0; offset < data.length; offset += info.channels) {
      if (data[offset + 3] < 20) continue;
      const colour = [data[offset], data[offset + 1], data[offset + 2]];
      if (colour.every((value) => value > 242)) continue;
      const bucket = colour.map((value) => Math.floor(value / 16) * 16);
      const key = bucket.join(",");
      const previous = buckets.get(key);
      if (previous) previous.count += 1;
      else buckets.set(key, { colour: bucket, count: 1 });
    }
    const colours = [...buckets.values()].sort((a, b) => b.count - a.count).map((entry) => entry.colour);
    const darkest = [...colours].sort((a, b) => luminance(a) - luminance(b))[0];
    const warmSkin = colours.find(([red, green, blue]) => red > green * 1.05 && green > blue * 1.05 && luminance([red, green, blue]) > 70);
    const saturated = [...colours].sort((a, b) => saturation(b) - saturation(a));
    const accent = saturated.find((colour) => saturation(colour) > 0.3);
    const midtones = colours.filter((colour) => luminance(colour) > 45 && luminance(colour) < 210);
    if (darkest) palette.hair = shades(hex(darkest));
    if (warmSkin) palette.skin = shades(hex(warmSkin));
    if (midtones[0]) palette.shirtPrimary = shades(hex(midtones[0]));
    if (midtones[1]) palette.pantsPrimary = shades(hex(midtones[1]));
    if (accent) palette.accent = shades(hex(accent));
  }
  applyPromptColours(palette, prompt);
  return palette;
}

export async function isHumanoidCompatible(reference: Buffer) {
  const { data, info } = await sharp(reference, { limitInputPixels: 64_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  let visible = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] <= 12) continue;
      visible += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return false;
  const width = right - left + 1;
  const height = bottom - top + 1;
  const fill = visible / (info.width * info.height);
  const ratio = width / height;
  return height >= width * 1.05 && ratio >= 0.18 && ratio <= 0.95 && fill >= 0.02;
}

function safeColour(value: string) { return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"; }

function roleColour(palette: SemanticPalette, role: PaletteRole, shade: 0 | 1 | 2) { return safeColour(palette[role][shade]); }

async function renderPart(part: "head" | "body" | "leg", frameId: string, palette: SemanticPalette) {
  const movement = frameId.includes("run-1") || frameId.includes("attack-1") ? 2 : frameId.includes("run-0") || frameId.includes("attack-0") ? -2 : 0;
  const skin = roleColour(palette, "skin", 1);
  const skinLight = roleColour(palette, "skin", 2);
  const hair = roleColour(palette, "hair", 1);
  const hairLight = roleColour(palette, "hair", 2);
  const shirt = roleColour(palette, "shirtPrimary", 1);
  const shirtLight = roleColour(palette, "shirtPrimary", 2);
  const shirtDark = roleColour(palette, "shirtSecondary", 0);
  const pants = roleColour(palette, "pantsPrimary", 1);
  const boots = roleColour(palette, "boots", 1);
  const accent = roleColour(palette, "accent", 1);
  const svg = part === "head" ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges"><path fill="${hair}" d="M14 28 8 21l9 2-4-10 10 7L24 6l8 11 7-14 2 15 11-8-4 12 10-1-9 9v15H16Z"/><rect x="18" y="25" width="28" height="24" rx="7" fill="${skin}"/><rect x="22" y="31" width="20" height="12" fill="${skinLight}"/><rect x="24" y="35" width="4" height="4" fill="${shirtDark}"/><rect x="36" y="35" width="4" height="4" fill="${shirtDark}"/><path fill="${hairLight}" d="m18 24 7-11 3 9 8-12 2 14Z"/><rect x="28" y="45" width="8" height="8" fill="${shirt}"/></svg>`
    : part === "body" ? `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges"><path fill="${skin}" d="M12 ${12 + movement}h10v10h-4v25H8V34h4ZM42 ${12 - movement}h10v22h4v13H44V22h-2Z"/><rect x="18" y="8" width="28" height="42" rx="5" fill="${shirt}"/><path fill="${shirtLight}" d="M22 12h20v13H22Z"/><path fill="${shirtDark}" d="M18 27h28v23H18Z"/><rect x="26" y="14" width="12" height="28" fill="${accent}"/><rect x="8" y="45" width="10" height="7" rx="2" fill="${skinLight}"/><rect x="46" y="45" width="10" height="7" rx="2" fill="${skinLight}"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" shape-rendering="crispEdges"><path fill="${pants}" d="M16 4h32v27l-5 16H25l-4-16Z"/><path fill="${pants}" d="M22 25h10v28H16l4-16ZM32 25h10l6 16 2 12H36Z"/><path fill="${boots}" d="M16 45h15v10H8v-6ZM37 45h14l9 8v3H37Z"/><rect x="25" y="7" width="14" height="7" fill="${accent}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function createTemplateCharacter(input: { name: string; mode: "template-reference" | "template-random" | "ai"; reference?: Buffer; prompt?: string; id?: string }): Promise<TemplateCharacterResult> {
  const palette = await extractSemanticPalette(input.reference, input.prompt);
  const seed = input.id || `${input.name}|${input.mode}|${Date.now()}|${randomUUID()}`;
  if (input.mode === "template-random" && !input.reference?.length && !input.prompt?.trim()) applyProceduralVariant(palette, seed);
  const id = input.id || createHash("sha1").update(`${seed}|${JSON.stringify(palette)}`).digest("hex").slice(0, 16);
  const parts = { head: [] as CharacterFrame[], body: [] as CharacterFrame[], leg: [] as CharacterFrame[] };
  const canonicalFrameIds: Record<"head" | "body" | "leg", Record<string, string>> = { head: {}, body: {}, leg: {} };
  for (const [part, frameIds] of Object.entries({
    head: [...new Set(nroHumanoidTemplate.poses.map((pose) => pose.headFrame))],
    body: [...new Set(nroHumanoidTemplate.poses.map((pose) => pose.bodyFrame))],
    leg: [...new Set(nroHumanoidTemplate.poses.map((pose) => pose.legFrame))],
  }) as Array<["head" | "body" | "leg", string[]]>) {
    for (const frameId of frameIds) {
      const buffer = await renderPart(part, frameId, palette);
      const digest = createHash("sha1").update(buffer).digest("hex");
      const duplicate = parts[part].find((frame) => frame.buffer && createHash("sha1").update(frame.buffer).digest("hex") === digest);
      const canonicalId = duplicate?.id || frameId;
      canonicalFrameIds[part][frameId] = canonicalId;
      if (!duplicate) parts[part].push({ id: canonicalId, imagePath: `sprites/${part}/${canonicalId}.png`, dx: 0, dy: 0, width: 64, height: 64, buffer });
    }
  }
  const poses: CharacterPoseMapping[] = nroHumanoidTemplate.poses.map((pose) => ({
    ...pose,
    headFrame: canonicalFrameIds.head[pose.headFrame] || pose.headFrame,
    bodyFrame: canonicalFrameIds.body[pose.bodyFrame] || pose.bodyFrame,
    legFrame: canonicalFrameIds.leg[pose.legFrame] || pose.legFrame,
  }));
  const assetBase: CharacterAsset = {
    id,
    name: input.name,
    templateId: nroHumanoidTemplate.id,
    generationMode: input.mode,
    parts: { head: { frames: parts.head }, body: { frames: parts.body }, leg: { frames: parts.leg } },
    poses,
    previewFrames: [],
    // The template engine produces every required MVP frame and a rendered
    // preview, so the adapter can validate this as game-ready immediately.
    status: "game-ready",
    pipeline: { designMaster: input.mode === "ai" ? "ai" : input.mode === "template-reference" ? "reference" : "template", poseSource: "template" },
  };
  const previewFrames = await Promise.all(poses.map(async (pose) => ({ poseId: pose.id, state: pose.state, buffer: await renderCharacterPose(assetBase, pose), width: 64, height: 128 })));
  const asset: CharacterAsset = { ...assetBase, previewFrames };
  return { asset, palette };
}

async function alphaBounds(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: 64_000_000 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width;
  let right = -1;
  let top = info.height;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels + 3] <= 12) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top ? undefined : { left, right, top, bottom, width: info.width, height: info.height };
}

/** Turn an AI design-master image into template-compatible parts once. */
export async function createDesignMasterCharacter(input: { name: string; designMaster: Buffer; prompt?: string; id?: string }): Promise<TemplateCharacterResult> {
  const bounds = await alphaBounds(input.designMaster);
  if (!bounds) throw new Error("Ảnh design master không có silhouette rõ ràng.");
  const height = bounds.bottom - bounds.top + 1;
  const width = bounds.right - bounds.left + 1;
  const source = sharp(input.designMaster, { limitInputPixels: 64_000_000 });
  const ranges = {
    head: [0, 0.34],
    body: [0.25, 0.72],
    leg: [0.6, 1],
  } as const;
  const parts = {} as Record<"head" | "body" | "leg", CharacterFrame[]>;
  for (const part of ["head", "body", "leg"] as const) {
    const [start, end] = ranges[part];
    const top = bounds.top + Math.floor(height * start);
    const cropHeight = Math.max(1, Math.min(bounds.height - top, Math.ceil(height * (end - start))));
    const buffer = await source.clone()
      .extract({ left: bounds.left, top, width, height: cropHeight })
      .resize(64, 64, { fit: "contain", kernel: sharp.kernel.nearest, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, colours: 128 })
      .toBuffer();
    parts[part] = [{ id: `${part}-master`, imagePath: `sprites/${part}/${part}-master.png`, dx: 0, dy: 0, width: 64, height: 64, buffer }];
  }
  const poses: CharacterPoseMapping[] = nroHumanoidTemplate.poses.map((pose) => ({ ...pose, headFrame: "head-master", bodyFrame: "body-master", legFrame: "leg-master" }));
  const id = input.id || createHash("sha1").update(input.name).update(input.designMaster).digest("hex").slice(0, 16);
  const assetBase: CharacterAsset = {
    id,
    name: input.name,
    templateId: nroHumanoidTemplate.id,
    generationMode: "ai",
    parts: { head: { frames: parts.head }, body: { frames: parts.body }, leg: { frames: parts.leg } },
    poses,
    previewFrames: [],
    status: "game-ready",
    pipeline: { designMaster: "ai", poseSource: "template" },
  };
  const previewFrames = await Promise.all(poses.map(async (pose) => ({ poseId: pose.id, state: pose.state, buffer: await renderCharacterPose(assetBase, pose), width: 64, height: 128 })));
  return { asset: { ...assetBase, previewFrames }, palette: await extractSemanticPalette(input.designMaster, input.prompt) };
}
