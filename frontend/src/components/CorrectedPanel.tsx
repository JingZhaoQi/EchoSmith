// Corrected transcript panel: streams LLM-corrected text plus copy/export actions.
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyIcon, DownloadIcon, SparklesIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { exportTask } from "../lib/api";
import { localizeBackendMessage, useLocaleStore, useT } from "../lib/i18n";
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

interface CorrectedPanelProps {
  correctionActive: boolean;
}

export function CorrectedPanel({ correctionActive }: CorrectedPanelProps): JSX.Element {
  const { tasks, activeTaskId } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
  }));
  const task = activeTaskId ? tasks[activeTaskId] : undefined;
  const [saving, setSaving] = useState<"txt" | "srt" | "json" | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const isCompleted = task?.status === "completed";
  const isRunning = task?.status === "running";
  const message = task?.message ?? "";
  // Correction output starts once the backend reports correction batches.
  const correctionStarted =
    correctionActive && (isCompleted || message.includes("纠错"));

  // Correction phase maps to 0.92 ~ 0.99 of overall progress.
  const correctionProgress = useMemo(() => {
    if (!task || !correctionActive) return 0;
    if (isCompleted) return 100;
    if (!correctionStarted) return 0;
    const value = ((task.progress ?? 0) - 0.92) / 0.07;
    return Math.min(100, Math.max(0, Math.round(value * 100)));
  }, [task, correctionActive, correctionStarted, isCompleted]);

  // When correction is disabled, result_text holds the raw transcript and is
  // exported as-is; the panel itself shows the "not enabled" empty state.
  const correctedText = correctionActive
    ? correctionStarted
      ? task?.result_text ?? ""
      : ""
    : "";
  const exportSourceText = correctionActive
    ? task?.result_text
    : task?.result_text ?? task?.raw_text;

  useEffect(() => {
    if (!resultRef.current) return;
    resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [correctedText, activeTaskId]);

  const handleCopy = async () => {
    const text = correctionActive ? correctedText : exportSourceText;
    if (!text) return;
    try {
      setCopying(true);
      await navigator.clipboard.writeText(text);
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

  const canCopy = Boolean(correctionActive ? correctedText : exportSourceText) && !copying;
  const canExport = Boolean(task && EXPORTABLE_STATUSES.includes(task.status));

  const statusText = (() => {
    if (!correctionActive) return t.notEnabled;
    if (!task) return t.waitingTask;
    if (isCompleted) return t.correctionDone;
    if (correctionStarted) return `${message ? localizeBackendMessage(message, locale) : t.correcting} · ${correctionProgress}%`;
    if (isRunning) return t.waitingCorrection;
    return t.status[task.status] ?? task.status;
  })();

  return (
    <Card className="flex h-full min-h-0 flex-col gap-3 !space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SparklesIcon className={`h-4 w-4 flex-shrink-0 ${correctionActive ? "text-teal-600 dark:text-teal-300" : "text-slate-400 dark:text-slate-500"}`} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
              {t.correctedTitle}
            </h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {correctionActive ? t.correctedSubtitleOn : t.correctedSubtitleOff}
            </p>
          </div>
        </div>
        <span className={`status-pill flex-shrink-0 ${correctionActive && isCompleted ? "status-pill-success" : ""}`}>
          {statusText}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Progress
          value={correctionProgress}
          variant={correctionProgress >= 100 ? "success" : "default"}
          animated={correctionActive && isRunning && correctionStarted}
          className="flex-1"
        />
        <span className="w-10 text-right text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
          {correctionActive ? `${correctionProgress}%` : "—"}
        </span>
      </div>

      <div
        ref={resultRef}
        className="glass-field min-h-[120px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl p-4 text-sm leading-7 text-slate-800 dark:text-slate-100"
      >
        {correctedText ? (
          correctedText
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            <SparklesIcon className="h-8 w-8 opacity-20" />
            <span className="px-4 text-center text-xs leading-5">
              {!correctionActive
                ? t.correctionDisabledHint
                : !task
                  ? t.selectOrCreateTask
                  : correctionStarted
                    ? t.correctedEmpty
                    : t.correctedPending}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-9 gap-2 rounded-2xl px-4"
          disabled={!canCopy}
          onClick={handleCopy}
        >
          <CopyIcon className="h-3.5 w-3.5" />
          {copied ? t.copied : t.copy}
        </Button>
        <div className="flex-1" />
        {FORMAT_LABELS.map(({ format, label }) => (
          <Button
            key={format}
            variant="secondary"
            size="sm"
            className="h-9 min-w-[80px] gap-2 rounded-2xl px-4"
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
