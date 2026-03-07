// URL-based task creation form for EchoSmith online video transcription.
import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { LinkIcon, PlayIcon, ClipboardPasteIcon } from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromUrl } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

export function UrlTaskComposer(): JSX.Element {
  const [url, setUrl] = useState("");

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

  const extractUrl = (text: string): string => {
    const m = text.match(/https?:\/\/[^\s<>"']+/);
    return m ? m[0].replace(/[,.;:!?。，；：！？]+$/, "") : text.trim();
  };

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
    // Send raw text — backend will extract URL if needed
    mutation.mutate(trimmed);
  };

  const canStart = url.trim().length > 0 && !mutation.isPending;

  return (
    <form
      className="rounded-[20px] border border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out p-6 flex flex-col gap-5 min-h-[420px]"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold">在线视频转写</h2>
        <p className="text-xs text-muted-foreground mt-1">
          粘贴视频链接，自动下载音频并转写为文字
        </p>
      </div>

      {/* URL input */}
      <div className="flex-1 flex flex-col gap-4">
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

        {/* Progress hint when running */}
        {mutation.isPending && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-indigo-500/5 dark:bg-indigo-400/5 border border-indigo-500/10 dark:border-indigo-400/10">
            <div className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              正在创建任务，请在右侧面板查看进度…
            </p>
          </div>
        )}
      </div>

      {/* Start button */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          variant="default"
          className="gap-2 flex-1"
          disabled={!canStart}
        >
          <PlayIcon className="h-4 w-4" />
          {mutation.isPending ? "创建中…" : "开始转写"}
        </Button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(mutation.error as Error).message || "创建任务失败"}
        </p>
      )}
    </form>
  );
}
