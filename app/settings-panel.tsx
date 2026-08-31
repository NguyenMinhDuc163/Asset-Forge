"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ProviderId } from "@/lib/storage/settings";

interface SettingsData {
  provider: ProviderId;
  imageModel: string;
  projectRoot: string;
  adapterId: string;
  apiKeyConfigured: boolean;
  models?: FriendlyModel[];
}

interface FriendlyModel { id: string; label: string; description: string; recommended?: boolean }

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: SettingsData) => void;
}

const initialSettings: SettingsData = {
  provider: "openai",
  imageModel: "auto",
  projectRoot: "",
  adapterId: "nro-legacy-v1",
  apiKeyConfigured: false,
};

export function SettingsPanel({ open, onClose, onSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [models, setModels] = useState<FriendlyModel[]>([{ id: "auto", label: "Tự động", description: "Đề xuất", recommended: true }]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch("/api/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error("Settings could not be loaded.");
        return (await response.json()) as SettingsData;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data);
        onSaved(data);
        setStatus("idle");
        if (data.apiKeyConfigured) {
          fetch("/api/providers/openai/models")
            .then((response) => response.ok ? response.json() : Promise.reject(new Error("Không thể tải danh sách mô hình.")))
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
  }, [open, onSaved]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, apiKey: apiKey || undefined }),
      });
      const data = await response.json() as SettingsData & { message?: string };
      if (!response.ok) throw new Error(data.message || "Settings could not be saved.");
      setSettings(data);
      if (data.models) setModels(data.models);
      setApiKey("");
      setStatus("saved");
      setMessage("Settings saved locally.");
      onSaved(data);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Settings could not be saved.");
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-[rgba(37,32,26,0.28)] p-0 sm:items-center sm:p-6" role="presentation" onMouseDown={onClose}>
      <form className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[18px] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_30px_90px_rgba(37,32,26,0.2)] sm:rounded-[18px]" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={save}>
        <div className="mb-7 flex items-start justify-between">
          <div><h2 id="settings-title" className="text-xl font-semibold tracking-[-0.03em]">Settings</h2><p className="mt-1 text-sm text-[var(--muted)]">Provider and project details stay on this machine.</p></div>
          <button type="button" className="control-button size-10 px-0" aria-label="Close settings" onClick={onClose}>×</button>
        </div>

        <div className={`space-y-5 ${status === "loading" ? "pointer-events-none opacity-55" : ""}`}>
          <label className="block text-sm font-semibold">Provider
            <select className="field mt-2" value={settings.provider} onChange={(event) => setSettings({ ...settings, provider: event.target.value as ProviderId })}>
              <option value="openai">OpenAI</option>
              <option value="manual">No-AI image processing</option>
            </select>
          </label>

          {settings.provider === "openai" && (
            <>
              <label className="block text-sm font-semibold">API key
                <input type="password" className="field mt-2" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? "Saved securely. Enter a new key to replace it." : "sk-..."} autoComplete="off" />
              </label>
              <p className="-mt-3 text-xs leading-5 text-[var(--muted)]">The saved key is never sent back to this screen.</p>
              <label className="block text-sm font-semibold">Image model
                <select className="field mt-2" value={settings.imageModel} onChange={(event) => setSettings({ ...settings, imageModel: event.target.value })}>
                  {models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.recommended ? " - Đề xuất" : ""}</option>)}
                </select>
              </label>
            </>
          )}

          <div className="border-t border-[var(--line)] pt-5">
            <p className="mb-4 text-sm font-semibold">Game project</p>
            <label className="block text-sm font-semibold">Project folder
              <input className="field mt-2" value={settings.projectRoot} onChange={(event) => setSettings({ ...settings, projectRoot: event.target.value })} placeholder="D:\\games\\my-project" />
            </label>
            <label className="mt-5 block text-sm font-semibold">Adapter
              <select className="field mt-2" value={settings.adapterId} onChange={(event) => setSettings({ ...settings, adapterId: event.target.value })}>
                <option value="nro-legacy-v1">NRO Legacy</option>
                <option value="generic-sprite-v1">Generic 2D Sprite</option>
              </select>
            </label>
          </div>
        </div>

        {message && <p className={`mt-5 rounded-[10px] px-3 py-2 text-sm ${status === "error" ? "bg-[#f8e7e1] text-[#87391b]" : "bg-[#e4eee7] text-[var(--success)]"}`} role="status">{message}</p>}
        <div className="mt-7 flex justify-end gap-2">
          <button type="button" className="control-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={status === "loading" || status === "saving"}>{status === "saving" ? "Saving..." : "Save settings"}</button>
        </div>
      </form>
    </div>
  );
}
