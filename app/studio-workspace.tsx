"use client";

import Image from "next/image";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import { SettingsPanel } from "./settings-panel";
import type { CreationMode, ExportMode, ProviderId, ThemePreference } from "@/lib/storage/settings";
import { getCopy, type Locale } from "@/lib/i18n";
import { getProviderDefinition, providerCatalog } from "@/core/providers/catalog";

const assetKinds = ["Character", "Environment", "Item", "Effect"] as const;
type AssetKind = (typeof assetKinds)[number];
type StudioState = "empty" | "creating" | "ready" | "error";
type AssetStatus = "draft" | "static-ready" | "playable" | "game-ready";
type AnimationState = "idle" | "run" | "jump" | "fall" | "attack" | "hurt";
interface AnimationFrame { poseId: string; state: string; base64: string; mimeType: string; width: number; height: number }
interface BrowserFileHandle { createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }
interface BrowserDirectoryHandle { name: string; getFileHandle(name: string, options: { create: boolean }): Promise<BrowserFileHandle> }

export function StudioWorkspace() {
  const [locale, setLocale] = useState<Locale>("vi");
  const t = getCopy(locale);
  const [assetKind, setAssetKind] = useState<AssetKind>("Character");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);
  const [processedPreviewUrl, setProcessedPreviewUrl] = useState<string | null>(null);
  const [processedSize, setProcessedSize] = useState({ width: 1, height: 2 });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resultIsStatic, setResultIsStatic] = useState(false);
  const [splitLines, setSplitLines] = useState({ neck: 0.28, hip: 0.56 });
  const [splitDirty, setSplitDirty] = useState(false);
  const [studioState, setStudioState] = useState<StudioState>("empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [provider, setProvider] = useState<ProviderId>("openai");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [exportMode, setExportMode] = useState<ExportMode>("download");
  const [directoryHandle, setDirectoryHandle] = useState<BrowserDirectoryHandle | null>(null);
  const [projectLabel, setProjectLabel] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [resultMeta, setResultMeta] = useState({ adapter: "NRO Legacy", width: 64, height: 128, status: "draft" as AssetStatus, checks: [] as string[] });
  const [generationId, setGenerationId] = useState("");
  const [animationFrames, setAnimationFrames] = useState<AnimationFrame[]>([]);
  const [animationState, setAnimationState] = useState<AnimationState>("idle");
  const [animationIndex, setAnimationIndex] = useState(0);
  const [animationPlaying, setAnimationPlaying] = useState(true);
  const [creationStep, setCreationStep] = useState(0);
  const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "done">("idle");
  const [exportMessage, setExportMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const providerCopy: Record<ProviderId, { label: string; description: string }> = {
    manual: { label: t.noAi, description: t.manualMode },
    openai: { label: t.openai, description: t.openaiAuto },
    "nine-router": { label: t.nineRouter, description: t.nineRouterMode },
  };
  const activeProvider = providerCopy[provider];
  const activeProviderDefinition = getProviderDefinition(provider);
  const requiresReference = activeProviderDefinition.requiresReference;
  const isReferenceFirst = provider === "manual" && assetKind === "Character";
  const showSplitPreview = assetKind === "Character" && (isReferenceFirst || resultIsStatic);
  const exportReady = resultMeta.status === "game-ready" || resultMeta.status === "static-ready";
  const remoteProviders = providerCatalog.filter((item) => item.kind === "remote");
  const stateLabels: Record<AnimationState, string> = { idle: t.animationIdle, run: t.animationRun, jump: t.animationJump, fall: t.animationFall, attack: t.animationAttack, hurt: t.animationHurt };
  const creationStages = assetKind === "Character"
    ? [t.stageSource, t.stageCleanup, t.stageParts, t.stageSimilarity]
    : [t.stagePreparing, t.stageDesign, t.stageFrames, t.stageValidation];
  const stateFrames = animationFrames.filter((frame) => frame.state === animationState);
  const displayedFrame = stateFrames[animationIndex % Math.max(1, stateFrames.length)] || animationFrames[0];
  const handleSettingsSaved = useCallback((settings: { provider: ProviderId; locale: Locale; projectRoot: string; theme: ThemePreference; exportMode: ExportMode; creationMode: CreationMode }) => {
    setProvider(settings.provider);
    setLocale(settings.locale);
    setProjectLabel(settings.projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || "");
    setTheme(settings.theme);
    document.documentElement.dataset.theme = settings.theme;
    setExportMode(settings.exportMode);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/settings")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((settings: { provider: ProviderId; locale?: Locale; projectRoot?: string; theme?: ThemePreference; exportMode?: ExportMode }) => {
        if (!active) return;
        setProvider(settings.provider);
        setLocale(settings.locale || "vi");
        setProjectLabel(settings.projectRoot?.split(/[\\/]/).filter(Boolean).at(-1) || "");
        const nextTheme = settings.theme || "system";
        setTheme(nextTheme);
        localStorage.setItem("contentforge-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
        setExportMode(settings.exportMode || "download");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sourcePreviewUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(sourcePreviewUrl);
  }, [sourcePreviewUrl]);

  useEffect(() => {
    if (!animationPlaying || stateFrames.length < 2 || studioState !== "ready") return;
    const timer = window.setInterval(() => setAnimationIndex((index) => (index + 1) % stateFrames.length), 380);
    return () => window.clearInterval(timer);
  }, [animationPlaying, stateFrames.length, studioState]);

  useEffect(() => {
    if (studioState !== "creating") return;
    const timer = window.setInterval(() => setCreationStep((step) => Math.min(3, step + 1)), 650);
    return () => window.clearInterval(timer);
  }, [studioState]);

  function acceptFile(file?: File) {
    if (file?.type.startsWith("image/")) {
      setReference(file);
      setSourcePreviewUrl(URL.createObjectURL(file));
      setProcessedPreviewUrl(null);
      setPreviewUrl(null);
      setResultIsStatic(false);
      setSplitDirty(false);
      setAnimationFrames([]);
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

  async function createAsset(resplit = false) {
    if (!resplit && provider === "manual" && !reference) return;
    if (!prompt.trim() && !reference && assetKind !== "Character") return;
    setStudioState("creating");
    setCreationStep(0);
    setErrorMessage("");
    const form = new FormData();
    form.set("kind", assetKind.toLowerCase());
    form.set("prompt", prompt);
    if (reference) form.set("reference", reference);
    if (resplit && generationId) {
      form.set("splitSourceId", generationId);
      form.set("neckLine", String(splitLines.neck));
      form.set("hipLine", String(splitLines.hip));
    }
    try {
      const response = await fetch("/api/assets/create", { method: "POST", body: form });
      const result = await response.json() as {
        generationId?: string;
        image?: { base64: string; mimeType: string; width: number; height: number };
        sourceImage?: { base64: string; mimeType: string };
        processedImage?: { base64: string; mimeType: string; width: number; height: number };
        splitLines?: { neck: number; hip: number };
        asset?: { pipeline?: { poseSource?: string } };
        adapter?: { label: string };
        validation?: { status: AssetStatus; checks: Array<{ label: string; passed: boolean }> };
        animation?: AnimationFrame[];
        message?: string;
      };
      if (!response.ok || !result.image) throw new Error(result.message || t.createError);
      if (result.sourceImage) setSourcePreviewUrl(`data:${result.sourceImage.mimeType};base64,${result.sourceImage.base64}`);
      setProcessedPreviewUrl(result.processedImage ? `data:${result.processedImage.mimeType};base64,${result.processedImage.base64}` : null);
      if (result.processedImage) setProcessedSize({ width: result.processedImage.width, height: result.processedImage.height });
      const nextStatic = result.asset?.pipeline?.poseSource === "static";
      setResultIsStatic(nextStatic);
      if (result.splitLines) setSplitLines(result.splitLines);
      setSplitDirty(false);
      setPreviewUrl(`data:${result.image.mimeType};base64,${result.image.base64}`);
      setResultMeta({ adapter: result.adapter?.label || "Game adapter", width: result.image.width, height: result.image.height, status: result.validation?.status || "draft", checks: result.validation?.checks.filter((check) => check.passed).map((check) => check.label) || [] });
      setGenerationId(result.generationId || "");
      setAnimationFrames(result.animation || []);
      setAnimationState("idle");
      setAnimationIndex(0);
      setAnimationPlaying(true);
      setCreationStep(4);
      setExportStatus("idle");
      setExportMessage("");
      setStudioState("ready");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t.createError);
      setStudioState("error");
    }
  }

  async function exportAsset() {
    if (!generationId) return;
    setExportStatus("exporting");
    setErrorMessage("");
    try {
      const response = await fetch("/api/assets/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ generationId, delivery: "browser" }) });
      if (!response.ok) {
        const result = await response.json() as { message?: string };
        throw new Error(result.message || t.exportError);
      }
      const blob = await response.blob();
      const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "contentforge-asset.zip";
      if (exportMode === "browser-folder" && directoryHandle) {
        const file = await directoryHandle.getFileHandle(filename, { create: true });
        const writer = await file.createWritable();
        await writer.write(blob);
        await writer.close();
        setExportMessage(`${directoryHandle.name}/${filename}`);
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        setExportMessage(filename);
      }
      setExportStatus("done");
    } catch (error) {
      setExportStatus("idle");
      setErrorMessage(error instanceof Error ? error.message : t.exportError);
      setStudioState("ready");
    }
  }

  async function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: nextLocale }) }).catch(() => undefined);
  }

  async function toggleTheme() {
    const darkNow = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const nextTheme: ThemePreference = darkNow ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("contentforge-theme", nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme: nextTheme }) }).catch(() => undefined);
  }

  async function changeProvider(nextProvider: ProviderId) {
    setProvider(nextProvider);
    setProcessedPreviewUrl(null);
    setPreviewUrl(null);
    setResultIsStatic(false);
    setSplitDirty(false);
    setAnimationFrames([]);
    setStudioState("empty");
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: nextProvider, imageModel: "auto" }) }).catch(() => undefined);
  }

  async function chooseExportFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<BrowserDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      setExportMode("download");
      setExportMessage(t.folderApiUnavailable);
      return;
    }
    try {
      const handle = await picker({ mode: "readwrite" });
      setDirectoryHandle(handle);
      setExportMode("browser-folder");
      setExportMessage(`${t.folderSelected}: ${handle.name}`);
      await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exportMode: "browser-folder" }) }).catch(() => undefined);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setExportMessage(t.folderApiUnavailable);
    }
  }

  async function useBrowserDownload() {
    setExportMode("download");
    setDirectoryHandle(null);
    await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exportMode: "download" }) }).catch(() => undefined);
  }

  function tryAgain() {
    setProcessedPreviewUrl(null);
    setPreviewUrl(null);
    setResultIsStatic(false);
    setSplitDirty(false);
    setAnimationFrames([]);
    setGenerationId("");
    setExportStatus("idle");
    setExportMessage("");
    setStudioState("empty");
  }

  return (
    <main className="min-h-[100dvh] bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[color:var(--canvas)/0.94]">
        <div className="mx-auto flex h-18 max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-[10px] bg-[var(--ink)] font-mono text-xs font-semibold text-[var(--canvas)]">CF</div>
            <div>
              <p className="text-[15px] font-semibold tracking-[-0.02em]">ContentForge</p>
              <p className="text-xs text-[var(--muted)]">{t.brandSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button className="control-button hidden sm:inline-flex" type="button" onClick={() => setSettingsOpen(true)}>{projectLabel || t.untitledProject}</button>
            <div className="flex rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] p-0.5" aria-label={t.language}>
              {(["vi", "en"] as const).map((language) => <button key={language} type="button" aria-pressed={locale === language} onClick={() => changeLocale(language)} className={`min-h-8 rounded-[7px] px-2.5 font-mono text-[10px] font-semibold uppercase ${locale === language ? "bg-[var(--ink)] text-[var(--surface)]" : "text-[var(--muted)]"}`}>{language}</button>)}
            </div>
            <button className="control-button size-10 px-0" type="button" onClick={toggleTheme} aria-label={t.toggleTheme} title={t.toggleTheme}>{theme === "dark" ? "☼" : "◐"}</button>
            <button className="control-button" type="button" onClick={() => setSettingsOpen(true)}>{t.settings}</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 sm:py-9 lg:px-10">
        <section className="mb-7 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">{t.newAsset}</p>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{t.whatMake}</h1>
              <button type="button" className="info-tip" aria-label={t.usageHelp}>
                <span aria-hidden="true">?</span>
                <span className="info-tip-bubble" role="tooltip">{t.usageTooltip}</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-[var(--soft)] p-1 sm:flex" aria-label={t.assetType}>
            {assetKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={assetKind === kind}
                onClick={() => { setAssetKind(kind); setStudioState("empty"); }}
                className={`min-h-11 rounded-[10px] px-4 text-sm font-medium transition active:translate-y-px ${assetKind === kind ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_4px_rgba(38,32,24,0.08)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}
              >
                {t[kind.toLowerCase() as "character" | "environment" | "item" | "effect"]}
              </button>
            ))}
          </div>
        </section>

        <section className="grid min-h-[610px] overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_24px_70px_rgba(63,49,33,0.07)] lg:grid-cols-[minmax(340px,0.78fr)_minmax(480px,1.22fr)]">
          <div className="flex flex-col border-b border-[var(--line)] p-5 sm:p-7 lg:border-r lg:border-b-0 lg:p-8">
            <div className="mb-7">
              <h2 className="mb-1 text-lg font-semibold tracking-[-0.025em]">{t.shapeIdea}</h2>
              <p className="text-sm leading-6 text-[var(--muted)]">{t.shapeDescription}</p>
            </div>

            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--faint)]">{t.generationSource}</p>
              <div className="rounded-[12px] border border-[var(--line-strong)] bg-[var(--canvas)] p-3">
                <div className="grid grid-cols-2 gap-1 rounded-[9px] bg-[var(--soft)] p-1">
                  <button type="button" aria-pressed={activeProviderDefinition.kind === "local"} onClick={() => changeProvider("manual")} className={`min-h-9 rounded-[7px] px-3 text-xs font-semibold transition ${activeProviderDefinition.kind === "local" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_4px_rgba(0,0,0,0.1)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{t.directMode}</button>
                  <button type="button" aria-pressed={activeProviderDefinition.kind === "remote"} onClick={() => changeProvider(activeProviderDefinition.kind === "remote" ? provider : "openai")} className={`min-h-9 rounded-[7px] px-3 text-xs font-semibold transition ${activeProviderDefinition.kind === "remote" ? "bg-[var(--surface)] text-[var(--ink)] shadow-[0_1px_4px_rgba(0,0,0,0.1)]" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{t.aiApiMode}</button>
                </div>
                {activeProviderDefinition.kind === "remote" ? (
                  <div className="mt-3 flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--soft)] font-mono text-[10px] font-bold text-[var(--accent-strong)]">AI</span>
                    <select id="generation-provider" name="generation-provider" className="field min-w-0 flex-1 bg-[var(--surface)]" value={provider} onChange={(event) => changeProvider(event.target.value as ProviderId)} aria-label={t.provider}>
                      {remoteProviders.map((item) => <option key={item.id} value={item.id}>{providerCopy[item.id].label}</option>)}
                    </select>
                  </div>
                ) : <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{activeProvider.description}</p>}
                {activeProviderDefinition.kind === "remote" && <p className="mt-2 pl-11 text-xs leading-5 text-[var(--muted)]">{activeProvider.description}</p>}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-[var(--faint)]">{t.providerPickerHelp}</p>
              {assetKind === "Character" && activeProviderDefinition.kind === "remote" && <p className="mt-2 text-[11px] leading-4 text-[var(--muted)]">{t.aiCostHint}</p>}
            </div>

            <label className="mb-3 text-sm font-semibold" htmlFor="asset-prompt">{t.describe} {t[assetKind.toLowerCase() as "character" | "environment" | "item" | "effect"].toLowerCase()}</label>
            <textarea
              id="asset-prompt"
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); setStudioState("empty"); }}
              placeholder={assetKind === "Character" ? t.characterPlaceholder : t.genericPlaceholder}
              className="min-h-32 resize-none rounded-[12px] border border-[var(--line-strong)] bg-[var(--canvas)] px-4 py-3 text-[15px] leading-6 outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-soft)]"
            />

            <div className="my-5 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--faint)]">
              <span className="h-px flex-1 bg-[var(--line)]" />{isReferenceFirst ? t.sourceImage : t.optionalReference}<span className="h-px flex-1 bg-[var(--line)]" />
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
                <p className="truncate text-sm font-semibold">{reference ? reference.name : t.dropImage}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{reference ? (isReferenceFirst ? t.referencePreserveHelp : t.referenceReady) : t.fileHelp}</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handleFileChange} />
            </div>

            <div className="mt-auto pt-7">
              <div className="mb-3 flex items-center justify-between text-xs text-[var(--muted)]">
                <span>{activeProvider.description}</span>
                <button type="button" className="font-medium text-[var(--ink)] underline decoration-[var(--line-strong)] underline-offset-4" onClick={() => setSettingsOpen(true)}>{t.change}</button>
              </div>
              {requiresReference && !reference && <p className="mb-3 rounded-[10px] bg-[var(--soft)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">{t.manualNeedsImage}</p>}
              <button type="button" onClick={() => createAsset(false)} disabled={(!prompt.trim() && !reference && assetKind !== "Character") || (requiresReference && !reference) || studioState === "creating"} className="primary-button w-full">
                {studioState === "creating" ? t.creating : isReferenceFirst ? t.processReference : !prompt.trim() && !reference ? t.createVariation : t.create}
              </button>
            </div>
          </div>

          <div className="relative flex min-h-[500px] flex-col bg-[var(--preview)] p-4 sm:p-6 lg:p-8">
            <div className="mb-4 flex items-center justify-between">
              <div><p className="text-sm font-semibold">{showSplitPreview ? t.referencePipeline : t.gamePreview}</p><p className="mt-0.5 text-xs text-[var(--muted)]">{showSplitPreview ? t.referencePipelineHelp : `${resultMeta.adapter} ${t.profile}`}</p></div>
              <span className="rounded-[8px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{resultMeta.width} × {resultMeta.height}</span>
            </div>

            <div className="preview-grid relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--line-strong)]">
              {studioState === "creating" ? (
                <div className="w-full max-w-sm px-8 text-center">
                  <div className="mb-5 h-2 overflow-hidden rounded-full bg-[var(--line)]"><div className="forge-progress h-full w-1/2 rounded-full bg-[var(--accent)]" /></div>
                  <p className="text-sm font-semibold">{assetKind === "Character" ? t.preservingReference : t.preparing}</p>
                  <div className="mt-4 space-y-2 text-left text-xs text-[var(--muted)]">
                    {creationStages.map((step, index) => <p key={step} className={`flex items-center gap-2 ${index <= creationStep ? "text-[var(--ink)]" : "text-[var(--faint)]"}`}><span className="grid size-4 place-items-center rounded-full border border-current font-mono text-[9px]">{index < creationStep ? "✓" : index === creationStep ? "•" : ""}</span>{step}</p>)}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{assetKind === "Character" ? t.referenceProcessingHelp : t.normalizing}</p>
                </div>
              ) : showSplitPreview ? (
                <div className="grid w-full max-w-[820px] gap-3 p-3 sm:grid-cols-3 sm:gap-4 sm:p-5">
                  {[
                    { label: t.source, note: t.originalImage, url: sourcePreviewUrl, alt: t.sourcePreview, split: false },
                    { label: t.processed, note: processedPreviewUrl ? `${processedSize.width} × ${processedSize.height}` : t.backgroundCleaned, url: processedPreviewUrl, alt: t.processedPreview, split: true },
                    { label: t.gamePreview, note: "64 × 128", url: previewUrl, alt: t.characterPreview, split: false },
                  ].map((panel) => (
                    <figure key={panel.label} className="min-w-0">
                      <div className="relative min-h-56 overflow-hidden rounded-[11px] border border-[var(--line)] bg-[var(--surface)] shadow-[0_12px_34px_rgba(49,41,31,0.08)] sm:aspect-[3/4] sm:min-h-0">
                        {panel.url ? <Image src={panel.url} alt={panel.alt} fill unoptimized className="object-contain p-3" /> : <div className="absolute inset-0 grid place-items-center"><span className="font-mono text-xs text-[var(--faint)]">—</span></div>}
                        {panel.split && panel.url && <div className="pointer-events-none absolute inset-3">
                          <span className="absolute left-0 right-0 z-10 border-t-2 border-[var(--accent)]" style={{ top: `${splitLines.neck * 100}%` }}><span className="absolute right-0 -top-5 rounded-[4px] bg-[var(--accent)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-white">{t.neckLine}</span></span>
                          <span className="absolute left-0 right-0 z-10 border-t-2 border-[var(--ink)]" style={{ top: `${splitLines.hip * 100}%` }}><span className="absolute right-0 -top-5 rounded-[4px] bg-[var(--ink)] px-1.5 py-0.5 font-mono text-[8px] font-semibold uppercase text-[var(--surface)]">{t.hipLine}</span></span>
                        </div>}
                      </div>
                      <figcaption className="mt-3 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-[var(--ink)]">{panel.label}</span>
                        <span className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-[var(--faint)]">{panel.note}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (previewUrl || sourcePreviewUrl) ? (
                <div className="relative size-[min(64vw,330px)] max-h-[330px] max-w-[330px] overflow-hidden rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_18px_50px_rgba(49,41,31,0.13)]">
                  <Image src={displayedFrame ? `data:${displayedFrame.mimeType};base64,${displayedFrame.base64}` : (previewUrl || sourcePreviewUrl)!} alt={displayedFrame ? `${t.characterPreview} ${stateLabels[animationState]}` : t.uploadedPreview} fill unoptimized className="object-contain [image-rendering:pixelated]" />
                </div>
              ) : (
                <div className="max-w-xs px-6 text-center">
                  <div className="mx-auto mb-5 grid size-20 place-items-center rounded-[16px] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[0_10px_30px_rgba(49,41,31,0.08)]"><span className="font-mono text-lg font-semibold text-[var(--faint)]">64</span></div>
                  <p className="text-sm font-semibold">{t.emptyPreview}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t.emptyPreviewHelp}</p>
                </div>
              )}
            </div>

            <div className="mt-4 min-h-16">
              {errorMessage && <div className="mb-3 rounded-[10px] bg-[var(--error-soft)] px-3 py-2 text-sm text-[var(--error)]" role="alert">{errorMessage}</div>}
              {showSplitPreview && processedPreviewUrl && studioState === "ready" && <div className="mb-4 grid gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-xs font-semibold text-[var(--muted)]">{t.neckLine}<span className="ml-2 font-mono text-[10px] text-[var(--faint)]">{Math.round(splitLines.neck * 100)}%</span><input className="mt-2 block w-full accent-[var(--accent)]" type="range" min="0.16" max="0.42" step="0.005" value={splitLines.neck} onChange={(event) => { const neck = Math.min(Number(event.target.value), splitLines.hip - 0.12); setSplitLines((current) => ({ ...current, neck })); setSplitDirty(true); }} /></label>
                <label className="text-xs font-semibold text-[var(--muted)]">{t.hipLine}<span className="ml-2 font-mono text-[10px] text-[var(--faint)]">{Math.round(splitLines.hip * 100)}%</span><input className="mt-2 block w-full accent-[var(--ink)]" type="range" min="0.5" max="0.75" step="0.005" value={splitLines.hip} onChange={(event) => { const hip = Math.max(Number(event.target.value), splitLines.neck + 0.12); setSplitLines((current) => ({ ...current, hip })); setSplitDirty(true); }} /></label>
                <button type="button" className="control-button min-h-10" disabled={!splitDirty || studioState === "creating"} onClick={() => createAsset(true)}>{t.applySplit}</button>
              </div>}
              {animationFrames.length > 0 && studioState === "ready" && <div className="mb-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
                <span className="mr-1 text-xs font-semibold text-[var(--muted)]">{t.animationPreview}</span>
                {(["idle", "run", "jump", "fall", "attack", "hurt"] as const).map((state) => <button key={state} type="button" className={`control-button min-h-9 ${animationState === state ? "border-[var(--accent)]" : ""}`} onClick={() => { setAnimationState(state); setAnimationIndex(0); }}>{stateLabels[state]}</button>)}
                <button type="button" className="control-button min-h-9" onClick={() => setAnimationPlaying((playing) => !playing)}>{animationPlaying ? t.pauseAnimation : t.playAnimation}</button>
              </div>}
              {studioState === "ready" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><p className={`text-sm font-semibold ${exportReady ? "text-[var(--success)]" : resultMeta.status === "playable" ? "text-[var(--accent-strong)]" : "text-[var(--muted)]"}`}>{resultMeta.status === "static-ready" ? t.staticReady : resultMeta.status === "game-ready" ? t.gameReady : resultMeta.status === "playable" ? t.playable : t.draft}</p><p className="mt-1 text-xs text-[var(--muted)]">{resultMeta.checks.join(", ")}</p></div>
                  <div className="flex gap-2"><button type="button" className="control-button" onClick={tryAgain}>{t.tryAgain}</button><button type="button" className="primary-button px-6" onClick={exportAsset} disabled={exportStatus === "exporting" || !exportReady} title={!exportReady ? t.exportNeedsReady : undefined}>{exportStatus === "exporting" ? t.exporting : t.export}</button></div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
                    <span className="mr-1 text-xs font-semibold text-[var(--muted)]">{t.exportDestination}</span>
                    <button type="button" className={`control-button min-h-9 ${exportMode === "download" ? "border-[var(--accent)]" : ""}`} onClick={useBrowserDownload}>{t.browserDownload}</button>
                    <button type="button" className={`control-button min-h-9 ${exportMode === "browser-folder" ? "border-[var(--accent)]" : ""}`} onClick={chooseExportFolder}>{directoryHandle ? `${t.folderSelected}: ${directoryHandle.name}` : t.chooseFolder}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-[var(--muted)]"><span>{t.previewReflects}</span><span className="font-mono">PNG</span></div>
              )}
              {exportStatus === "done" && <p className="mt-3 break-all rounded-[10px] bg-[var(--success-soft)] px-3 py-2 text-xs text-[var(--success)]" role="status">{t.savedTo} {exportMessage}</p>}
            </div>
          </div>
        </section>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={handleSettingsSaved} locale={locale} />
    </main>
  );
}
