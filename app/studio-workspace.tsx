"use client";

import Image from "next/image";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { SettingsPanel } from "./settings-panel";
import type { ProviderId } from "@/lib/storage/settings";

const assetKinds = ["Character", "Environment", "Item", "Effect"] as const;
type AssetKind = (typeof assetKinds)[number];
type StudioState = "empty" | "creating" | "ready" | "error";

export function StudioWorkspace() {
  const [assetKind, setAssetKind] = useState<AssetKind>("Character");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [studioState, setStudioState] = useState<StudioState>("empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMeta, setResultMeta] = useState({ adapter: "NRO Legacy", width: 64, height: 128, checks: [] as string[] });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleSettingsSaved = useCallback((settings: { provider: ProviderId }) => setProvider(settings.provider), []);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function acceptFile(file?: File) {
    if (file?.type.startsWith("image/")) {
      setReference(file);
      setPreviewUrl(URL.createObjectURL(file));
      setStudioState("empty");
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  async function createAsset() {
    if (!prompt.trim() && !reference) return;
    setStudioState("creating");
    setErrorMessage("");
    const form = new FormData();
    form.set("kind", assetKind.toLowerCase());
    form.set("prompt", prompt);
    if (reference) form.set("reference", reference);
    try {
      const response = await fetch("/api/assets/create", { method: "POST", body: form });
      const result = await response.json() as { image?: { base64: string; mimeType: string; width: number; height: number }; adapter?: { label: string }; validation?: { checks: Array<{ label: string; passed: boolean }> }; message?: string };
      if (!response.ok || !result.image) throw new Error(result.message || "The asset could not be created.");
      setPreviewUrl(`data:${result.image.mimeType};base64,${result.image.base64}`);
      setResultMeta({ adapter: result.adapter?.label || "Game adapter", width: result.image.width, height: result.image.height, checks: result.validation?.checks.filter((check) => check.passed).map((check) => check.label) || [] });
      setStudioState("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "The asset could not be created.");
      setStudioState("error");
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[color:var(--canvas)/0.94]">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-[10px] bg-[var(--ink)] font-mono text-xs font-semibold text-[var(--canvas)]">CF</div>
            <div>
              <p className="text-[15px] font-semibold tracking-[-0.02em]">ContentForge</p>
              <p className="text-xs text-[var(--muted)]">Game asset workshop</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button className="control-button hidden sm:inline-flex" type="button">Untitled project</button>
            <button className="control-button" type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
        <section className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">New asset</p>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">What do you want to make?</h1>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[var(--soft)] p-1 sm:flex" aria-label="Asset type">
            {assetKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={assetKind === kind}
                onClick={() => { setAssetKind(kind); setStudioState("empty"); }}
                className={`min-h-10 rounded-[10px] px-4 text-sm font-medium transition active:translate-y-px ${assetKind === kind ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_4px_rgba(38,32,24,0.08)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {kind}
              </button>
            ))}
          </div>
        </section>

        <section className="grid min-h-[610px] overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(63,49,33,0.07)] lg:grid-cols-[minmax(340px,0.78fr)_minmax(480px,1.22fr)]">
          <div className="flex flex-col border-b border-[var(--line)] p-5 sm:p-7 lg:border-r lg:border-b-0 lg:p-8">
            <div className="mb-7">
              <h2 className="mb-1 text-lg font-semibold tracking-[-0.025em]">Shape the idea</h2>
              <p className="text-sm leading-6 text-[var(--muted)]">Describe the result. ContentForge handles the technical conversion.</p>
            </div>

            <label className="mb-3 text-sm font-semibold" htmlFor="asset-prompt">Describe your {assetKind.toLowerCase()}</label>
            <textarea
              id="asset-prompt"
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); setStudioState("empty"); }}
              placeholder={assetKind === "Character" ? "A small ice warrior with a chipped silver helmet" : `A game-ready ${assetKind.toLowerCase()} with a clear silhouette`}
              className="min-h-32 resize-none rounded-[12px] border border-[var(--line-strong)] bg-[var(--canvas)] px-4 py-3 text-[15px] leading-6 outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-soft)]"
            />

            <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--faint)]">
              <span className="h-px flex-1 bg-[var(--line)]" />Optional reference<span className="h-px flex-1 bg-[var(--line)]" />
            </div>

            <div
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`group flex min-h-32 cursor-pointer items-center gap-4 rounded-[12px] border border-dashed p-4 outline-none transition focus:ring-3 focus:ring-[var(--accent-soft)] ${isDragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-strong)] bg-[var(--canvas)] hover:border-[var(--accent)]"}`}
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] bg-[var(--surface)] text-xl text-[var(--accent-strong)]">+</div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{reference ? reference.name : "Drop an image here"}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{reference ? "Ready to use as visual direction" : "PNG, JPEG, or WebP up to 10 MB"}</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleFileChange} />
            </div>

            <div className="mt-auto pt-7">
              <div className="mb-3 flex items-center justify-between text-xs text-[var(--muted)]">
                <span>{provider === "openai" ? "OpenAI with automatic model selection" : "No-AI image processing"}</span>
                <button type="button" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4" onClick={() => setSettingsOpen(true)}>Change</button>
              </div>
              {provider === "manual" && !reference && <p className="mb-3 rounded-[10px] bg-[var(--soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">Add a source image to use No-AI mode.</p>}
              <button type="button" onClick={createAsset} disabled={(!prompt.trim() && !reference) || (provider === "manual" && !reference) || studioState === "creating"} className="primary-button w-full">
                {studioState === "creating" ? "Forging asset..." : "Create asset"}
              </button>
            </div>
          </div>

          <div className="relative flex min-h-[500px] flex-col bg-[var(--preview)] p-4 sm:p-6 lg:p-8">
            <div className="mb-4 flex items-center justify-between">
              <div><p className="text-sm font-semibold">Game preview</p><p className="mt-0.5 text-xs text-[var(--muted)]">{resultMeta.adapter} profile</p></div>
              <span className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{resultMeta.width} × {resultMeta.height}</span>
            </div>

            <div className="preview-grid relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--line-strong)]">
              {studioState === "creating" ? (
                <div className="w-full max-w-sm px-8 text-center">
                  <div className="mb-5 h-2 overflow-hidden rounded-full bg-[var(--line)]"><div className="forge-progress h-full w-1/2 rounded-full bg-[var(--accent)]" /></div>
                  <p className="text-sm font-semibold">Preparing visual material</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Normalizing the image for your game profile</p>
                </div>
              ) : previewUrl ? (
                <div className="relative size-[min(64vw,330px)] max-h-[330px] max-w-[330px] overflow-hidden rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_18px_50px_rgba(49,41,31,0.13)]">
                  <Image src={previewUrl} alt="Uploaded asset preview" fill unoptimized className="object-contain [image-rendering:pixelated]" />
                </div>
              ) : (
                <div className="max-w-xs px-6 text-center">
                  <div className="mx-auto mb-5 grid size-20 place-items-center rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_10px_30px_rgba(49,41,31,0.08)]"><span className="font-mono text-lg font-semibold text-[var(--faint)]">64</span></div>
                  <p className="text-sm font-semibold">Your asset will appear here</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Add an idea or reference image, then create one game-ready result.</p>
                </div>
              )}
            </div>

            <div className="mt-4 min-h-16">
              {studioState === "error" && <div className="rounded-[10px] bg-[#f8e7e1] px-3 py-2 text-sm text-[#87391b]" role="alert">{errorMessage}</div>}
              {studioState === "ready" ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className="text-sm font-semibold text-[var(--success)]">Ready for game</p><p className="mt-1 text-xs text-[var(--muted)]">{resultMeta.checks.join(", ")}</p></div>
                  <div className="flex gap-2"><button type="button" className="control-button" onClick={() => setStudioState("empty")}>Try another</button><button type="button" className="primary-button px-6">Export</button></div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-[var(--muted)]"><span>Preview reflects the selected game adapter</span><span className="font-mono">PNG</span></div>
              )}
            </div>
          </div>
        </section>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={handleSettingsSaved} />
    </main>
  );
}
