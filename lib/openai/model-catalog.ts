import OpenAI from "openai";

export interface FriendlyImageModel {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

const capabilityRegistry = [
  { id: "gpt-image-2", label: "GPT Image 2", description: "Chất lượng tốt nhất cho tạo và chỉnh sửa ảnh", rank: 100 },
  { id: "gpt-image-1.5", label: "GPT Image 1.5", description: "Mô hình ảnh thế hệ trước", rank: 80 },
  { id: "gpt-image-1", label: "GPT Image 1", description: "Tạo và chỉnh sửa ảnh ổn định", rank: 60 },
] as const;

export const autoModel: FriendlyImageModel = { id: "auto", label: "Tự động", description: "Đề xuất", recommended: true };

export async function discoverImageModels(apiKey: string): Promise<FriendlyImageModel[]> {
  const client = new OpenAI({ apiKey });
  const response = await client.models.list();
  const available = new Set(response.data.map((model) => model.id));
  return capabilityRegistry
    .filter((model) => available.has(model.id))
    .sort((a, b) => b.rank - a.rank)
    .map((model) => ({ id: model.id, label: model.label, description: model.description }));
}

export function resolveImageModel(selected: string, available: FriendlyImageModel[]): string {
  if (selected === "auto") {
    const best = available[0];
    if (!best) throw new Error("Khóa API này chưa có quyền dùng mô hình tạo ảnh được hỗ trợ.");
    return best.id;
  }
  if (!available.some((model) => model.id === selected)) {
    throw new Error("Mô hình ảnh đã chọn không khả dụng với khóa API này.");
  }
  return selected;
}
