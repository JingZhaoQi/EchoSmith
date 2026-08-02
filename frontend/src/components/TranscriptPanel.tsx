// Unified transcript panel. Shows corrected text when correction is active, otherwise ASR text.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import { TaskStreamPanel } from "./TaskStreamPanel";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { exportTask } from "../lib/api";
import { STATUS_LABELS, getSourceLabel } from "../lib/constants";
import { useTasksStore } from "../hooks/useTasksStore";

const FORMAT_LABELS: Array<{ format: "txt" | "srt" | "json"; label: string }> = [
  { format: "txt", label: "TXT" },
  { format: "srt", label: "SRT" },
  { format: "json", label: "JSON" }
];

const EXPORTABLE_STATUSES: TaskStatus[] = ["paused", "completed", "failed", "cancelled"];

function toDownloadName(task: TaskSnapshot, format: string, correctionActive: boolean): string {
  const source = task.source ?? {};
  const name = (source as Record<string, unknown>).name;
  const base = typeof name === "string" && name.length > 0 ? name : task.id;
  const parts = base.split(/[\\/]/);
  const last = parts[parts.length - 1] ?? task.id;
  const withoutExt = last.includes(".") ? last.replace(/\.[^.]+$/, "") : last;
  const suffix = correctionActive ? "corrected" : "transcript";
  return `${withoutExt || task.id}_${suffix}.${format}`;
}

interface TranscriptPanelProps {
  correctionActive: boolean;
}

export function TranscriptPanel({ correctionActive }: TranscriptPanelProps): JSX.Element {
  const { tasks, activeTaskId } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId
  }));
  const task = activeTaskId ? tasks[activeTaskId] : undefined;
  const [saving, setSaving] = useState<"txt" | "srt" | "json" | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  const isTerminal =
    task?.status === "completed" ||
    task?.status === "failed" ||
    task?.status === "cancelled";
  const isCompleted = task?.status === "completed";
  const isPaused = task?.status === "paused";
  const isRunning = task?.status === "running";
  const progress = task?.progress ?? 0;
  const message = task?.message ?? "";
  const isCorrecting = correctionActive && isRunning && message.includes("纠错");
  const isTranscribing = isRunning && !isCorrecting;
  const sourceName = task ? getSourceLabel(task.source, 72) : "";
  const taskProgress = Math.round(progress * 100);
  const isFailed = task?.status === "failed";

  const progressValue = useMemo(() => {
    if (isCorrecting) {
      return Math.min(100, Math.max(0, Math.round(((progress - 0.96) / 0.03) * 100)));
    }
    return Math.min(100, Math.round(Math.min(progress / 0.95, 1.0) * 100));
  }, [isCorrecting, progress]);

  useEffect(() => {
    if (!resultRef.current) return;
    resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [task?.result_text, task?.segments?.length, activeTaskId]);

  const handleCopy = async () => {
    if (!task?.result_text) return;
    try {
      setCopying(true);
      await navigator.clipboard.writeText(task.result_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setCopying(false);
    }
  };

  const handleExport = async (format: "txt" | "srt" | "json") => {
    if (!task) return;
    try {
      setSaving(format);
      const blob = await exportTask(task.id, format);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = toDownloadName(task, format, correctionActive);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      console.error("导出失败");
    } finally {
      setSaving(null);
    }
  };

  const canCopy = Boolean(task?.result_text) && !copying;
  const canExport = Boolean(task && EXPORTABLE_STATUSES.includes(task.status));
  const modeLabel = correctionActive ? "智能纠错" : "识别结果";
  const title = correctionActive ? "智能纠错结果" : "语音识别结果";

  const statusText = (() => {
    if (!task) return "等待任务";
    if (isCorrecting) return `智能纠错中 · ${progressValue}%`;
    if (isTranscribing) return `${message || "转写中"} · ${progressValue}%`;
    if (isCompleted) return correctionActive ? "智能纠错完成" : "识别完成";
    if (isPaused) return "已暂停";
    if (isTerminal) return STATUS_LABELS[task.status] ?? task.status;
    return STATUS_LABELS[task.status] ?? task.status;
  })();

  return (
    <Card className="h-full min-h-0 !flex !flex-col !space-y-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {correctionActive ? (
            <SparklesIcon className="h-4 w-4 flex-shrink-0 text-teal-600 dark:text-teal-300" />
          ) : (
            <FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500 dark:text-slate-300" />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {correctionActive ? "已配置 API Key，任务完成后显示纠错文本" : "未配置 API Key，显示本地识别文本"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="status-pill flex-shrink-0">{modeLabel}</span>
          <span className="status-pill flex-shrink-0">{statusText}</span>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-900/10 bg-white/45 p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-teal-500/12 text-teal-700 dark:bg-teal-400/12 dark:text-teal-200">
                {isFailed ? (
                  <AlertTriangleIcon className="h-4 w-4" />
                ) : (
                  <ActivityIcon className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
                  {task ? sourceName || task.id.slice(0, 8) : "等待选择媒体任务"}
                </h3>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {task ? task.message || STATUS_LABELS[task.status] || task.status : "从下方添加本地文件或在线视频"}
                </p>
              </div>
            </div>

            {task?.error && (
              <div className="mt-3 rounded-2xl border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
                {task.error}
              </div>
            )}
          </div>

          <div className="flex min-w-[92px] flex-col items-end">
            <span
              className={
                isFailed
                  ? "status-pill status-pill-danger"
                  : task?.status === "completed"
                    ? "status-pill status-pill-success"
                    : "status-pill"
              }
            >
              <FileTextIcon className="h-3.5 w-3.5" />
              {task ? STATUS_LABELS[task.status] ?? task.status : "未开始"}
            </span>
            <span className="mt-2 text-lg font-semibold tabular-nums text-slate-950 dark:text-white">
              {taskProgress}%
            </span>
          </div>
        </div>

        <Progress
          value={taskProgress}
          variant={isFailed ? "error" : task?.status === "completed" ? "success" : "default"}
          animated={task?.status === "running"}
          className="mt-4"
        />

        <TaskStreamPanel />
      </section>

      <div
        ref={resultRef}
        className="glass-field min-h-[180px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl p-5 text-sm leading-7 text-slate-800 dark:text-slate-100"
      >
        {task?.result_text ? (
          task.result_text
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            {correctionActive ? (
              <SparklesIcon className="h-9 w-9 opacity-20" />
            ) : (
              <FileTextIcon className="h-9 w-9 opacity-20" />
            )}
            <span className="text-xs">
              {task ? "结果会随着任务进度显示在这里。" : "选择或创建任务后，这里会显示转写结果。"}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-10 gap-2 rounded-2xl px-4"
          disabled={!canCopy}
          onClick={handleCopy}
        >
          <CopyIcon className="h-3.5 w-3.5" />
          {copied ? "已复制" : "复制"}
        </Button>
        <div className="flex-1" />
        {FORMAT_LABELS.map(({ format, label }) => (
          <Button
            key={format}
            variant="secondary"
            size="sm"
            className="h-10 min-w-[88px] gap-2 rounded-2xl px-4"
            disabled={!canExport || saving !== null}
            onClick={() => handleExport(format)}
          >
            {saving === format ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <DownloadIcon className="h-3.5 w-3.5" />
            )}
            {label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
