import { NextResponse } from "next/server";
import { autoModel, discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getSettings, hasOpenAIKey, saveOpenAIKey, saveSettings, type ProviderId } from "@/lib/storage/settings";
import { ensureProjectProfile } from "@/lib/storage/projects";
import type { Locale } from "@/lib/i18n";

export const runtime = "nodejs";

export async function GET() {
  const [settings, apiKeyConfigured] = await Promise.all([getSettings(), hasOpenAIKey()]);
  return NextResponse.json({ ...settings, apiKeyConfigured });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { provider?: ProviderId; apiKey?: string; imageModel?: string; projectRoot?: string; adapterId?: string; locale?: Locale };
    if (body.provider && !["openai", "manual"].includes(body.provider)) {
      return NextResponse.json({ message: "Choose a supported provider." }, { status: 400 });
    }
    let compatibleModels;
    if (body.apiKey?.trim()) {
      try {
        compatibleModels = await discoverImageModels(body.apiKey.trim());
        resolveImageModel(body.imageModel || "auto", compatibleModels);
      } catch (error) {
        const friendlyError = toOpenAIProviderError(error);
        return NextResponse.json({ message: friendlyError.message }, { status: 400 });
      }
      await saveOpenAIKey(body.apiKey);
    }
    const currentSettings = await getSettings();
    const nextProjectRoot = typeof body.projectRoot === "string" ? body.projectRoot.trim() : currentSettings.projectRoot;
    const nextAdapterId = body.adapterId || currentSettings.adapterId;
    if (nextProjectRoot && (body.projectRoot !== undefined || body.adapterId !== undefined)) {
      await ensureProjectProfile(nextProjectRoot, nextAdapterId);
    }
    const settings = await saveSettings({
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.imageModel ? { imageModel: body.imageModel } : {}),
      ...(typeof body.projectRoot === "string" ? { projectRoot: body.projectRoot.trim() } : {}),
      ...(body.adapterId ? { adapterId: body.adapterId } : {}),
      ...(body.locale && ["vi", "en"].includes(body.locale) ? { locale: body.locale } : {}),
    });
    return NextResponse.json({ ...settings, apiKeyConfigured: await hasOpenAIKey(), ...(compatibleModels ? { models: [autoModel, ...compatibleModels] } : {}) });
  } catch (error) {
    console.error("Could not save ContentForge settings", error);
    const message = error instanceof Error && error.message.startsWith("Thư mục game project")
      ? error.message
      : "Không thể lưu cài đặt. Hãy kiểm tra quyền ghi vào thư mục người dùng.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
