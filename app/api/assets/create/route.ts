import { NextResponse } from "next/server";
import { assetKinds, type AssetKind } from "@/core/assets/types";
import { ManualImageProvider } from "@/core/providers/manual-provider";
import { OpenAIImageProvider } from "@/core/providers/openai-provider";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { getOpenAIKey, getSettings } from "@/lib/storage/settings";

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
    if (settings.provider === "manual") {
      const visual = await new ManualImageProvider().generate({ kind, prompt, referenceImage, referenceMimeType });
      return NextResponse.json({ image: { base64: visual.buffer.toString("base64"), mimeType: visual.mimeType }, source: { provider: visual.provider } });
    }

    if (!prompt && !referenceImage) return NextResponse.json({ message: "Hãy thêm ý tưởng hoặc ảnh tham chiếu." }, { status: 400 });
    const apiKey = await getOpenAIKey();
    if (!apiKey) return NextResponse.json({ message: "Hãy thêm khóa OpenAI trong Cài đặt trước khi tạo ảnh." }, { status: 400 });
    const availableModels = await discoverImageModels(apiKey);
    const model = resolveImageModel(settings.imageModel, availableModels);
    const visual = await new OpenAIImageProvider(apiKey).generate({ kind, prompt, referenceImage, referenceMimeType, model });
    return NextResponse.json({
      image: { base64: visual.buffer.toString("base64"), mimeType: visual.mimeType },
      source: { provider: visual.provider, model: visual.model },
    });
  } catch (error) {
    const friendlyError = toOpenAIProviderError(error);
    console.error("Asset generation failed", friendlyError.developerMessage || error);
    return NextResponse.json({ message: friendlyError.message }, { status: 400 });
  }
}
