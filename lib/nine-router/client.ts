import type { FriendlyImageModel } from "@/lib/openai/model-catalog";

const maxImageBytes = 20 * 1024 * 1024;

export class NineRouterError extends Error {
  constructor(message: string, readonly developerMessage?: string) {
    super(message);
    this.name = "NineRouterError";
  }
}

export function normalizeNineRouterUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Endpoint 9Router phải là URL HTTP hoặc HTTPS hợp lệ.");
  }
  return url.toString().replace(/\/$/, "").replace(/\/v1$/, "");
}

function headers(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    return typeof data.error === "string" ? data.error : data.error?.message || data.message || text;
  } catch { return text; }
}

export async function discoverNineRouterImageModels(baseUrl: string, apiKey?: string): Promise<FriendlyImageModel[]> {
  const root = normalizeNineRouterUrl(baseUrl);
  let response: Response;
  try {
    response = await fetch(`${root}/v1/models/image`, { headers: headers(apiKey), cache: "no-store", signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    throw new NineRouterError("Không thể kết nối 9Router. Hãy kiểm tra endpoint và bảo đảm dịch vụ đang chạy.", error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 401) throw new NineRouterError("Khóa 9Router không hợp lệ hoặc đang được yêu cầu.", detail);
    throw new NineRouterError(`9Router không thể tải model ảnh (HTTP ${response.status}).`, detail);
  }
  const payload = await response.json() as { data?: Array<{ id?: string; name?: string; owned_by?: string }> };
  const models = (payload.data || []).filter((model): model is { id: string; name?: string; owned_by?: string } => Boolean(model.id));
  if (!models.length) throw new NineRouterError("9Router chưa có model tạo ảnh. Hãy thêm provider ảnh trong dashboard 9Router.");
  return models.map((model, index) => ({
    id: model.id,
    label: model.name || model.id,
    description: model.owned_by ? `9Router · ${model.owned_by}` : "9Router image model",
    recommended: index === 0,
  }));
}

export async function generateNineRouterImage(input: {
  baseUrl: string; apiKey?: string; model: string; prompt: string; referenceImage?: Buffer; referenceMimeType?: string;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const root = normalizeNineRouterUrl(input.baseUrl);
  const body: Record<string, unknown> = { model: input.model, prompt: input.prompt, n: 1, size: "1024x1024", response_format: "b64_json" };
  if (input.referenceImage) body.image = `data:${input.referenceMimeType || "image/png"};base64,${input.referenceImage.toString("base64")}`;
  let response: Response;
  try {
    response = await fetch(`${root}/v1/images/generations`, {
      method: "POST",
      headers: { ...headers(input.apiKey), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    throw new NineRouterError("Không thể kết nối 9Router để tạo ảnh.", error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) {
    const detail = await readError(response);
    if (response.status === 401) throw new NineRouterError("Khóa 9Router không hợp lệ hoặc đã hết hạn.", detail);
    if (response.status === 503) throw new NineRouterError("Các tài khoản ảnh trong 9Router đang bận hoặc không khả dụng.", detail);
    throw new NineRouterError(`9Router không thể tạo ảnh (HTTP ${response.status}).`, detail);
  }
  const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const image = payload.data?.[0];
  if (image?.b64_json) return { buffer: Buffer.from(image.b64_json, "base64"), mimeType: "image/png" };
  if (!image?.url) throw new NineRouterError("9Router không trả về dữ liệu ảnh.");
  const imageResponse = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
  if (!imageResponse.ok) throw new NineRouterError("Không thể tải ảnh kết quả từ 9Router.");
  const contentLength = Number(imageResponse.headers.get("content-length") || 0);
  if (contentLength > maxImageBytes) throw new NineRouterError("Ảnh do 9Router trả về vượt quá giới hạn 20 MB.");
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (buffer.byteLength > maxImageBytes) throw new NineRouterError("Ảnh do 9Router trả về vượt quá giới hạn 20 MB.");
  return { buffer, mimeType: imageResponse.headers.get("content-type")?.split(";")[0] || "image/png" };
}
