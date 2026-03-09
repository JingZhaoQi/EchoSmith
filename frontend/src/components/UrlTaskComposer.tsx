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
} from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromUrl, downloadMedia } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[,.;:!?。，；：！？]+$/, "") : text.trim();
}

export function UrlTaskComposer(): JSX.Element {
  const [url, setUrl] = useState("");
  const [dlProgress, setDlProgress] = useState<{ ratio: number; message: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
      setDlProgress({ ratio: 0, message: "准备下载…" });
      return downloadMedia(rawUrl, saveDir, mode, (ratio, message) => {
        setDlProgress({ ratio, message });
      });
    },
    onSuccess: (data) => {
      setDlProgress(null);
      showToast(`已保存到 Downloads 目录：${data.filename}`);
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

  return (
    <form
      className="rounded-[20px] border border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out p-6 flex flex-col gap-5 h-full min-h-[420px]"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold">在线视频转写</h2>
        <p className="text-xs text-muted-foreground mt-1">
          粘贴视频链接，自动下载音频并转写为文字
        </p>
      </div>

      {/* URL input */}
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
            视频链接
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="粘贴视频链接或分享文本…"
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-zinc-800/60 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 transition-all"
              />
            </div>
            <button
              type="button"
              onClick={handlePaste}
              className="px-3 py-2.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] transition-colors text-gray-600 dark:text-gray-300"
              title="从剪贴板粘贴"
            >
              <ClipboardPasteIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Supported platforms hint */}
        <div className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            支持 YouTube、Bilibili、Twitter/X、抖音等 1000+ 平台。粘贴视频页面链接即可，应用会自动下载音频并转写。
          </p>
        </div>

        {/* Progress hints */}
        {mutation.isPending && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-indigo-500/5 dark:bg-indigo-400/5 border border-indigo-500/10 dark:border-indigo-400/10">
            <div className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              正在创建任务，请在右侧面板查看进度…
            </p>
          </div>
        )}

        {/* Download progress bar */}
        {dlMutation.isPending && dlProgress && (
          <div className="px-4 py-3 rounded-xl bg-emerald-500/5 dark:bg-emerald-400/5 border border-emerald-500/10 dark:border-emerald-400/10">
            <div className="flex items-center gap-2 mb-2">
              <DownloadIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 flex-1">
                {dlProgress.message}
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
          {mutation.isPending ? "创建中…" : "开始转写"}
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
            下载视频
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5 flex-1"
            disabled={!canDownload}
            onClick={() => handleDownload("audio")}
          >
            <Music2Icon className="h-4 w-4" />
            下载音频
          </Button>
        </div>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(mutation.error as Error).message || "创建任务失败"}
        </p>
      )}
      {dlMutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(dlMutation.error as Error).message || "下载失败"}
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
