import { NextResponse } from "next/server";
import { createGenerationArchive, exportGeneration } from "@/core/assets/export";
import { getSettings } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { generationId, delivery } = await request.json() as { generationId?: string; delivery?: "browser" | "server" };
    if (!generationId) return NextResponse.json({ message: "Chưa có kết quả để export." }, { status: 400 });
    if (delivery === "browser") {
      const archive = await createGenerationArchive(generationId);
      return new Response(new Uint8Array(archive.buffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${archive.filename}"`, "Content-Length": String(archive.buffer.byteLength) } });
    }
    const settings = await getSettings();
    const result = await exportGeneration(generationId, settings.projectRoot);
    return NextResponse.json({ message: "Đã export gói tài nguyên sẵn sàng cho game.", ...result });
  } catch (error) {
    console.error("Asset export failed", error);
    const message = error instanceof Error && /^(Không|Kết quả|Mã)/.test(error.message)
      ? error.message
      : "Không thể ghi gói tài nguyên. Hãy kiểm tra thư mục game project và quyền ghi.";
    return NextResponse.json({ message }, { status: 400 });
  }
}
