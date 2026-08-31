import { NextResponse } from "next/server";
import { autoModel, discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { discoverNineRouterImageModels, NineRouterError, normalizeNineRouterUrl } from "@/lib/nine-router/client";
import { getNineRouterKey, getSettings, hasNineRouterKey, hasOpenAIKey, saveNineRouterKey, saveOpenAIKey, saveSettings, type ProviderId, type ThemePreference } from "@/lib/storage/settings";
import { ensureProjectProfile } from "@/lib/storage/projects";
import type { Locale } from "@/lib/i18n";

export const runtime = "nodejs";

export async function GET() {
  const [settings, apiKeyConfigured, nineRouterKeyConfigured] = await Promise.all([getSettings(), hasOpenAIKey(), hasNineRouterKey()]);
  return NextResponse.json({ ...settings, apiKeyConfigured, nineRouterKeyConfigured });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { provider?: ProviderId; apiKey?: string; nineRouterApiKey?: string; nineRouterUrl?: string; imageModel?: string; projectRoot?: string; adapterId?: string; locale?: Locale; theme?: ThemePreference };
    if (body.provider && !["openai", "nine-router", "manual"].includes(body.provider)) {
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
    const nextProvider = body.provider || currentSettings.provider;
    let nextNineRouterUrl = currentSettings.nineRouterUrl;
    if (body.nineRouterUrl !== undefined) nextNineRouterUrl = normalizeNineRouterUrl(body.nineRouterUrl);
    if (nextProvider === "nine-router" && (body.provider !== undefined || body.nineRouterUrl !== undefined || body.nineRouterApiKey !== undefined || body.imageModel !== undefined)) {
      try {
        const storedKey = await getNineRouterKey();
        const key = body.nineRouterApiKey?.trim() || storedKey;
        compatibleModels = await discoverNineRouterImageModels(nextNineRouterUrl, key);
        if (body.imageModel && body.imageModel !== "auto" && !compatibleModels.some((model) => model.id === body.imageModel)) {
          return NextResponse.json({ message: "Model ảnh đã chọn không có trong 9Router." }, { status: 400 });
        }
      } catch (error) {
        const message = error instanceof NineRouterError ? error.message : error instanceof Error ? error.message : "Không thể kết nối 9Router.";
        return NextResponse.json({ message }, { status: 400 });
      }
      if (body.nineRouterApiKey?.trim()) await saveNineRouterKey(body.nineRouterApiKey);
    }
    const nextProjectRoot = typeof body.projectRoot === "string" ? body.projectRoot.trim() : currentSettings.projectRoot;
    const nextAdapterId = body.adapterId || currentSettings.adapterId;
    if (nextProjectRoot && (body.projectRoot !== undefined || body.adapterId !== undefined)) {
      await ensureProjectProfile(nextProjectRoot, nextAdapterId);
    }
    const settings = await saveSettings({
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.imageModel ? { imageModel: body.imageModel } : {}),
      ...(body.nineRouterUrl !== undefined ? { nineRouterUrl: nextNineRouterUrl } : {}),
      ...(typeof body.projectRoot === "string" ? { projectRoot: body.projectRoot.trim() } : {}),
      ...(body.adapterId ? { adapterId: body.adapterId } : {}),
      ...(body.locale && ["vi", "en"].includes(body.locale) ? { locale: body.locale } : {}),
      ...(body.theme && ["light", "dark", "system"].includes(body.theme) ? { theme: body.theme } : {}),
    });
    const [apiKeyConfigured, nineRouterKeyConfigured] = await Promise.all([hasOpenAIKey(), hasNineRouterKey()]);
    const returnedModels = compatibleModels
      ? [autoModel, ...compatibleModels]
      : undefined;
    return NextResponse.json({ ...settings, apiKeyConfigured, nineRouterKeyConfigured, ...(returnedModels ? { models: returnedModels } : {}) });
  } catch (error) {
    console.error("Could not save ContentForge settings", error);
    const message = error instanceof Error && error.message.startsWith("Thư mục game project")
      ? error.message
      : "Không thể lưu cài đặt. Hãy kiểm tra quyền ghi vào thư mục người dùng.";
    return NextResponse.json({ message }, { status: 500 });
  }
}
