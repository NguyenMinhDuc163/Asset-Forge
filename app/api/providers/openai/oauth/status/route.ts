import { NextResponse } from "next/server";
import { getCodexOAuthStatus } from "@/lib/codex/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const state = new URL(request.url).searchParams.get("state") || "";
  return NextResponse.json(getCodexOAuthStatus(state));
}
