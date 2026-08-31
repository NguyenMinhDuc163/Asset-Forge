import { NextResponse } from "next/server";
import { startCodexOAuth } from "@/lib/codex/oauth";

export const runtime = "nodejs";

export async function POST() {
  try { return NextResponse.json(await startCodexOAuth()); }
  catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Không thể bắt đầu OAuth." }, { status: 400 }); }
}
