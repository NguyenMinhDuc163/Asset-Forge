import { NextResponse } from "next/server";
import { assetKinds, type AssetKind } from "@/core/assets/types";
import { getAdapter } from "@/core/adapters";
import { normalizeImage } from "@/core/image/normalize";
import { ManualImageProvider } from "@/core/providers/manual-provider";
import { OpenAIImageProvider } from "@/core/providers/openai-provider";
import { CodexOAuthImageProvider } from "@/core/providers/codex-oauth-provider";
import { NineRouterImageProvider } from "@/core/providers/nine-router-provider";
import type { GeneratedVisual } from "@/core/providers/types";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { discoverNineRouterImageModels } from "@/lib/nine-router/client";
import { codexImageModels } from "@/lib/codex/client";
import { getNineRouterKey, getOpenAIKey, getSettings } from "@/lib/storage/settings";
import { saveGeneration } from "@/lib/storage/generations";

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
    let visual: GeneratedVisual;
    if (settings.provider === "manual") {
      visual = await new ManualImageProvider().generate({ kind, prompt, referenceImage, referenceMimeType });
    } else if (settings.provider === "openai") {
      if (!prompt && !referenceImage) return NextResponse.json({ message: "Hãy thêm ý tưởng hoặc ảnh tham chiếu." }, { status: 400 });
      if (settings.openaiAuthMode === "codex-oauth") {
        const model = settings.imageModel === "auto" ? codexImageModels[0].id : settings.imageModel;
        visual = await new CodexOAuthImageProvider().generate({ kind, prompt, referenceImage, referenceMimeType, model, generationRecipe });
      } else {
        const apiKey = await getOpenAIKey();
        if (!apiKey) return NextResponse.json({ message: "Hãy thêm khóa OpenAI trong Cài đặt trước khi tạo ảnh." }, { status: 400 });
        const availableModels = await discoverImageModels(apiKey);
        const model = resolveImageModel(settings.imageModel, availableModels);
        visual = await new OpenAIImageProvider(apiKey).generate({ kind, prompt, referenceImage, referenceMimeType, model, generationRecipe });
      }
    } else {
      if (!prompt && !referenceImage) return NextResponse.json({ message: "Hãy thêm ý tưởng hoặc ảnh tham chiếu." }, { status: 400 });
      const apiKey = await getNineRouterKey();
      const availableModels = await discoverNineRouterImageModels(settings.nineRouterUrl, apiKey);
      const model = settings.imageModel === "auto" ? availableModels[0]?.id : settings.imageModel;
      if (!model) return NextResponse.json({ message: "Hãy nhập model ảnh 9Router." }, { status: 400 });
      visual = await new NineRouterImageProvider(settings.nineRouterUrl, apiKey).generate({ kind, prompt, referenceImage, referenceMimeType, model, generationRecipe });
    }
    const normalized = await normalizeImage(visual.buffer, adapter.getNormalizeOptions(context));
    const output = await adapter.transform(normalized, context);
    const validation = await adapter.validate(output);
    if (!validation.ready) return NextResponse.json({ message: "Ảnh này chưa thể chuyển đổi an toàn cho game profile đã chọn. Hãy thử ảnh khác." }, { status: 422 });
    const generation = await saveGeneration({ name: prompt || `${kind}-asset`, kind, source: visual, normalized, output, validation });
    return NextResponse.json({
      generationId: generation.id,
      image: { base64: output.preview.buffer.toString("base64"), mimeType: output.preview.mimeType, width: output.preview.width, height: output.preview.height },
      source: { provider: visual.provider, model: visual.model },
      adapter: { id: output.adapterId, label: adapter.label },
      validation,
    });
  } catch (error) {
    if (error instanceof Error && /^(Ảnh nguồn|Không thể xác định|Thêm ảnh nguồn|Đường dẫn)/.test(error.message)) {
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
