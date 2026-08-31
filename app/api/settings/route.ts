import { NextResponse } from "next/server";
import { autoModel, discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getSettings, hasOpenAIKey, saveOpenAIKey, saveSettings, type ProviderId } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function GET() {
  const [settings, apiKeyConfigured] = await Promise.all([getSettings(), hasOpenAIKey()]);
  return NextResponse.json({ ...settings, apiKeyConfigured });
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { provider?: ProviderId; apiKey?: string; imageModel?: string; projectRoot?: string; adapterId?: string };
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
    const settings = await saveSettings({
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.imageModel ? { imageModel: body.imageModel } : {}),
      ...(typeof body.projectRoot === "string" ? { projectRoot: body.projectRoot.trim() } : {}),
      ...(body.adapterId ? { adapterId: body.adapterId } : {}),
    });
    return NextResponse.json({ ...settings, apiKeyConfigured: await hasOpenAIKey(), ...(compatibleModels ? { models: [autoModel, ...compatibleModels] } : {}) });
  } catch (error) {
    console.error("Could not save ContentForge settings", error);
    return NextResponse.json({ message: "Settings could not be saved. Check that ContentForge can write to your user folder." }, { status: 500 });
  }
}
