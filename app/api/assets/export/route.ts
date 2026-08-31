import { NextResponse } from "next/server";
import { exportGeneration } from "@/core/assets/export";
import { getSettings } from "@/lib/storage/settings";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { generationId } = await request.json() as { generationId?: string };
    if (!generationId) return NextResponse.json({ message: "Chưa có kết quả để export." }, { status: 400 });
    const settings = await getSettings();
    if (!settings.projectRoot) return NextResponse.json({ message: "Hãy chọn thư mục game project trong Cài đặt trước khi export." }, { status: 400 });
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
