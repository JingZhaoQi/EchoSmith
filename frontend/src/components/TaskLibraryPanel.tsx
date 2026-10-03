// Sidebar: new-task entry, task list with per-task pause/resume/remove, stop all and clear.
import { useMemo, useState } from "react";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  FileAudioIcon,
  GlobeIcon,
  Loader2Icon,
  PauseCircleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  StopCircleIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import { isActive, useTasksStore } from "../hooks/useTasksStore";
import { useBatchStore } from "../hooks/useBatchStore";
import { cancelTask, deleteTask, errorMessage, pauseTask, resumeTask } from "../lib/api";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { getSourceLabel } from "../lib/constants";
import { useLocaleStore, useT, type Messages } from "../lib/i18n";
import { taskStatusLabel } from "../lib/taskStatus";

function formatRelativeTime(timestamp: number, t: Messages): string {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return t.justNow;
  if (seconds < 3600) return t.minutesAgo(Math.floor(seconds / 60));
  if (seconds < 86400) return t.hoursAgo(Math.floor(seconds / 3600));
  const date = new Date(timestamp * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function StatusIcon({ status }: { status: TaskStatus }): JSX.Element {
  switch (status) {
    case "running":
      return <Loader2Icon className="h-4 w-4 animate-spin text-sky-600 dark:text-sky-300" />;
    case "paused":
      return <PauseCircleIcon className="h-4 w-4 text-amber-500 dark:text-amber-300" />;
    case "completed":
      return <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />;
    case "failed":
    case "cancelled":
      return <XCircleIcon className="h-4 w-4 text-red-500 dark:text-red-300" />;
    default:
      return <CircleDashedIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />;
  }
}

function TaskRow({
  task,
  active,
  onSelect,
  onPauseResume,
  onRemove,
}: {
  task: TaskSnapshot;
  active: boolean;
  onSelect: () => void;
  onPauseResume: () => void;
  onRemove: () => void;
}): JSX.Element {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const isUrl = task.source.type === "url";
  const name = getSourceLabel(task.source, 40) || task.id.slice(0, 8);
  const isPaused = task.status === "paused";
  const showPauseResume = task.status === "running" || isPaused;
  const progressPct = Math.round((task.progress ?? 0) * 100);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full cursor-pointer rounded-2xl border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-sky-500/40 bg-sky-500/10 dark:border-sky-400/30 dark:bg-sky-400/10"
          : "border-transparent hover:bg-white/50 dark:hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-white" title={name}>
          {isUrl && <GlobeIcon className="mr-1 inline h-3 w-3 opacity-60" />}
          {name}
        </span>
        <span className="flex flex-shrink-0 items-center gap-0.5">
          {showPauseResume && (
            <Button
              variant="ghost"
              size="icon"
              title={isPaused ? t.resume : t.pause}
              aria-label={isPaused ? t.resume : t.pause}
              className="h-7 w-7 rounded-lg"
              onClick={(event) => {
                event.stopPropagation();
                onPauseResume();
              }}
            >
              {isPaused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            title={t.remove}
            aria-label={t.remove}
            className="h-7 w-7 rounded-lg"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-6">
        <span className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
          {taskStatusLabel(task, t, locale)}
        </span>
        {task.status === "running" && (
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
            <div className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400" style={{ width: `${progressPct}%` }} />
          </div>
        )}
        {task.status === "failed" && task.error && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-red-500 dark:text-red-300" title={task.error}>
            {task.error}
          </span>
        )}
        {task.status !== "running" && (
          <span className="ml-auto flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
            {formatRelativeTime(task.updated_at, t)}
          </span>
        )}
      </div>
    </div>
  );
}

export function TaskLibraryPanel(): JSX.Element {
  const t = useT();
  const tasks = useTasksStore((state) => state.tasks);
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);
  const removeTask = useTasksStore((state) => state.removeTask);
  const upsertTask = useTasksStore((state) => state.upsertTask);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedTasks = useMemo(() => Object.values(tasks).sort((a, b) => b.created_at - a.created_at), [tasks]);
  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;
    for (const task of sortedTasks) {
      if (isActive(task)) active += 1;
      else if (task.status === "completed") completed += 1;
      else failed += 1;
    }
    return { active, completed, failed };
  }, [sortedTasks]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handlePauseResume = (task: TaskSnapshot) =>
    run(async () => {
      if (task.status === "paused") await resumeTask(task.id);
      else await pauseTask(task.id);
      upsertTask({ ...task, status: task.status === "paused" ? "running" : "paused" });
    });

  const handleRemove = (task: TaskSnapshot) =>
    run(async () => {
      await deleteTask(task.id).catch((e: unknown) => {
        if (!(e && typeof e === "object" && "response" in e && (e as { response?: { status?: number } }).response?.status === 404)) throw e;
      });
      removeTask(task.id);
    });

  const handleStopAll = async () => {
    setBusy(true);
    useBatchStore.getState().stop();
    const active = sortedTasks.filter(isActive);
    await run(() => Promise.all(active.map((task) => cancelTask(task.id).catch(() => undefined))));
    setBusy(false);
  };

  const handleClearAll = async () => {
    setBusy(true);
    useBatchStore.getState().clear();
    await run(() =>
      Promise.all(
        sortedTasks.map((task) =>
          deleteTask(task.id)
            .then(() => removeTask(task.id))
            .catch(() => undefined)
        )
      )
    );
    setBusy(false);
  };

  return (
    <aside className="liquid-panel flex h-full min-h-0 flex-col gap-3 p-4">
      <Button className="w-full gap-2" onClick={() => setActiveTask(null)} aria-pressed={activeTaskId === null}>
        <PlusIcon className="h-4 w-4" />
        {t.newTask}
      </Button>
      <div>
        <h2 className="text-sm font-semibold text-slate-950 dark:text-white">{t.taskLibrary}</h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{t.countActive(counts.active)}</span>
          <span className="opacity-40">·</span>
          <span>{t.countCompleted(counts.completed)}</span>
          <span className="opacity-40">·</span>
          <span>{t.countFailed(counts.failed)}</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" className="gap-1.5 whitespace-nowrap px-2" disabled={counts.active === 0 || busy} onClick={handleStopAll}>
            <StopCircleIcon className="h-4 w-4" />
            {t.stopAll}
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5 whitespace-nowrap px-2" disabled={sortedTasks.length === 0 || busy} onClick={handleClearAll}>
            <Trash2Icon className="h-4 w-4" />
            {t.clearAll}
          </Button>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-500 dark:text-red-300">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {sortedTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
            <FileAudioIcon className="h-8 w-8 opacity-30" />
            <p className="px-4 text-center text-xs leading-5">
              {t.noTasks}
              <br />
              {t.noTasksHint}
            </p>
          </div>
        ) : (
          sortedTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              active={task.id === activeTaskId}
              onSelect={() => setActiveTask(task.id)}
              onPauseResume={() => void handlePauseResume(task)}
              onRemove={() => void handleRemove(task)}
            />
          ))
        )}
      </div>
    </aside>
  );
}
