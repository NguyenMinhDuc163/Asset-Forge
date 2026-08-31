import { randomUUID } from "node:crypto";
import { getCodexOAuthTokens, saveCodexOAuthTokens, type CodexOAuthTokens } from "@/lib/storage/settings";
import type { FriendlyImageModel } from "@/lib/openai/model-catalog";

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const tokenUrl = "https://auth.openai.com/oauth/token";
const responsesUrl = "https://chatgpt.com/backend-api/codex/responses";

export const codexImageModels: FriendlyImageModel[] = [
  { id: "gpt-5.5-image", label: "GPT 5.5 Image", description: "ChatGPT/Codex image", recommended: true },
  { id: "gpt-5.4-image", label: "GPT 5.4 Image", description: "ChatGPT/Codex image" },
  { id: "gpt-5.3-image", label: "GPT 5.3 Image", description: "ChatGPT/Codex image" },
];

export class CodexOAuthError extends Error {
  constructor(message: string, readonly developerMessage?: string) { super(message); this.name = "CodexOAuthError"; }
}

async function refreshTokens(current: CodexOAuthTokens): Promise<CodexOAuthTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, grant_type: "refresh_token", refresh_token: current.refreshToken }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new CodexOAuthError("Phiên ChatGPT/Codex đã hết hạn. Hãy kết nối lại trong Cài đặt.", await response.text());
  const data = await response.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
  if (!data.access_token) throw new CodexOAuthError("OpenAI không trả về access token mới.");
  const next = {
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    idToken: data.id_token || current.idToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  await saveCodexOAuthTokens(next);
  return next;
}

export async function getValidCodexTokens(forceRefresh = false) {
  const tokens = await getCodexOAuthTokens();
  if (!tokens) throw new CodexOAuthError("Hãy kết nối tài khoản ChatGPT/Codex trong Cài đặt trước khi tạo ảnh.");
  if (forceRefresh || tokens.expiresAt < Date.now() + 5 * 60 * 1000) return refreshTokens(tokens);
  return tokens;
}

function buildHeaders(tokens: CodexOAuthTokens): HeadersInit {
  return {
    Accept: "text/event-stream, application/json",
    Authorization: `Bearer ${tokens.accessToken}`,
    "chatgpt-account-id": tokens.accountId || "",
    "Content-Type": "application/json",
    originator: "codex_cli_rs",
    session_id: randomUUID(),
    "User-Agent": "codex_cli_rs/0.144.0",
    version: "0.144.0",
    "x-client-request-id": randomUUID(),
  };
}

async function parseImageStream(response: Response): Promise<Buffer> {
  if (!response.body) throw new CodexOAuthError("Codex không trả về stream ảnh.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let imageBase64 = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let separator: number;
    while ((separator = pending.indexOf("\n\n")) >= 0) {
      const block = pending.slice(0, separator);
      pending = pending.slice(separator + 2);
      const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
      if (event === "response.output_item.done" && data) {
        try {
          const item = (JSON.parse(data) as { item?: { type?: string; result?: string } }).item;
          if (item?.type === "image_generation_call" && item.result) imageBase64 = item.result;
        } catch { /* wait for a complete event */ }
      }
    }
  }
  if (!imageBase64) throw new CodexOAuthError("Codex không tạo được ảnh. Tài khoản cần ChatGPT Plus/Pro và model ảnh phù hợp.");
  return Buffer.from(imageBase64, "base64");
}

export async function generateCodexOAuthImage(input: { model: string; prompt: string; referenceImage?: Buffer; referenceMimeType?: string }) {
  const content: Array<Record<string, unknown>> = [];
  if (input.referenceImage) {
    content.push({ type: "input_text", text: "<image name=image1>" });
    content.push({ type: "input_image", image_url: `data:${input.referenceMimeType || "image/png"};base64,${input.referenceImage.toString("base64")}`, detail: "high" });
    content.push({ type: "input_text", text: "</image>" });
  }
  content.push({ type: "input_text", text: input.prompt });
  // The ChatGPT/Codex image-generation tool does not expose the same
  // `background: "transparent"` option as the public Images API. Sending
  // that field makes otherwise valid Codex image requests fail with HTTP 400
  // ("Transparent background is not supported for this model."). The asset
  // pipeline removes a flat background during normalization, so leave the
  // tool option out and keep the prompt/provider contract intact.
  const body = {
    model: input.model.endsWith("-image") ? input.model.slice(0, -6) : input.model,
    instructions: "",
    input: [{ type: "message", role: "user", content }],
    tools: [{ type: "image_generation", output_format: "png", size: "1024x1024", quality: "medium" }],
    tool_choice: "auto", parallel_tool_calls: false, prompt_cache_key: randomUUID(), stream: true, store: false, reasoning: null,
  };

  let tokens = await getValidCodexTokens();
  let response = await fetch(responsesUrl, { method: "POST", headers: buildHeaders(tokens), body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  if ([401, 403].includes(response.status)) {
    tokens = await getValidCodexTokens(true);
    response = await fetch(responsesUrl, { method: "POST", headers: buildHeaders(tokens), body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  }
  if (!response.ok) throw new CodexOAuthError(`Codex không thể tạo ảnh (HTTP ${response.status}).`, await response.text());
  return { buffer: await parseImageStream(response), mimeType: "image/png" };
}
