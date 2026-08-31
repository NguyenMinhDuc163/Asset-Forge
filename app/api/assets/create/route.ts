import { NextResponse } from "next/server";
import { assetKinds, type AssetKind } from "@/core/assets/types";
import { getAdapter } from "@/core/adapters";
import { normalizeImage } from "@/core/image/normalize";
import { generateVisual } from "@/core/providers/generate";
import { createCharacter, createCharacterRequestHash, hasCharacterAiAccess } from "@/core/character/creation-service";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getSettings } from "@/lib/storage/settings";
import { findCachedGeneration, saveGeneration } from "@/lib/storage/generations";
import { readFile } from "node:fs/promises";
import { safeJoin } from "@/lib/fs/safe-path";

export const runtime = "nodejs";
const maxUploadBytes = 10 * 1024 * 1024;
const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const kind = String(form.get("kind") || "character") as AssetKind;
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
    const aiAccess = characterPipeline ? await hasCharacterAiAccess(settings) : false;
    const requestHash = characterPipeline
      ? createCharacterRequestHash({ prompt, referenceImage, settings, generationRecipe, aiAccess })
      : undefined;
    const aiCacheEligible = settings.provider !== "manual" && (settings.creationMode === "ai" || (aiAccess && Boolean(prompt || referenceImage)));
    if (characterPipeline && aiCacheEligible && requestHash) {
      const cached = await findCachedGeneration(requestHash);
      if (cached) {
        const preview = await readFile(safeJoin(cached.root, cached.record.preview.file));
        const animation = await Promise.all((cached.record.previewFrames || []).map(async (frame) => ({
          poseId: frame.poseId,
          state: frame.state,
          base64: (await readFile(safeJoin(cached.root, frame.file))).toString("base64"),
          mimeType: frame.mimeType,
          width: frame.width,
          height: frame.height,
        })));
        return NextResponse.json({
          generationId: cached.record.id,
          cached: true,
          image: { base64: preview.toString("base64"), mimeType: cached.record.preview.mimeType, width: cached.record.preview.width, height: cached.record.preview.height },
          source: cached.record.source,
          adapter: { id: cached.record.adapter.id, label: adapter.label },
          validation: cached.record.validation,
          asset: cached.record.template ? { templateId: cached.record.template, generationMode: cached.record.character?.generationMode || cached.record.generation?.detail, pipeline: cached.record.character?.pipeline, status: cached.record.status, animationStates: cached.record.animations || [] } : undefined,
          animation,
        });
      }
    }
    if (characterPipeline) {
      const creation = await createCharacter({ name: prompt || `${kind}-asset`, prompt, referenceImage, referenceMimeType, settings, generationRecipe });
      visual = creation.visual;
      normalized = creation.normalized;
      characterAsset = creation.asset;
      creationMode = creation.mode;
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
    const validation = await adapter.validate(output);
    if (!validation.ready) return NextResponse.json({ message: "Ảnh này chưa thể chuyển đổi an toàn cho game profile đã chọn. Hãy thử ảnh khác." }, { status: 422 });
    const generation = await saveGeneration({ name: prompt || `${kind}-asset`, kind, source: visual, normalized, output, validation, characterAsset, creationMode, requestHash });
    return NextResponse.json({
      generationId: generation.id,
      image: { base64: output.preview.buffer.toString("base64"), mimeType: output.preview.mimeType, width: output.preview.width, height: output.preview.height },
      source: { provider: visual.provider, model: visual.model },
      adapter: { id: output.adapterId, label: adapter.label },
      validation,
      asset: characterAsset ? { templateId: characterAsset.templateId, generationMode: characterAsset.generationMode, pipeline: characterAsset.pipeline, status: validation.status, animationStates: [...new Set(characterAsset.poses.map((pose) => pose.state))] } : undefined,
      animation: output.previewFrames?.map((frame) => ({ poseId: frame.poseId, state: frame.state, base64: frame.buffer.toString("base64"), mimeType: "image/png", width: frame.width, height: frame.height })),
    });
  } catch (error) {
    if (error instanceof Error && /^(Ảnh nguồn|Ảnh tham chiếu|Không thể xác định|Thêm ảnh nguồn|Đường dẫn|Hãy)/.test(error.message)) {
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
