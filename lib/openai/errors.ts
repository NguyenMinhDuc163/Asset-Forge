import OpenAI from "openai";

export class OpenAIProviderError extends Error {
  constructor(message: string, readonly developerMessage?: string) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

export function toOpenAIProviderError(error: unknown): OpenAIProviderError {
  if (error instanceof OpenAIProviderError) return error;
  if (error instanceof OpenAI.APIError) {
    const code = typeof error.code === "string" ? error.code : "";
    if (error.status === 401) return new OpenAIProviderError("Khóa OpenAI không hợp lệ. Hãy kiểm tra lại trong Cài đặt.", error.message);
    if (error.status === 429) return new OpenAIProviderError("OpenAI đang giới hạn yêu cầu. Hãy đợi một chút rồi thử lại.", error.message);
    if (code === "moderation_blocked") return new OpenAIProviderError("Ý tưởng này không thể được tạo. Hãy điều chỉnh mô tả rồi thử lại.", error.message);
    if (error.status === 403) return new OpenAIProviderError("Khóa API này chưa có quyền dùng mô hình ảnh đã chọn.", error.message);
    if (error.status && error.status >= 500) return new OpenAIProviderError("Dịch vụ tạo ảnh đang tạm thời không khả dụng. Hãy thử lại sau.", error.message);
    return new OpenAIProviderError("OpenAI không thể tạo ảnh này. Hãy kiểm tra mô hình hoặc thử mô tả khác.", error.message);
  }
  if (error instanceof Error && /^(Add a source|Khóa API|Mô hình ảnh)/.test(error.message)) {
    return new OpenAIProviderError(error.message, error.message);
  }
  return new OpenAIProviderError("Không thể kết nối với OpenAI. Hãy kiểm tra mạng rồi thử lại.", error instanceof Error ? error.message : String(error));
}
