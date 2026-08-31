import { NextResponse } from "next/server";
import { assetKinds, type AssetKind } from "@/core/assets/types";
import { getAdapter } from "@/core/adapters";
import { normalizeImage } from "@/core/image/normalize";
import { generateVisual } from "@/core/providers/generate";
import { createCharacter, createCharacterRequestHash, hasCharacterAiAccess } from "@/core/character/creation-service";
import { createReferenceStaticCharacter } from "@/core/character/reference-first";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getSettings } from "@/lib/storage/settings";
import { findCachedGeneration, getGeneration, saveGeneration } from "@/lib/storage/generations";
import { readFile } from "node:fs/promises";
import { safeJoin } from "@/lib/fs/safe-path";
import sharp from "sharp";

export const runtime = "nodejs";
const maxUploadBytes = 10 * 1024 * 1024;
const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const kind = String(form.get("kind") || "character") as AssetKind;
    const splitSourceId = String(form.get("splitSourceId") || "").trim();
    const requestedNeck = Number(form.get("neckLine"));
    const requestedHip = Number(form.get("hipLine"));
    const splitLines = Number.isFinite(requestedNeck) && Number.isFinite(requestedHip) && requestedNeck >= 0.15 && requestedNeck <= 0.45 && requestedHip >= 0.48 && requestedHip <= 0.78 && requestedHip - requestedNeck >= 0.12
      ? { neck: requestedNeck, hip: requestedHip }
      : undefined;
    const reference = form.get("reference");
    if (!assetKinds.includes(kind)) return NextResponse.json({ message: "Loại tài nguyên không được hỗ trợ." }, { status: 400 });

    let referenceImage: Buffer | undefined;
    let referenceMimeType: string | undefined;
    if (reference instanceof File && reference.size > 0) {
      if (!supportedMimeTypes.has(reference.type)) return NextResponse.json({ message: "Hãy dùng ảnh PNG, JPEG hoặc WebP." }, { status: 400 });
      if (reference.size > maxUploadBytes) return NextResponse.json({ message: "Ảnh nguồn phải nhỏ hơn 10 MB." }, { status: 400 });
      referenceImage = Buffer.from(await reference.arrayBuffer());
      referenceMimeType = reference.type;
    }

    const settings = await getSettings();
    const adapter = getAdapter(settings.adapterId);
    if (!adapter.supportedKinds.includes(kind)) return NextResponse.json({ message: "Adapter hiện tại không hỗ trợ loại tài nguyên này." }, { status: 400 });
    const context = { kind, provider: settings.provider } as const;
    const generationRecipe = adapter.getGenerationRecipe(context);
    const characterPipeline = kind === "character" && typeof adapter.transformCharacterAsset === "function";
    if (!characterPipeline && settings.provider !== "manual" && !prompt && !referenceImage) {
      return NextResponse.json({ message: "Hãy thêm ý tưởng hoặc ảnh tham chiếu." }, { status: 400 });
    }
    let visual;
    let normalized;
    let output;
    let characterAsset;
    let creationMode;
    let intermediate;
    let requestHash: string | undefined;
    let generationName = prompt || `${kind}-asset`;
    if (characterPipeline && splitSourceId) {
      const previous = await getGeneration(splitSourceId);
      if (previous.record.kind !== "character" || previous.record.character?.pipeline?.poseSource !== "static") {
        return NextResponse.json({ message: "Kết quả này không hỗ trợ chỉnh lại đường tách." }, { status: 400 });
      }
      if (!splitLines) return NextResponse.json({ message: "Đường cổ và đường hông không hợp lệ." }, { status: 400 });
      const [processedBuffer, sourceBuffer] = await Promise.all([
        readFile(safeJoin(previous.root, previous.record.visual.file)),
        readFile(safeJoin(previous.root, previous.record.source.file)),
      ]);
      const processedMetadata = await sharp(processedBuffer).metadata();
      const previousAnalysis = previous.record.adapter.metadata.referenceAnalysis as { backgroundRemoved?: boolean; sourceComplete?: boolean } | undefined;
      const previousMode = previous.record.character.generationMode === "ai" ? "ai" : "reference-static";
      const split = await createReferenceStaticCharacter({
        name: previous.record.name,
        processed: processedBuffer,
        backgroundRemoved: previousAnalysis?.backgroundRemoved === true,
        sourceComplete: previousAnalysis?.sourceComplete === true,
        generationMode: previousMode,
        designMaster: previousMode === "ai" ? "ai" : "reference",
        splitLines,
      });
      generationName = previous.record.name;
      visual = {
        buffer: sourceBuffer,
        mimeType: previous.record.source.file.endsWith(".jpg") ? "image/jpeg" : previous.record.source.file.endsWith(".webp") ? "image/webp" : "image/png",
        provider: previous.record.source.provider,
        model: previous.record.source.model,
      };
      normalized = {
        buffer: processedBuffer,
        width: processedMetadata.width || previous.record.visual.width,
        height: processedMetadata.height || previous.record.visual.height,
        format: "png" as const,
        hasAlpha: true,
        sourceWidth: previous.record.visual.width,
        sourceHeight: previous.record.visual.height,
      };
      characterAsset = split.asset;
      creationMode = previousMode;
      output = await adapter.transformCharacterAsset!(characterAsset, context);
    } else {
      const aiAccess = characterPipeline ? await hasCharacterAiAccess(settings) : false;
      requestHash = characterPipeline
        ? createCharacterRequestHash({ prompt, referenceImage, settings, generationRecipe, aiAccess, splitLines })
        : undefined;
      const aiCacheEligible = settings.provider !== "manual" && (settings.creationMode === "ai" || (aiAccess && Boolean(prompt || referenceImage)));
      if (characterPipeline && aiCacheEligible && requestHash) {
        const cached = await findCachedGeneration(requestHash);
        if (cached) {
          const preview = await readFile(safeJoin(cached.root, cached.record.preview.file));
          const staticCached = cached.record.character?.pipeline?.poseSource === "static";
          const animation = staticCached ? [] : await Promise.all((cached.record.previewFrames || []).map(async (frame) => ({
            poseId: frame.poseId,
            state: frame.state,
            base64: (await readFile(safeJoin(cached.root, frame.file))).toString("base64"),
            mimeType: frame.mimeType,
            width: frame.width,
            height: frame.height,
          })));
          const [cachedSource, cachedProcessed] = staticCached ? await Promise.all([
            readFile(safeJoin(cached.root, cached.record.source.file)),
            readFile(safeJoin(cached.root, cached.record.visual.file)),
          ]) : [undefined, undefined];
          const analysis = cached.record.adapter.metadata.referenceAnalysis as { splitLines?: { neck: number; hip: number } } | undefined;
          return NextResponse.json({
            generationId: cached.record.id,
            cached: true,
            image: { base64: preview.toString("base64"), mimeType: cached.record.preview.mimeType, width: cached.record.preview.width, height: cached.record.preview.height },
            ...(staticCached && cachedSource && cachedProcessed ? {
              sourceImage: { base64: cachedSource.toString("base64"), mimeType: cached.record.source.file.endsWith(".jpg") ? "image/jpeg" : cached.record.source.file.endsWith(".webp") ? "image/webp" : "image/png" },
              processedImage: { base64: cachedProcessed.toString("base64"), mimeType: "image/png", width: cached.record.visual.width, height: cached.record.visual.height },
              splitLines: analysis?.splitLines,
            } : {}),
            source: cached.record.source,
            adapter: { id: cached.record.adapter.id, label: adapter.label },
            validation: cached.record.validation,
            asset: cached.record.template ? { templateId: cached.record.template, generationMode: cached.record.character?.generationMode || cached.record.generation?.detail, pipeline: cached.record.character?.pipeline, status: cached.record.status, animationStates: cached.record.animations || [] } : undefined,
            animation,
          });
        }
      }
      if (characterPipeline) {
        const creation = await createCharacter({ name: generationName, prompt, referenceImage, referenceMimeType, settings, generationRecipe, splitLines });
        visual = creation.visual;
        normalized = creation.normalized;
        characterAsset = creation.asset;
        creationMode = creation.mode;
        intermediate = creation.poseSheet ? { poseSheet: creation.poseSheet } : undefined;
        output = await adapter.transformCharacterAsset!(characterAsset, context);
      } else {
        if (settings.provider === "manual" && !referenceImage) return NextResponse.json({ message: "Hãy thêm ảnh nguồn để xử lý Không AI." }, { status: 400 });
        visual = await generateVisual(settings.provider, {
          settings,
          kind,
          prompt,
          referenceImage,
          referenceMimeType,
          generationRecipe,
        });
        normalized = await normalizeImage(visual.buffer, adapter.getNormalizeOptions(context));
        output = await adapter.transform(normalized, context);
      }
    }
    const validation = await adapter.validate(output);
    const staticReference = characterAsset?.pipeline?.poseSource === "static";
    if (!validation.ready && !staticReference) return NextResponse.json({ message: "Ảnh này chưa thể chuyển đổi an toàn cho game profile đã chọn. Hãy thử ảnh khác." }, { status: 422 });
    const generation = await saveGeneration({ name: generationName, kind, source: visual, normalized, output, validation, characterAsset, creationMode, requestHash, intermediate });
    return NextResponse.json({
      generationId: generation.id,
      image: { base64: output.preview.buffer.toString("base64"), mimeType: output.preview.mimeType, width: output.preview.width, height: output.preview.height },
      ...(staticReference ? {
        sourceImage: { base64: visual.buffer.toString("base64"), mimeType: visual.mimeType },
        processedImage: { base64: normalized.buffer.toString("base64"), mimeType: "image/png", width: normalized.width, height: normalized.height },
        splitLines: characterAsset?.referenceAnalysis?.splitLines,
      } : {}),
      source: { provider: visual.provider, model: visual.model },
      adapter: { id: output.adapterId, label: adapter.label },
      validation,
      asset: characterAsset ? { templateId: characterAsset.templateId, generationMode: characterAsset.generationMode, pipeline: characterAsset.pipeline, status: validation.status, animationStates: staticReference ? [] : [...new Set(characterAsset.poses.map((pose) => pose.state))] } : undefined,
      animation: output.previewFrames?.map((frame) => ({ poseId: frame.poseId, state: frame.state, base64: frame.buffer.toString("base64"), mimeType: "image/png", width: frame.width, height: frame.height })),
    });
  } catch (error) {
    if (error instanceof Error && /^(Ảnh nguồn|Ảnh tham chiếu|Không thể xác định|Thêm ảnh nguồn|Đường dẫn|Hãy|Kết quả)/.test(error.message)) {
      console.error("Deterministic asset processing failed", error);
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === "NineRouterError") {
      console.error("9Router asset generation failed", error);
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === "CodexOAuthError") {
      console.error("Codex OAuth asset generation failed", error);
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    const friendlyError = toOpenAIProviderError(error);
    console.error("Asset generation failed", friendlyError.developerMessage || error);
    return NextResponse.json({ message: friendlyError.message }, { status: 400 });
  }
}
