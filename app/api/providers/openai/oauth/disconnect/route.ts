import { NextResponse } from "next/server";
import { clearCodexOAuthTokens, saveSettings } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function POST() {
  await clearCodexOAuthTokens();
  await saveSettings({ openaiAuthMode: "api-key", imageModel: "auto" });
  return NextResponse.json({ connected: false });
}
