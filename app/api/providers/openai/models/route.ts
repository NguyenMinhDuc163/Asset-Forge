import { NextResponse } from "next/server";
import { autoModel, discoverImageModels, resolveImageModel } from "@/lib/openai/model-catalog";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getOpenAIKey } from "@/lib/storage/settings";
import { getSettings, hasCodexOAuth } from "@/lib/storage/settings";
import { codexImageModels } from "@/lib/codex/client";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getSettings();
  if (settings.openaiAuthMode === "codex-oauth") {
    if (!await hasCodexOAuth()) return NextResponse.json({ message: "Hãy kết nối ChatGPT/Codex trước." }, { status: 400 });
    return NextResponse.json({ models: [autoModel, ...codexImageModels] });
  }
  const apiKey = await getOpenAIKey();
  if (!apiKey) return NextResponse.json({ message: "Hãy lưu khóa OpenAI trước khi tải danh sách mô hình." }, { status: 400 });
  try {
    const models = await discoverImageModels(apiKey);
    resolveImageModel("auto", models);
    return NextResponse.json({ models: [autoModel, ...models] });
  } catch (error) {
    const friendlyError = toOpenAIProviderError(error);
    console.error("OpenAI model discovery failed", friendlyError.developerMessage);
    return NextResponse.json({ message: friendlyError.message }, { status: 400 });
  }
}
