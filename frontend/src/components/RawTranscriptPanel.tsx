// Raw ASR transcript panel: streams local recognition text with its own progress.
import { useEffect, useMemo, useRef } from "react";
import { AlertTriangleIcon, FileTextIcon } from "lucide-react";

import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import { useTasksStore } from "../hooks/useTasksStore";
import { getSourceLabel } from "../lib/constants";
import { localizeBackendMessage, useLocaleStore, useT } from "../lib/i18n";

export function RawTranscriptPanel(): JSX.Element {
  const { tasks, activeTaskId } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
  }));
  const task = activeTaskId ? tasks[activeTaskId] : undefined;
  const resultRef = useRef<HTMLDivElement | null>(null);
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);

  const isFailed = task?.status === "failed";
  const isRunning = task?.status === "running" || task?.status === "queued";

  // ASR phase maps to 0 ~ 0.92 of overall progress.
  const asrProgress = useMemo(() => {
    if (!task) return 0;
    if (task.status === "completed") return 100;
    return Math.min(100, Math.round(Math.min((task.progress ?? 0) / 0.92, 1) * 100));
  }, [task]);

  // raw_text carries the pre-correction transcript; fall back to result_text
  // for tasks recorded before raw_text existed.
  const rawText = task?.raw_text ?? task?.result_text ?? "";

  useEffect(() => {
    if (!resultRef.current) return;
    resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [rawText, activeTaskId]);

  const statusText = (() => {
    if (!task) return t.waitingTask;
    if (isFailed) return t.recognitionFailed;
    if (isRunning) return task.message ? localizeBackendMessage(task.message, locale) : t.transcribing;
    return t.status[task.status] ?? task.status;
  })();

  return (
    <Card className="flex h-full min-h-0 flex-col gap-3 !space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isFailed ? (
            <AlertTriangleIcon className="h-4 w-4 flex-shrink-0 text-red-500" />
          ) : (
            <FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500 dark:text-slate-300" />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
              {t.rawTitle}
            </h2>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {task ? getSourceLabel(task.source, 48) || task.id.slice(0, 8) : t.rawSubtitle}
            </p>
          </div>
        </div>
        <span className={`status-pill flex-shrink-0 ${isFailed ? "status-pill-danger" : task?.status === "completed" ? "status-pill-success" : ""}`}>
          {statusText}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <Progress
          value={asrProgress}
          variant={isFailed ? "error" : asrProgress >= 100 ? "success" : "default"}
          animated={isRunning}
          className="flex-1"
        />
        <span className="w-10 text-right text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
          {asrProgress}%
        </span>
      </div>

      {task?.error && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-200">
          {task.error}
        </div>
      )}

      <div
        ref={resultRef}
        className="glass-field min-h-[120px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl p-4 text-sm leading-7 text-slate-800 dark:text-slate-100"
      >
        {rawText ? (
          rawText
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
            <FileTextIcon className="h-8 w-8 opacity-20" />
            <span className="text-xs">
              {task ? t.rawEmptyWithTask : t.selectOrCreateTask}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
