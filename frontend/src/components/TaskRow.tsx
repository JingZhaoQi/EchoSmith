// One row in the intake lists (batch files, online videos): status, progress, pause/resume, remove; click to view.
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  GlobeIcon,
  Loader2Icon,
  PauseCircleIcon,
  PauseIcon,
  PlayIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import { pauseTask, resumeTask, type TaskSnapshot, type TaskStatus } from "../lib/api";
import { useLocaleStore, useT } from "../lib/i18n";
import { taskStatusLabel } from "../lib/taskStatus";
import { useTasksStore } from "../hooks/useTasksStore";

function StatusIcon({ status }: { status: TaskStatus | "pending" }): JSX.Element {
  switch (status) {
    case "running":
      return <Loader2Icon className="h-4 w-4 flex-shrink-0 animate-spin text-sky-600 dark:text-sky-300" />;
    case "paused":
      return <PauseCircleIcon className="h-4 w-4 flex-shrink-0 text-amber-500 dark:text-amber-300" />;
    case "completed":
      return <CheckCircle2Icon className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-300" />;
    case "failed":
    case "cancelled":
      return <XCircleIcon className="h-4 w-4 flex-shrink-0 text-red-500 dark:text-red-300" />;
    default:
      return <CircleDashedIcon className="h-4 w-4 flex-shrink-0 text-slate-400 dark:text-slate-500" />;
  }
}

interface TaskRowProps {
  name: string;
  /** absent while a batch file is still waiting for its turn */
  task?: TaskSnapshot;
  /** shown instead of the task status (e.g. "Queued" for a pending file, or an error) */
  note?: string;
  error?: string;
  isUrl?: boolean;
  onRemove(): void;
}

export function TaskRow({ name, task, note, error, isUrl, onRemove }: TaskRowProps): JSX.Element {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const active = useTasksStore((state) => task !== undefined && state.activeTaskId === task.id);
  const selectTask = useTasksStore((state) => state.selectTask);
  const upsertTask = useTasksStore((state) => state.upsertTask);
  const isPaused = task?.status === "paused";
  const canPause = task?.status === "running" || isPaused;
  const progress = Math.round((task?.progress ?? 0) * 100);

  const pauseResume = async () => {
    if (!task) return;
    if (isPaused) await resumeTask(task.id);
    else await pauseTask(task.id);
    upsertTask({ ...task, status: isPaused ? "running" : "paused" });
  };

  return (
    <li
      role={task ? "button" : undefined}
      tabIndex={task ? 0 : undefined}
      aria-current={active ? "true" : undefined}
      onClick={task ? () => selectTask(task.id) : undefined}
      onKeyDown={(event) => {
        if (task && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          selectTask(task.id);
        }
      }}
      className={`rounded-2xl border px-3 py-2 text-sm transition-colors ${task ? "cursor-pointer" : ""} ${
        active
          ? "border-sky-500/40 bg-sky-500/10 dark:border-sky-400/30 dark:bg-sky-400/10"
          : "glass-field hover:bg-white/70 dark:hover:bg-white/[0.08]"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={task?.status ?? "pending"} />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-900 dark:text-white" title={name}>
          {isUrl && <GlobeIcon className="mr-1 inline h-3 w-3 opacity-60" />}
          {name}
        </span>
        {canPause && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            title={isPaused ? t.resume : t.pause}
            aria-label={isPaused ? t.resume : t.pause}
            onClick={(event) => {
              event.stopPropagation();
              void pauseResume();
            }}
          >
            {isPaused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-lg"
          title={t.remove}
          aria-label={`${t.remove} ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <XIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-1 flex items-center gap-2 pl-6 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="flex-shrink-0">{note ?? (task ? taskStatusLabel(task, t, locale) : t.status.queued)}</span>
        {task?.status === "running" && (
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
            <div className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {error && (
        <p className="mt-1 truncate pl-6 text-[11px] text-red-500 dark:text-red-300" title={error}>
          {error}
        </p>
      )}
    </li>
  );
}
