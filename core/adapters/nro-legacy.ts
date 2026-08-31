import sharp from "sharp";
import type { NormalizedAsset } from "../assets/types";
import type { CharacterAsset, CharacterFrame } from "@/core/character/types";
import type { AdapterContext, AdapterFile, AdapterOutput, AssetAdapter, ValidationResult } from "./types";
import { getDefaultNormalizeOptions } from "../image/normalize";

const partNames = ["head", "body", "legs"] as const;
const partSize = 64;

function frameForManifest(frame: CharacterFrame) {
  return { id: frame.id, imagePath: frame.imagePath, dx: frame.dx, dy: frame.dy, width: frame.width, height: frame.height };
}

export class NroLegacyAdapter implements AssetAdapter {
  readonly id = "nro-legacy-v1";
  readonly label = "NRO Legacy";
  readonly supportedKinds = ["character", "environment", "item", "effect"] as const;

  getGenerationRecipe(context: AdapterContext) {
    if (context.kind !== "character") return `Create one isolated ${context.kind} sprite on a transparent background.`;
    return [
      "Create one complete, static, full-body design master for a single humanoid game character on a simple transparent or solid background.",
      "Use a front-facing or slight three-quarter standing view. Keep the neck, shoulders, waist or belt, hips, hands, legs, and shoes clearly readable for joint-based part separation.",
      "Keep the complete character centered without cropped hair, hands, or feet, and without labels, grid lines, scenery, duplicate characters, or animation frames.",
    ].join(" ");
  }

  getNormalizeOptions(context: AdapterContext) {
    if (context.kind === "character") {
      return context.provider !== "manual"
        ? { width: partSize * 3, height: partSize, pixelArt: true, paletteColours: 128 }
        : { width: partSize * 3, height: partSize * 3, pixelArt: true, paletteColours: 128, removeSolidBackground: true };
    }
    return getDefaultNormalizeOptions(context.kind);
  }

  async transform(input: NormalizedAsset, context: AdapterContext): Promise<AdapterOutput> {
    if (context.kind !== "character") {
      return {
        adapterId: this.id,
        kind: context.kind,
        files: [{ path: "sprites/asset.png", buffer: input.buffer, mimeType: "image/png" }],
        preview: { buffer: input.buffer, width: input.width, height: input.height, mimeType: "image/png" },
        metadata: { smallImages: [{ id: 0, file: "sprites/asset.png", x: 0, y: 0 }] },
      };
    }

    const horizontal = context.provider !== "manual";
    const extraction = horizontal
      ? { mode: "generated-sheet", regions: partNames.map((_, index) => ({ left: index * partSize, top: 0, width: partSize, height: partSize })) }
      : await this.getManualRegions(input);
    const parts = await Promise.all(partNames.map(async (name, index) => {
      const extracted = await sharp(input.buffer)
        .extract(extraction.regions[index])
        .resize(partSize, partSize, { fit: "contain", kernel: sharp.kernel.nearest, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ palette: true, colours: 128 })
        .toBuffer();
      return { name, buffer: extracted };
    }));

    const atlas = await sharp({ create: { width: partSize * 3, height: partSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: index * partSize, top: 0 })))
      .png({ palette: true, colours: 128 })
      .toBuffer();

