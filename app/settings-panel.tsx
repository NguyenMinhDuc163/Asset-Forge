"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ProviderId, ThemePreference } from "@/lib/storage/settings";
import { getCopy, type Locale } from "@/lib/i18n";

interface SettingsData {
  provider: ProviderId;
  imageModel: string;
  nineRouterUrl: string;
  projectRoot: string;
  adapterId: string;
  apiKeyConfigured: boolean;
  nineRouterKeyConfigured: boolean;
  locale: Locale;
  theme: ThemePreference;
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
  nineRouterUrl: "http://localhost:20128",
  projectRoot: "",
  adapterId: "nro-legacy-v1",
  apiKeyConfigured: false,
  nineRouterKeyConfigured: false,
  locale: "vi",
  theme: "system",
};

export function SettingsPanel({ open, onClose, onSaved, locale }: SettingsPanelProps) {
  const t = getCopy(locale);
  const [settings, setSettings] = useState(initialSettings);
  const [apiKey, setApiKey] = useState("");
  const [nineRouterApiKey, setNineRouterApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<FriendlyModel[]>([{ id: "auto", label: "Tự động", description: "Đề xuất", recommended: true }]);

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
        const canLoadModels = (data.provider === "openai" && data.apiKeyConfigured) || data.provider === "nine-router";
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-[rgba(37,32,26,0.28)] p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={onClose}>
      <form className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[18px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_30px_90px_rgba(37,32,26,0.2)] sm:rounded-[18px]" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
        <div className="mb-7 flex items-start justify-between">
          <div><h2 id="settings-title" className="text-xl font-semibold tracking-[-0.03em]">{t.settingsTitle}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t.settingsDescription}</p></div>
          <button type="button" className="control-button size-10 px-0" aria-label={t.closeSettings} onClick={onClose}>×</button>
        </div>

        <div className={`space-y-5 ${status === "loading" ? "pointer-events-none opacity-55" : ""}`}>
          <label className="block text-sm font-semibold">{t.provider}
            <select className="field mt-2" value={settings.provider} onChange={(event) => { setModels([{ id: "auto", label: t.automatic, description: t.recommended, recommended: true }]); setSettings({ ...settings, provider: event.target.value as ProviderId, imageModel: "auto" }); }}>
              <option value="openai">{t.openai}</option>
              <option value="nine-router">{t.nineRouter}</option>
              <option value="manual">{t.noAi}</option>
            </select>
          </label>

          {settings.provider === "openai" && (
            <>
              <label className="block text-sm font-semibold">{t.apiKey}
                <input type="password" className="field mt-2" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? t.savedKeyPlaceholder : t.apiKeyPlaceholder} autoComplete="off" />
              </label>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.keyPrivacy}</p>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">{t.openaiAuthHelp}</p>
              <label className="block text-sm font-semibold">{t.imageModel}
                <select className="field mt-2" value={settings.imageModel} onChange={(event) => setSettings({ ...settings, imageModel: event.target.value })}>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? ` - ${t.recommended}` : ""}</option>)}
                </select>
              </label>
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
                <select className="field mt-2" value={settings.imageModel} onChange={(event) => setSettings({ ...settings, imageModel: event.target.value })}>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? ` - ${t.recommended}` : ""}</option>)}
                </select>
              </label>
            </>
          )}

          <div className="border-t border-[var(--line)] pt-5">
            <p className="mb-4 text-sm font-semibold">{t.gameProject}</p>
            <label className="block text-sm font-semibold">{t.projectFolder}
              <input className="field mt-2" value={settings.projectRoot} onChange={(event) => setSettings({ ...settings, projectRoot: event.target.value })} placeholder={t.projectPlaceholder} />
            </label>
            <label className="mt-5 block text-sm font-semibold">{t.adapter}
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
