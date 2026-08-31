import { NextResponse } from "next/server";
import { autoModel, discoverImageModels } from "@/lib/openai/model-catalog";
import { toOpenAIProviderError } from "@/lib/openai/errors";
import { getOpenAIKey } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = await getOpenAIKey();
  if (!apiKey) return NextResponse.json({ message: "Hãy lưu khóa OpenAI trước khi tải danh sách mô hình." }, { status: 400 });
  try {
    const models = await discoverImageModels(apiKey);
    return NextResponse.json({ models: [autoModel, ...models] });
  } catch (error) {
    const friendlyError = toOpenAIProviderError(error);
    console.error("OpenAI model discovery failed", friendlyError.developerMessage);
    return NextResponse.json({ message: friendlyError.message }, { status: 400 });
  }
}