    const preview = await sharp({ create: { width: partSize, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(parts.map((part, index) => ({ input: part.buffer, left: 0, top: index * 32 })).reverse())
      .png({ palette: true, colours: 128 })
      .toBuffer();

    const smallImages = parts.map((part, index) => ({
      id: index,
      name: part.name,
      file: `sprites/${part.name}.png`,
      atlas: { x: index * partSize, y: 0, width: partSize, height: partSize },
      pivot: { x: 32, y: part.name === "head" ? 54 : part.name === "body" ? 32 : 10 },
      offset: { x: 0, y: index * 32 },
    }));

    const files: AdapterFile[] = [
      ...parts.map((part) => ({ path: `sprites/${part.name}.png`, buffer: part.buffer, mimeType: "image/png" })),
      { path: "atlas.png", buffer: atlas, mimeType: "image/png" },
      { path: "atlas.json", buffer: Buffer.from(JSON.stringify({ width: 192, height: 64, parts: smallImages }, null, 2)), mimeType: "application/json" },
      { path: "integration/small-images.json", buffer: Buffer.from(JSON.stringify({ format: "nro-small-image-v1", images: smallImages }, null, 2)), mimeType: "application/json" },
    ];

    return {
      adapterId: this.id,
      kind: context.kind,
      files,
      preview: { buffer: preview, width: partSize, height: 128, mimeType: "image/png" },
      metadata: { partSize, layout: "head-body-legs", extractionMode: extraction.mode, smallImages },
    };
  }

  async transformCharacterAsset(asset: CharacterAsset): Promise<AdapterOutput> {
    if (asset.pipeline?.poseSource === "static") return this.transformStaticReference(asset);
    const frames = [...asset.parts.head.frames, ...asset.parts.body.frames, ...asset.parts.leg.frames];
    const files: AdapterFile[] = [];
    for (const part of ["head", "body", "leg"] as const) {
      for (const frame of asset.parts[part].frames) {
        if (!frame.buffer) continue;
        files.push({ path: frame.imagePath, buffer: frame.buffer, mimeType: "image/png" });
      }
    }
    const canonical = (part: "head" | "body" | "leg") => asset.parts[part].frames[0];
    for (const [part, target] of [["head", "sprites/head.png"], ["body", "sprites/body.png"], ["leg", "sprites/legs.png"]] as const) {
      const frame = canonical(part);
      if (frame?.buffer) files.push({ path: target, buffer: frame.buffer, mimeType: "image/png" });
    }
    const atlasColumns = 8;
    const atlasRows = Math.ceil(frames.length / atlasColumns);
    const atlas = await sharp({ create: { width: atlasColumns * partSize, height: Math.max(1, atlasRows) * partSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(frames.flatMap((frame, index) => frame.buffer ? [{ input: frame.buffer, left: (index % atlasColumns) * partSize, top: Math.floor(index / atlasColumns) * partSize }] : []))
      .png({ palette: true, colours: 128 })
      .toBuffer();
    const atlasEntries = frames.map((frame, index) => ({ id: frame.id, file: frame.imagePath, x: (index % atlasColumns) * partSize, y: Math.floor(index / atlasColumns) * partSize, width: partSize, height: partSize, dx: frame.dx, dy: frame.dy }));
    const poseMappings = asset.poses.map((pose) => ({ ...pose }));
    files.push({ path: "atlas.png", buffer: atlas, mimeType: "image/png" });
    files.push({ path: "preview/character.png", buffer: asset.previewFrames[0].buffer, mimeType: "image/png" });
    files.push({ path: "atlas.json", buffer: Buffer.from(JSON.stringify({ width: atlasColumns * partSize, height: atlasRows * partSize, frames: atlasEntries }, null, 2)), mimeType: "application/json" });
    files.push({ path: "game/character.json", buffer: Buffer.from(JSON.stringify({ type: "character", template: asset.templateId, generation: { mode: asset.generationMode === "ai" ? "ai" : "template" }, pipeline: asset.pipeline, status: asset.status, direction: { canonical: "right", mirror: "horizontal" }, animations: [...new Set(poseMappings.map((pose) => pose.state))], parts: { head: asset.parts.head.frames.map(frameForManifest), body: asset.parts.body.frames.map(frameForManifest), leg: asset.parts.leg.frames.map(frameForManifest) }, poses: poseMappings }, null, 2)), mimeType: "application/json" });
    files.push({ path: "game/parts.json", buffer: Buffer.from(JSON.stringify({ template: asset.templateId, parts: ["head", "body", "leg"], direction: { canonical: "right", mirror: "horizontal" }, poses: poseMappings }, null, 2)), mimeType: "application/json" });
    files.push({ path: "integration/small-images.json", buffer: Buffer.from(JSON.stringify({ format: "nro-small-image-v2", images: atlasEntries, poses: poseMappings }, null, 2)), mimeType: "application/json" });
    return {
      adapterId: this.id,
      kind: "character",
      files,
      preview: { buffer: asset.previewFrames[0].buffer, width: 64, height: 128, mimeType: "image/png" },
      previewFrames: asset.previewFrames,
      metadata: { characterAsset: true, templateId: asset.templateId, status: asset.status, pipeline: asset.pipeline, poseMappings, frameCount: frames.length, smallImages: atlasEntries },
    };
  }

  private async transformStaticReference(asset: CharacterAsset): Promise<AdapterOutput> {
    const head = asset.parts.head.frames[0];
    const body = asset.parts.body.frames[0];
    const leg = asset.parts.leg.frames[0];
    const preview = asset.previewFrames[0];
    if (!head?.buffer || !body?.buffer || !leg?.buffer || !preview?.buffer) {
      throw new Error("Ảnh nguồn chưa thể tách đủ HEAD, BODY và LEG.");
    }
    const manifest = {
      type: "character",
      status: asset.status,
      parts: {
        head: "sprites/head.png",
        body: "sprites/body.png",
        leg: "sprites/leg.png",
      },
    };
    const files: AdapterFile[] = [
      { path: "sprites/head.png", buffer: head.buffer, mimeType: "image/png" },
      { path: "sprites/body.png", buffer: body.buffer, mimeType: "image/png" },
      { path: "sprites/leg.png", buffer: leg.buffer, mimeType: "image/png" },
      { path: "preview/character.png", buffer: preview.buffer, mimeType: "image/png" },
      { path: "manifest.json", buffer: Buffer.from(JSON.stringify(manifest, null, 2)), mimeType: "application/json" },
    ];
    return {
      adapterId: this.id,
      kind: "character",
      files,
      preview: { buffer: preview.buffer, width: preview.width, height: preview.height, mimeType: "image/png" },
      metadata: {
        characterAsset: true,
        staticReference: true,
        templateId: asset.templateId,
        status: asset.status,
        pipeline: asset.pipeline,
        referenceAnalysis: asset.referenceAnalysis,
        frameCount: 3,
        partFiles: manifest.parts,
      },
    };
  }

  private async getManualRegions(input: NormalizedAsset) {
    const { data, info } = await sharp(input.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
    if (right < left || bottom < top) throw new Error("Ảnh nguồn không có chủ thể rõ ràng sau khi tách nền.");

    const height = bottom - top + 1;
    const isVerticalSheet = input.sourceWidth / input.sourceHeight <= 0.42;
    const ranges = isVerticalSheet
      ? [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]
      : [[0, 0.28], [0.24, 0.64], [0.55, 1]];
    const regions = ranges.map(([start, end]) => {
      const regionTop = top + Math.floor(height * start);
      const regionBottom = Math.min(info.height, top + Math.ceil(height * end));
      let regionLeft = right;
      let regionRight = left;
      for (let y = regionTop; y < regionBottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          if (data[(y * info.width + x) * info.channels + 3] <= 12) continue;
          regionLeft = Math.min(regionLeft, x);
          regionRight = Math.max(regionRight, x);
        }
      }
      const padding = 2;
      regionLeft = Math.max(0, regionLeft - padding);
      regionRight = Math.min(info.width - 1, regionRight + padding);
      return { left: regionLeft, top: regionTop, width: Math.max(1, regionRight - regionLeft + 1), height: Math.max(1, regionBottom - regionTop) };
    });
    return { mode: isVerticalSheet ? "vertical-parts-sheet" : "foreground-body-zones", regions };
  }

  async validate(output: AdapterOutput): Promise<ValidationResult> {
    if (output.kind !== "character") {
      const spriteReady = output.files.some((file) => file.path === "sprites/asset.png" && file.mimeType === "image/png");
      return {
        ready: spriteReady,
        status: spriteReady ? "game-ready" : "draft",
        checks: [
          { id: "format", label: "Định dạng PNG hợp lệ", passed: spriteReady },
          { id: "sprite", label: "Sprite NRO đã tạo", passed: spriteReady },
          { id: "metadata", label: "Metadata SmallImage đã tạo", passed: Array.isArray(output.metadata.smallImages) },
        ],
      };
    }
    if (output.metadata.staticReference === true) {
      const available = new Set(output.files.map((file) => file.path));
      const requiredParts = ["sprites/head.png", "sprites/body.png", "sprites/leg.png"];
      const partsPresent = requiredParts.every((path) => available.has(path));
      const partChecks = await Promise.all(requiredParts.map(async (path) => {
        const file = output.files.find((candidate) => candidate.path === path);
        if (!file) return { visible: false, transparent: false, sized: false };
        try {
          const { data, info } = await sharp(file.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          let visible = 0;
          let transparent = false;
          for (let offset = 0; offset < data.length; offset += info.channels) {
            if (data[offset + 3] > 12) visible += 1;
            if (data[offset + 3] < 250) transparent = true;
          }
          return { visible: visible >= 12, transparent, sized: info.width === 64 && info.height === 64 };
        } catch {
          return { visible: false, transparent: false, sized: false };
        }
      }));
      const analysis = output.metadata.referenceAnalysis as CharacterAsset["referenceAnalysis"] | undefined;
      const backgroundReady = analysis?.backgroundRemoved === true;
      const sourceComplete = analysis?.sourceComplete === true;
      const partsReady = partsPresent && partChecks.every((check) => check.visible && check.sized);
      const transparencyReady = partChecks.every((check) => check.transparent);
      const headJointReady = analysis?.headJointReady === true;
      const bodyJointReady = analysis?.bodyJointReady === true;
      const legJointReady = analysis?.legJointReady === true;
      const previewReady = available.has("preview/character.png") && output.preview.width === 64 && output.preview.height === 128;
      const similarityReady = typeof analysis?.similarity === "number" && analysis.similarity >= 0.985;
      const manifestReady = available.has("manifest.json");
      const ready = backgroundReady && sourceComplete && partsReady && transparencyReady && headJointReady && bodyJointReady && legJointReady && previewReady && similarityReady && manifestReady;
      return {
        ready,
        status: ready ? "static-ready" : "draft",
        checks: [
          { id: "source-complete", label: "Ảnh nguồn giữ đủ đầu, tay và chân", passed: sourceComplete },
          { id: "background", label: "Nền đã được làm trong suốt", passed: backgroundReady && transparencyReady },
          { id: "head-joint", label: "HEAD kết thúc tại cổ, không chứa vai", passed: partsReady && headJointReady },
          { id: "body-joint", label: "BODY giữ vai, thân, tay và bàn tay", passed: partsReady && bodyJointReady },
          { id: "leg-joint", label: "LEG bắt đầu tại vùng hông hoặc đai dưới", passed: partsReady && legJointReady },
          { id: "similarity", label: "Preview giữ màu và silhouette của ảnh gốc", passed: similarityReady },
          { id: "preview", label: "Preview được ghép lại từ ba part", passed: previewReady },
          { id: "manifest", label: "Manifest static đã tạo", passed: manifestReady },
        ],
      };
    }
    const required = ["sprites/head.png", "sprites/body.png", "sprites/legs.png", "atlas.png", "integration/small-images.json"];
    const available = new Set(output.files.map((file) => file.path));
    const partsReady = required.every((path) => available.has(path));
    const isCharacterAsset = output.metadata.characterAsset === true;
    const requiredStates = ["idle", "run", "jump", "fall", "attack", "hurt"];
    const poseMappings = Array.isArray(output.metadata.poseMappings) ? output.metadata.poseMappings as Array<{ state?: string; headFrame?: string; bodyFrame?: string; legFrame?: string; headOffset?: { x?: number; y?: number }; bodyOffset?: { x?: number; y?: number }; legOffset?: { x?: number; y?: number } }> : [];
    const posesReady = requiredStates.every((state) => poseMappings.some((pose) => pose.state === state));
    const frameCount = Number(output.metadata.frameCount || 0);
    const atlasFrames = Array.isArray(output.metadata.smallImages) ? output.metadata.smallImages as Array<{ id?: string; width?: number; height?: number }> : [];
    const frameRefsReady = poseMappings.every((pose) => [pose.headFrame, pose.bodyFrame, pose.legFrame].every((frameId) => typeof frameId === "string" && atlasFrames.some((frame) => frame.id === frameId)));
    const offsetsReady = poseMappings.every((pose) => [pose.headOffset, pose.bodyOffset, pose.legOffset].every((offset) => typeof offset?.x === "number" && typeof offset?.y === "number" && Math.abs(offset.x) <= partSize && Math.abs(offset.y) <= partSize));
    const templateReady = output.metadata.templateId === "nro-humanoid-v1";
    const formatReady = output.files.filter((file) => file.mimeType === "image/png").length >= 4;
    const metadataReady = available.has("integration/small-images.json");
    const manifestReady = available.has("game/character.json") && available.has("game/parts.json");
    const sizeReady = output.preview.width === 64 && output.preview.height === 128 && atlasFrames.filter((frame) => frame.width === partSize && frame.height === partSize).length >= Math.min(frameCount, 3);
    const transparentFrames = await Promise.all(output.files.filter((file) => file.path.startsWith("sprites/") && file.path.endsWith(".png")).slice(0, frameCount).map(async (file) => {
      try {
        const { data, info } = await sharp(file.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        return Array.from({ length: Math.floor(data.length / info.channels) }, (_, index) => data[index * info.channels + 3]).some((alpha) => alpha < 250);
      } catch {
        return false;
      }
    }));
    const transparencyReady = transparentFrames.length >= 3 && transparentFrames.every(Boolean);
    const playable = isCharacterAsset && frameCount >= 3 && frameRefsReady && offsetsReady && ["idle", "run", "jump", "fall"].every((state) => poseMappings.some((pose) => pose.state === state));
    const gameReady = isCharacterAsset && formatReady && metadataReady && manifestReady && templateReady && partsReady && posesReady && playable && sizeReady && transparencyReady && Boolean(output.previewFrames?.length);
    const ready = isCharacterAsset ? gameReady : partsReady;
    return {
      ready,
      status: isCharacterAsset ? (gameReady ? "game-ready" : playable ? "playable" : "draft") : partsReady ? "game-ready" : "draft",
      checks: [
        { id: "format", label: "Định dạng PNG hợp lệ", passed: output.files.filter((file) => file.mimeType === "image/png").length >= 4 },
        { id: "parts", label: "Đủ bộ phận HEAD, BODY, LEGS", passed: partsReady },
          { id: "metadata", label: "Dữ liệu SmallImage đã tạo", passed: available.has("integration/small-images.json") },
        ...(isCharacterAsset ? [
          { id: "frame-mapping", label: "Frame references and offsets", passed: frameRefsReady && offsetsReady },
          { id: "bounds", label: "Frame bounds", passed: sizeReady },
          { id: "transparent", label: "Transparent frame", passed: transparencyReady },
          { id: "template", label: "Template humanoid hợp lệ", passed: output.metadata.templateId === "nro-humanoid-v1" },
          { id: "poses", label: "Đủ animation IDLE, RUN, JUMP, FALL, ATTACK, HURT", passed: posesReady },
          { id: "frames", label: "Frame và offset đã ánh xạ", passed: frameCount >= 3 && poseMappings.every((pose) => typeof pose.state === "string") },
          { id: "preview", label: "Preview ghép từ output thật", passed: Boolean(output.previewFrames?.length) },
        ] : []),
      ],
    };
  }
}
