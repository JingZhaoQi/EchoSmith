// URL-based task creation form for EchoSmith online video transcription.
import { FormEvent, useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  LinkIcon,
  PlayIcon,
  ClipboardPasteIcon,
  VideoIcon,
  Music2Icon,
  CheckCircle2Icon,
  DownloadIcon,
  BadgeCheckIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromUrl, downloadMedia } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { localizeBackendMessage, useLocaleStore, useT, type Messages } from "../lib/i18n";

function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[,.;:!?。，；：！？]+$/, "") : text.trim();
}

function detectPlatform(text: string, t: Messages): { name: string; hint: string } {
  const value = text.toLowerCase();
  if (!value.trim()) return { name: t.platformWaiting, hint: t.platformWaitingHint };
  if (value.includes("bilibili.com") || value.includes("b23.tv")) {
    return { name: "Bilibili", hint: t.platformBilibiliHint };
  }
  if (value.includes("youtube.com") || value.includes("youtu.be")) {
    return { name: "YouTube", hint: t.platformYoutubeHint };
  }
  if (value.includes("douyin.com") || value.includes("iesdouyin.com")) {
    return { name: t.platformDouyin, hint: t.platformDouyinHint };
  }
  if (value.includes("x.com") || value.includes("twitter.com")) {
    return { name: "Twitter/X", hint: t.platformXHint };
  }
  return { name: t.platformGeneric, hint: t.platformGenericHint };
}

export function UrlTaskComposer(): JSX.Element {
  const [url, setUrl] = useState("");
  const [dlProgress, setDlProgress] = useState<{ ratio: number; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const upsertTask = useTasksStore((state) => state.upsertTask);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);

  const mutation = useMutation({
    mutationFn: async (videoUrl: string) => {
      const taskId = await createTaskFromUrl(videoUrl);

      upsertTask({
        id: taskId,
        status: "queued",
        progress: 0,
        message: "排队中",
        result_text: "",
        segments: [],
        source: { type: "url", url: videoUrl, name: videoUrl },
        error: null,
        logs: [],
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
      });

      setActiveTask(taskId);
      return taskId;
    },
    onSuccess: () => {
      setUrl("");
    },
  });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const dlMutation = useMutation({
    mutationFn: async ({ rawUrl, mode }: { rawUrl: string; mode: "video" | "audio" }) => {
      const { downloadDir } = await import("@tauri-apps/api/path");
      const saveDir = await downloadDir();
      setDlProgress({ ratio: 0, message: t.preparingDownload });
      return downloadMedia(rawUrl, saveDir, mode, (ratio, message) => {
        setDlProgress({ ratio, message });
      });
    },
    onSuccess: (data) => {
      setDlProgress(null);
      showToast(t.savedToDownloads(data.filename));
    },
    onError: () => {
      setDlProgress(null);
    },
  });

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(extractUrl(text));
    } catch {
      // Clipboard access denied - ignore
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    mutation.mutate(trimmed);
  };

  const handleDownload = (mode: "video" | "audio") => {
    const trimmed = url.trim();
    if (!trimmed) return;
    dlMutation.mutate({ rawUrl: trimmed, mode });
  };

  const canStart = url.trim().length > 0 && !mutation.isPending;
  const canDownload = url.trim().length > 0 && !dlMutation.isPending;
  const platform = detectPlatform(url, t);

  return (
    <form
      className="liquid-panel flex h-full min-h-[360px] flex-col gap-5 overflow-y-auto p-5"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t.urlTitle}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t.urlSubtitle}
        </p>
      </div>

      {/* URL input */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-900 dark:text-white">
            {t.videoLink}
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t.urlPlaceholder}
                className="glass-field w-full rounded-2xl py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 transition-all focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:placeholder:text-slate-500"
              />
            </div>
            <button
              type="button"
              onClick={handlePaste}
              className="glass-field rounded-2xl px-3 py-2.5 text-slate-600 transition-colors hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/[0.10]"
              title={t.pasteFromClipboard}
            >
              <ClipboardPasteIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Supported platforms hint */}
        <div className="glass-field rounded-2xl px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
              <BadgeCheckIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                {platform.name}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {platform.hint}
              </p>
            </div>
          </div>
        </div>

        {/* Progress hints */}
        {mutation.isPending && (
          <div className="flex items-center gap-2 rounded-2xl border border-sky-500/10 bg-sky-500/5 px-4 py-3 dark:bg-sky-400/5">
            <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="text-xs text-sky-700 dark:text-sky-300">
              {t.creatingTaskHint}
            </p>
          </div>
        )}

        {/* Download progress bar */}
        {dlMutation.isPending && dlProgress && (
          <div className="rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-4 py-3 dark:bg-emerald-400/5">
            <div className="flex items-center gap-2 mb-2">
              <DownloadIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 flex-1">
                {localizeBackendMessage(dlProgress.message, locale)}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-emerald-200/60 dark:bg-emerald-900/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-300 ease-out"
                style={{ width: `${Math.min(dlProgress.ratio * 100, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Transcribe button */}
      <div className="flex flex-col gap-2 mt-4">
        <Button
          type="submit"
          variant="default"
          className="gap-2 w-full"
          disabled={!canStart}
        >
          <PlayIcon className="h-4 w-4" />
          {mutation.isPending ? t.creating : t.startTranscription}
        </Button>

        {/* Download buttons */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5 flex-1"
            disabled={!canDownload}
            onClick={() => handleDownload("video")}
          >
            <VideoIcon className="h-4 w-4" />
            {t.downloadVideo}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5 flex-1"
            disabled={!canDownload}
            onClick={() => handleDownload("audio")}
          >
            <Music2Icon className="h-4 w-4" />
            {t.downloadAudio}
          </Button>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(mutation.error as Error).message || t.createTaskFailed}
        </p>
      )}
      {dlMutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(dlMutation.error as Error).message || t.downloadFailed}
        </p>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-zinc-800/80 dark:bg-zinc-700/80 backdrop-blur-sm text-white/90 shadow-md min-w-[320px] max-w-[480px]">
            <CheckCircle2Icon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
            <span className="text-xs">{toast}</span>
          </div>
        </div>
      )}
    </form>
  );
}
