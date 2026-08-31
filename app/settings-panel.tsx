"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ExportMode, OpenAIAuthMode, ProviderId, ThemePreference } from "@/lib/storage/settings";
import { getCopy, type Locale } from "@/lib/i18n";

interface SettingsData {
  provider: ProviderId;
  imageModel: string;
  openaiAuthMode: OpenAIAuthMode;
  nineRouterUrl: string;
  projectRoot: string;
  adapterId: string;
  apiKeyConfigured: boolean;
  nineRouterKeyConfigured: boolean;
  codexOAuthConfigured: boolean;
  locale: Locale;
  theme: ThemePreference;
  exportMode: ExportMode;
  models?: FriendlyModel[];
}

interface FriendlyModel { id: string; label: string; description: string; recommended?: boolean }

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: SettingsData) => void;
  locale: Locale;
}

const initialSettings: SettingsData = {
  provider: "openai",
  imageModel: "auto",
  openaiAuthMode: "api-key",
  nineRouterUrl: "http://localhost:20128",
  projectRoot: "",
  adapterId: "nro-legacy-v1",
  apiKeyConfigured: false,
  nineRouterKeyConfigured: false,
  codexOAuthConfigured: false,
  locale: "vi",
  theme: "system",
  exportMode: "download",
};

export function SettingsPanel({ open, onClose, onSaved, locale }: SettingsPanelProps) {
  const t = getCopy(locale);
  const [settings, setSettings] = useState(initialSettings);
  const [apiKey, setApiKey] = useState("");
  const [nineRouterApiKey, setNineRouterApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<FriendlyModel[]>([{ id: "auto", label: "Tự động", description: "Đề xuất", recommended: true }]);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "connecting" | "error">("idle");
  const providerName: Record<ProviderId, string> = { manual: t.noAi, openai: t.openai, "nine-router": t.nineRouter };

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch("/api/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error(t.loadSettingsError);
        return (await response.json()) as SettingsData;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data);
        onSaved(data);
        setStatus("idle");
        const canLoadModels = (data.provider === "openai" && (data.apiKeyConfigured || data.codexOAuthConfigured)) || data.provider === "nine-router";
        if (canLoadModels) {
          fetch(`/api/providers/${data.provider}/models`)
            .then((response) => response.ok ? response.json() : Promise.reject(new Error(t.loadModelsError)))
            .then((catalog: { models: FriendlyModel[] }) => { if (active) setModels(catalog.models); })
            .catch(() => undefined);
        }
      })
      .catch((error: Error) => {
        if (!active) return;
        setMessage(error.message);
        setStatus("error");
      });
    return () => { active = false; };
  }, [open, onSaved, t.loadModelsError, t.loadSettingsError]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, apiKey: apiKey || undefined, nineRouterApiKey: nineRouterApiKey || undefined }),
      });
      const data = await response.json() as SettingsData & { message?: string };
      if (!response.ok) throw new Error(data.message || t.saveSettingsError);
      setSettings(data);
      if (data.models) setModels(data.models);
      setApiKey("");
      setNineRouterApiKey("");
      localStorage.setItem("contentforge-theme", data.theme);
      document.documentElement.dataset.theme = data.theme;
      setStatus("saved");
      setMessage(t.settingsSaved);
      onSaved(data);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t.saveSettingsError);
    }
  }

  async function connectChatGpt() {
    setOauthStatus("connecting");
    setMessage("");
    const popup = window.open("about:blank", "contentforge-codex-oauth", "popup,width=560,height=720");
    try {
      const response = await fetch("/api/providers/openai/oauth/start", { method: "POST" });
      const result = await response.json() as { state?: string; authUrl?: string; message?: string };
      if (!response.ok || !result.state || !result.authUrl) throw new Error(result.message || t.saveSettingsError);
      if (popup) popup.location.href = result.authUrl; else window.open(result.authUrl, "_blank", "noopener,noreferrer");
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/providers/openai/oauth/status?state=${encodeURIComponent(result.state)}`, { cache: "no-store" });
        const oauth = await statusResponse.json() as { status: "pending" | "connected" | "error"; message?: string };
        if (oauth.status === "pending") continue;
        if (oauth.status === "error") throw new Error(oauth.message || t.saveSettingsError);
        const settingsResponse = await fetch("/api/settings", { cache: "no-store" });
        const next = await settingsResponse.json() as SettingsData;
        setSettings(next);
        setOauthStatus("idle");
        setMessage(t.chatgptConnected);
        setStatus("saved");
        onSaved(next);
        const catalog = await fetch("/api/providers/openai/models").then((item) => item.json()) as { models?: FriendlyModel[] };
        if (catalog.models) setModels(catalog.models);
        return;
      }
      throw new Error("OAuth timeout");
    } catch (error) {
      popup?.close();
      setOauthStatus("error");
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t.saveSettingsError);
    }
  }

  async function disconnectChatGpt() {
    await fetch("/api/providers/openai/oauth/disconnect", { method: "POST" });
    setSettings({ ...settings, openaiAuthMode: "api-key", codexOAuthConfigured: false, imageModel: "auto" });
    setModels([{ id: "auto", label: t.automatic, description: t.recommended, recommended: true }]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-[rgba(37,32,26,0.28)] p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={onClose}>
      <form className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[18px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_30px_90px_rgba(37,32,26,0.2)] sm:rounded-[18px]" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
        <div className="mb-7 flex items-start justify-between">
          <div><h2 id="settings-title" className="text-xl font-semibold tracking-[-0.03em]">{t.settingsTitle}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t.settingsDescription}</p></div>
          <button type="button" className="control-button size-10 px-0" aria-label={t.closeSettings} onClick={onClose}>×</button>
        </div>

        <div className={`space-y-5 ${status === "loading" ? "pointer-events-none opacity-55" : ""}`}>
          <div className="rounded-[12px] border border-[var(--line)] bg-[var(--canvas)] px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">{t.selectedSource}</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{providerName[settings.provider]}</p>
              <span className="rounded-full bg-[var(--soft)] px-2 py-1 font-mono text-[9px] font-semibold uppercase text-[var(--muted)]">{settings.provider === "manual" ? "LOCAL" : "API"}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t.sourceManagedInWorkspace}</p>
          </div>

          {settings.provider === "openai" && (
            <>
              <label className="block text-sm font-semibold">{t.openaiAuthentication}
                <select className="field mt-2" value={settings.openaiAuthMode} onChange={(event) => { setModels([{ id: "auto", label: t.automatic, description: t.recommended, recommended: true }]); setSettings({ ...settings, openaiAuthMode: event.target.value as OpenAIAuthMode, imageModel: "auto" }); }}>
                  <option value="api-key">{t.officialApiKey}</option>
                  <option value="codex-oauth">{t.chatgptOAuth}</option>
                </select>
              </label>
              {settings.openaiAuthMode === "api-key" ? <>
                <label className="block text-sm font-semibold">{t.apiKey}
                  <input type="password" className="field mt-2" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? t.savedKeyPlaceholder : t.apiKeyPlaceholder} autoComplete="off" />
                </label>
                <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.keyPrivacy} {t.openaiAuthHelp}</p>
              </> : <>
                <div className="rounded-[12px] border border-[var(--line)] bg-[var(--canvas)] p-4">
                  <p className="text-xs leading-5 text-[var(--muted)]">{t.chatgptOAuthWarning}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="primary-button" onClick={connectChatGpt} disabled={oauthStatus === "connecting"}>{oauthStatus === "connecting" ? t.connectingChatgpt : settings.codexOAuthConfigured ? t.reconnectChatgpt : t.connectChatgpt}</button>
                    {settings.codexOAuthConfigured && <button type="button" className="control-button" onClick={disconnectChatGpt}>{t.disconnectChatgpt}</button>}
                  </div>
                </div>
              </>}
              <label className="block text-sm font-semibold">{t.imageModel}
                <input className="field mt-2" list="openai-image-models" value={settings.imageModel} onChange={(event) => setSettings({ ...settings, imageModel: event.target.value })} placeholder={t.modelPlaceholder} />
                <datalist id="openai-image-models">{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
              </label>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.customModelHelp}</p>
            </>
          )}

          {settings.provider === "nine-router" && (
            <>
              <label className="block text-sm font-semibold">{t.nineRouterEndpoint}
                <input className="field mt-2" value={settings.nineRouterUrl} onChange={(event) => setSettings({ ...settings, nineRouterUrl: event.target.value })} placeholder="http://localhost:20128" inputMode="url" />
              </label>
              <label className="block text-sm font-semibold">{t.nineRouterKey}
                <input type="password" className="field mt-2" value={nineRouterApiKey} onChange={(event) => setNineRouterApiKey(event.target.value)} placeholder={settings.nineRouterKeyConfigured ? t.savedKeyPlaceholder : t.nineRouterKeyPlaceholder} autoComplete="off" />
              </label>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.nineRouterHelp}</p>
              <label className="block text-sm font-semibold">{t.imageModel}
                <input className="field mt-2" list="nine-router-image-models" value={settings.imageModel} onChange={(event) => setSettings({ ...settings, imageModel: event.target.value })} placeholder={t.modelPlaceholder} />
                <datalist id="nine-router-image-models">{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
              </label>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.customModelHelp}</p>
            </>
          )}

          <div className="border-t border-[var(--line)] pt-5">
            <p className="mb-4 text-sm font-semibold">{t.gameProject}</p>
            <p className="mb-4 rounded-[10px] bg-[var(--soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">{t.automaticExportFolder}</p>
            <label className="block text-sm font-semibold">{t.adapter}
              <select className="field mt-2" value={settings.adapterId} onChange={(event) => setSettings({ ...settings, adapterId: event.target.value })}>
                <option value="nro-legacy-v1">NRO Legacy</option>
                <option value="generic-sprite-v1">Generic 2D Sprite</option>
              </select>
            </label>
          </div>

          <div className="border-t border-[var(--line)] pt-5">
            <p className="mb-4 text-sm font-semibold">{t.appearance}</p>
            <label className="block text-sm font-semibold">{t.theme}
              <select className="field mt-2" value={settings.theme} onChange={(event) => setSettings({ ...settings, theme: event.target.value as ThemePreference })}>
                <option value="system">{t.themeSystem}</option>
                <option value="light">{t.themeLight}</option>
                <option value="dark">{t.themeDark}</option>
              </select>
            </label>
          </div>
        </div>

        {message && <p className={`mt-5 rounded-[10px] px-3 py-2 text-sm ${status === "error" ? "bg-[var(--error-soft)] text-[var(--error)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`} role="status">{message}</p>}
        <div className="mt-7 flex justify-end gap-2">
          <button type="button" className="control-button" onClick={onClose}>{t.cancel}</button>
          <button type="submit" className="primary-button" disabled={status === "loading" || status === "saving"}>{status === "saving" ? t.saving : t.saveSettings}</button>
        </div>
      </form>
    </div>
  );
}
