import { NextResponse } from "next/server";
import { discoverNineRouterImageModels, NineRouterError } from "@/lib/nine-router/client";
import { getNineRouterKey, getSettings } from "@/lib/storage/settings";
import { autoModel } from "@/lib/openai/model-catalog";

export const runtime = "nodejs";

export async function GET() {
  const [settings, apiKey] = await Promise.all([getSettings(), getNineRouterKey()]);
  try {
    const models = await discoverNineRouterImageModels(settings.nineRouterUrl, apiKey);
    return NextResponse.json({ models: [autoModel, ...models] });
  } catch (error) {
    const message = error instanceof NineRouterError ? error.message : "Không thể tải model ảnh từ 9Router.";
    console.error("9Router model discovery failed", error);
    return NextResponse.json({ message }, { status: 400 });
  }
}
