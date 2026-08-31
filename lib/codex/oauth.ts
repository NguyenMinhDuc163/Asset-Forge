import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { saveCodexOAuthTokens, saveSettings, type CodexOAuthTokens } from "@/lib/storage/settings";

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const authorizeUrl = "https://auth.openai.com/oauth/authorize";
const tokenUrl = "https://auth.openai.com/oauth/token";
const callbackUrl = "http://localhost:1455/auth/callback";
const flowTtlMs = 5 * 60 * 1000;

type OAuthStatus = { status: "pending" | "connected" | "error"; message?: string; createdAt: number };
type PendingFlow = OAuthStatus & { verifier: string };
interface OAuthRuntime { pending: Map<string, PendingFlow>; server?: Server; starting?: Promise<void> }

declare global { var __contentForgeCodexOAuth: OAuthRuntime | undefined }
const runtime: OAuthRuntime = globalThis.__contentForgeCodexOAuth ||= { pending: new Map<string, PendingFlow>() };

function base64Url(bytes = 32) { return randomBytes(bytes).toString("base64url"); }
function accountInfo(idToken?: string) {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = payload["https://api.openai.com/auth"] as { chatgpt_account_id?: string } | undefined;
    return { accountId: auth?.chatgpt_account_id, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch { return {}; }
}

async function exchangeCode(code: string, verifier: string): Promise<CodexOAuthTokens> {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: callbackUrl, code_verifier: verifier }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OpenAI từ chối đổi mã đăng nhập (HTTP ${response.status}).`);
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number };
  if (!tokens.access_token || !tokens.refresh_token) throw new Error("OpenAI không trả về đầy đủ token Codex.");
  const info = accountInfo(tokens.id_token);
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
    ...info,
  };
}

function callbackPage(ok: boolean, message: string) {
  const color = ok ? "#8acba4" : "#f0a080";
  const safeMessage = message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>ContentForge OAuth</title><body style="margin:0;background:#151412;color:#f0ece5;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:480px;padding:32px;text-align:center"><div style="color:${color};font-weight:700">${ok ? "Đã kết nối OpenAI Codex" : "Kết nối thất bại"}</div><p style="color:#b7aea2;line-height:1.6">${safeMessage}</p><button onclick="window.close()" style="padding:10px 16px;border-radius:9px;border:1px solid #484139;background:#1d1b18;color:#f0ece5">Đóng cửa sổ</button></main></body></html>`;
}

async function ensureCallbackServer() {
  if (runtime.server?.listening) return;
  if (runtime.starting) return runtime.starting;
  runtime.starting = new Promise<void>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || "/", callbackUrl);
      if (url.pathname !== "/auth/callback") { response.writeHead(404).end(); return; }
      const state = url.searchParams.get("state") || "";
      const flow = runtime.pending.get(state);
      if (!flow || Date.now() - flow.createdAt > flowTtlMs) {
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage(false, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."));
        return;
      }
      try {
        const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (oauthError) throw new Error(oauthError);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("Không nhận được authorization code.");
        const tokens = await exchangeCode(code, flow.verifier);
        await saveCodexOAuthTokens(tokens);
        await saveSettings({ provider: "openai", openaiAuthMode: "codex-oauth", imageModel: "auto" });
        runtime.pending.set(state, { ...flow, status: "connected", message: tokens.email || "ChatGPT/Codex đã sẵn sàng." });
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage(true, "Bạn có thể quay lại ContentForge."));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Không thể hoàn tất OAuth.";
        runtime.pending.set(state, { ...flow, status: "error", message });
        response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(callbackPage(false, message));
      }
    });
    server.once("error", (error) => { runtime.starting = undefined; reject(error); });
    server.listen(1455, process.env.CONTENTFORGE_OAUTH_HOST || "127.0.0.1", () => { runtime.server = server; runtime.starting = undefined; resolve(); });
  });
  return runtime.starting;
}

export async function startCodexOAuth() {
  for (const [key, flow] of runtime.pending) if (Date.now() - flow.createdAt > flowTtlMs) runtime.pending.delete(key);
  try { await ensureCallbackServer(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new Error(code === "EADDRINUSE" ? "Cổng OAuth 1455 đang được ứng dụng khác sử dụng. Hãy đóng Codex/9Router đang đăng nhập rồi thử lại." : "Không thể mở callback OAuth cục bộ.");
  }
  const verifier = base64Url();
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = base64Url();
  runtime.pending.set(state, { verifier, status: "pending", createdAt: Date.now() });
  const query = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: callbackUrl,
    scope: "openid profile email offline_access", code_challenge: challenge,
    code_challenge_method: "S256", state, id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true", originator: "codex_cli_rs",
  });
  return { state, authUrl: `${authorizeUrl}?${query}` };
}

export function getCodexOAuthStatus(state: string): OAuthStatus {
  const flow = runtime.pending.get(state);
  if (!flow || Date.now() - flow.createdAt > flowTtlMs) return { status: "error", message: "Phiên OAuth đã hết hạn.", createdAt: 0 };
  return { status: flow.status, message: flow.message, createdAt: flow.createdAt };
}
