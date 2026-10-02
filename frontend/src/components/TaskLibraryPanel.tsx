// Task library: queue and history list with per-task and global controls.
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
  StopCircleIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import { useTasksStore } from "../hooks/useTasksStore";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { STATUS_LABELS, getSourceLabel } from "../lib/constants";
import { getStoppableTaskIds } from "./taskControls";

const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running", "paused"];

async function cancelIgnoring404(taskId: string): Promise<void> {
  try {
    await cancelTask(taskId);
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null && "response" in error
        ? (error as { response?: { status?: number } }).response?.status
        : undefined;
    if (status !== 404) throw error;
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
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
  const isUrl = (task.source as Record<string, unknown>).type === "url";
  const name = getSourceLabel(task.source, 40) || task.id.slice(0, 8);
  const progressPct = Math.round((task.progress ?? 0) * 100);
  const isPaused = task.status === "paused";
  const showPauseResume = task.status === "running" || isPaused;

  return (
    <div
      role="button"
      tabIndex={0}
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
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 dark:text-white">
          {isUrl && <GlobeIcon className="mr-1 inline h-3 w-3 opacity-60" />}
          {name}
        </span>
        <span className="flex flex-shrink-0 items-center gap-0.5">
          {showPauseResume && (
            <Button
              variant="ghost"
              size="icon"
              title={isPaused ? "继续" : "暂停"}
              aria-label={isPaused ? "继续" : "暂停"}
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
            title="移除"
            aria-label="移除"
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
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {STATUS_LABELS[task.status] ?? task.status}
        </span>
        {task.status === "running" && (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-900/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-sky-500 transition-all dark:bg-sky-400"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
              {progressPct}%
            </span>
          </>
        )}
        {task.status === "failed" && task.error && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-red-500 dark:text-red-300">
            {task.error}
          </span>
        )}
        {task.status !== "running" && (
          <span className="ml-auto flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
            {formatRelativeTime(task.updated_at)}
          </span>
        )}
      </div>
    </div>
  );
}

export function TaskLibraryPanel(): JSX.Element {
  const { tasks, activeTaskId, setActiveTask, removeTask, clearAllTasks, resetUserClearedFlag } =
    useTasksStore((state) => ({
      tasks: state.tasks,
      activeTaskId: state.activeTaskId,
      setActiveTask: state.setActiveTask,
      removeTask: state.removeTask,
      clearAllTasks: state.clearAllTasks,
      resetUserClearedFlag: state.resetUserClearedFlag,
    }));
  const [busy, setBusy] = useState(false);

  const sortedTasks = useMemo(
    () => Object.values(tasks).sort((a, b) => b.created_at - a.created_at),
    [tasks]
  );

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let failed = 0;
    for (const task of sortedTasks) {
      if (ACTIVE_STATUSES.includes(task.status)) active += 1;
      else if (task.status === "completed") completed += 1;
      else failed += 1;
    }
    return { active, completed, failed };
  }, [sortedTasks]);

  const stoppableTaskIds = getStoppableTaskIds(tasks);
  const hasTasks = sortedTasks.length > 0;

  const handlePauseResume = async (task: TaskSnapshot) => {
    try {
      if (task.status === "paused") await resumeTask(task.id);
      else await pauseTask(task.id);
    } catch (error) {
      console.error("Failed to pause/resume task:", error);
      window.alert("操作失败，请稍后再试");
    }
  };

  const handleRemove = async (task: TaskSnapshot) => {
    try {
      await cancelIgnoring404(task.id);
      removeTask(task.id);
    } catch (error) {
      console.error("Failed to remove task:", error);
      window.alert("移除任务失败，请稍后再试");
    }
  };

  const handleStopAll = async () => {
    setBusy(true);
    try {
      for (const taskId of stoppableTaskIds) {
        try {
          await cancelIgnoring404(taskId);
        } catch (error) {
          console.error(`Failed to cancel task ${taskId}:`, error);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    const taskIds = Object.keys(tasks);
    setBusy(true);
    window.dispatchEvent(new CustomEvent("clearAllFiles"));
    clearAllTasks();
    let failed = false;
    for (const taskId of taskIds) {
      try {
        await cancelIgnoring404(taskId);
      } catch (error) {
        failed = true;
        console.error(`Failed to cancel task ${taskId}:`, error);
      }
    }
    if (failed) {
      window.alert("部分任务清空失败，请稍后再试");
      resetUserClearedFlag();
    }
    setBusy(false);
  };

  return (
    <aside className="liquid-panel flex h-full min-h-0 flex-col gap-3 p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-950 dark:text-white">任务库</h2>
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>进行中 {counts.active}</span>
          <span className="opacity-40">·</span>
          <span>完成 {counts.completed}</span>
          <span className="opacity-40">·</span>
          <span>失败/取消 {counts.failed}</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            disabled={stoppableTaskIds.length === 0 || busy}
            onClick={handleStopAll}
          >
            <StopCircleIcon className="h-4 w-4" />
            全部停止
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5"
            disabled={!hasTasks || busy}
            onClick={handleClearAll}
          >
            <Trash2Icon className="h-4 w-4" />
            清空
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {sortedTasks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
            <FileAudioIcon className="h-8 w-8 opacity-30" />
            <p className="px-4 text-center text-xs leading-5">
              还没有任务。
              <br />
              从中间面板添加本地文件或在线视频。
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
