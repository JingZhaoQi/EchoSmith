// Task library: queue and history list with status counts and selection.
import { useMemo } from "react";
import { CheckCircle2Icon, CircleDashedIcon, FileAudioIcon, GlobeIcon, Loader2Icon, PauseCircleIcon, XCircleIcon } from "lucide-react";

import { useTasksStore } from "../hooks/useTasksStore";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { STATUS_LABELS, getSourceLabel } from "../lib/constants";

const ACTIVE_STATUSES: TaskStatus[] = ["queued", "running", "paused"];

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

function TaskRow({ task, active, onSelect }: { task: TaskSnapshot; active: boolean; onSelect: () => void }): JSX.Element {
  const isUrl = (task.source as Record<string, unknown>).type === "url";
  const name = getSourceLabel(task.source, 40) || task.id.slice(0, 8);
  const progressPct = Math.round((task.progress ?? 0) * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border px-3 py-2.5 text-left transition-colors ${
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
        <span className="flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
          {formatRelativeTime(task.updated_at)}
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
      </div>
    </button>
  );
}

export function TaskLibraryPanel(): JSX.Element {
  const { tasks, activeTaskId, setActiveTask } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
    setActiveTask: state.setActiveTask,
  }));

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
            />
          ))
        )}
      </div>
    </aside>
  );
}
