// Realtime task progress stream.
import { useMutation } from "@tanstack/react-query";
import { PauseIcon, PlayIcon, Trash2Icon, StopCircleIcon, SkipForwardIcon } from "lucide-react";

import { Button } from "./ui/button";
import { useTasksStore } from "../hooks/useTasksStore";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";
import { STATUS_LABELS, getSourceLabel } from "../lib/constants";
import { getClearableTaskIds, getStoppableTaskIds, isTerminalTask } from "./taskControls";

export function TaskStreamPanel(): JSX.Element {
  const { tasks, activeTaskId, setActiveTask, removeTask, clearAllTasks, resetUserClearedFlag } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
    setActiveTask: state.setActiveTask,
    removeTask: state.removeTask,
    clearAllTasks: state.clearAllTasks,
    resetUserClearedFlag: state.resetUserClearedFlag
  }));

  const activeTask = activeTaskId ? tasks[activeTaskId] : undefined;

  // 直接从后端状态派生，不需要本地 state
  const currentStatus = activeTask?.status;
  const isPaused = currentStatus === "paused";
  const isTerminal = isTerminalTask(activeTask);
  const stoppableTaskIds = getStoppableTaskIds(tasks);
  const clearableTaskIds = getClearableTaskIds(tasks);
  const hasTasks = Object.keys(tasks).length > 0;

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error("没有任务可暂停");
      await pauseTask(activeTaskId);
    }
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error("没有任务可恢复");
      await resumeTask(activeTaskId);
    }
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) {
        throw new Error("没有任务可跳过");
      }
      const taskToRemove = activeTaskId;

      try {
        await cancelTask(taskToRemove);
      } catch (error: unknown) {
        // 如果是 404，说明任务已被删除，直接从本地移除即可
        const status =
          typeof error === "object" && error !== null && "response" in error
            ? (error as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 404) {
          console.warn("任务已不存在，直接从本地移除");
        } else {
          throw error;
        }
      }

      removeTask(taskToRemove);

      // 跳过后，取消选中任务
      setActiveTask(null);
    },
    onError: () => {
      window.alert("跳过任务失败，请稍后再试");
    }
  });

  const stopAllMutation = useMutation({
    mutationFn: async () => {
      if (stoppableTaskIds.length === 0) {
        throw new Error("没有任务可停止");
      }

      for (const taskId of stoppableTaskIds) {
        try {
          await cancelTask(taskId);
        } catch (error: unknown) {
          // 忽略 404 错误（任务已被删除）
          const status =
            typeof error === "object" && error !== null && "response" in error
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
          if (status !== 404) {
            console.error(`Failed to cancel task ${taskId}:`, error);
          }
        }
      }
    },
    onError: () => {
      window.alert("停止所有任务失败，请稍后再试");
    }
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const taskIds = clearableTaskIds;
      window.dispatchEvent(new CustomEvent("clearAllFiles"));
      clearAllTasks();

      for (const taskId of taskIds) {
        try {
          await cancelTask(taskId);
        } catch (error: unknown) {
          const status =
            typeof error === "object" && error !== null && "response" in error
              ? (error as { response?: { status?: number } }).response?.status
              : undefined;
          if (status !== 404) {
            console.error(`Failed to cancel task ${taskId}:`, error);
          }
        }
      }
    },
    onError: () => {
      window.alert("清空失败，请稍后再试");
      resetUserClearedFlag();
    }
  });

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-900/10 pt-3 dark:border-white/[0.08]">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          data-tip="暂停"
          title="暂停"
          aria-label="暂停"
          className="h-9 w-9 rounded-2xl"
          disabled={!activeTaskId || isPaused || isTerminal || pauseMutation.isPending}
          onClick={() => pauseMutation.mutate()}
        >
          <PauseIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-tip="继续"
          title="继续"
          aria-label="继续"
          className="h-9 w-9 rounded-2xl"
          disabled={!activeTaskId || !isPaused || isTerminal || resumeMutation.isPending}
          onClick={() => resumeMutation.mutate()}
        >
          <PlayIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-tip="跳过"
          title="跳过"
          aria-label="跳过"
          className="h-9 w-9 rounded-2xl"
          disabled={!activeTaskId || isTerminal || cancelMutation.isPending}
          onClick={() => cancelMutation.mutate()}
        >
          <SkipForwardIcon className="h-4 w-4" />
        </Button>
        <div className="mx-1 h-4 border-r border-border" />
        <Button
          variant="ghost"
          size="icon"
          data-tip="全部停止"
          title="全部停止"
          aria-label="全部停止"
          className="h-9 w-9 rounded-2xl"
          disabled={stoppableTaskIds.length === 0 || stopAllMutation.isPending}
          onClick={() => stopAllMutation.mutate()}
        >
          <StopCircleIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-tip="清空"
          title="清空"
          aria-label="清空"
          className="h-9 w-9 rounded-2xl"
          disabled={!hasTasks || clearAllMutation.isPending}
          onClick={() => clearAllMutation.mutate()}
        >
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
      <span className="status-pill max-w-[220px] truncate">
        {activeTask ? `${getSourceLabel(activeTask.source, 24) || activeTask.id.slice(0, 8)} · ${STATUS_LABELS[activeTask.status] ?? activeTask.status}` : "未选择任务"}
      </span>
    </div>
  );
}
