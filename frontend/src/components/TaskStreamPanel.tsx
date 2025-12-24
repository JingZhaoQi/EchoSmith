// Realtime task progress stream.
import { useMutation } from "@tanstack/react-query";
import { PauseIcon, PlayIcon, Trash2Icon, StopCircleIcon, XCircleIcon } from "lucide-react";

import { Progress } from "./ui/progress";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useTasksStore } from "../hooks/useTasksStore";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";
import { STATUS_LABELS, getSourceLabel } from "../lib/constants";

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
  const isTerminal = currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled";
  const progressPercent = Math.min(100, Math.max(0, Math.round((activeTask?.progress ?? 0) * 100)));

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
        throw new Error("没有任务可清空");
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

      // 清空后，取消选中任务
      setActiveTask(null);
    },
    onError: () => {
      window.alert("清空任务失败，请稍后再试");
    }
  });

  const stopAllMutation = useMutation({
    mutationFn: async () => {
      const allTaskIds = Object.keys(tasks);
      if (allTaskIds.length === 0) {
        throw new Error("没有任务可停止");
      }

      // 尝试取消所有任务
      for (const taskId of allTaskIds) {
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

      // 一次性清空所有任务
      clearAllTasks();

      // 等待后端处理完成后，重置标志以允许后续更新
      setTimeout(() => {
        resetUserClearedFlag();
      }, 5000); // 5秒后重置标志
    },
    onError: () => {
      window.alert("停止所有任务失败，请稍后再试");
      resetUserClearedFlag(); // 出错时也重置标志
    }
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      // 触发全局清空事件
      window.dispatchEvent(new CustomEvent("clearAllFiles"));

      // 也清空任务列表
      clearAllTasks();

      // 重置标志
      setTimeout(() => {
        resetUserClearedFlag();
      }, 1000);
    },
    onError: () => {
      window.alert("清空失败，请稍后再试");
      resetUserClearedFlag();
    }
  });

  return (
    <div>
      <Card className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">任务状态</h2>
            <p className="text-xs text-muted-foreground">
              {activeTask ? `当前：${STATUS_LABELS[currentStatus ?? ""] ?? currentStatus ?? "未知"}` : "暂无任务"}
            </p>
          </div>
          <select
            className="text-xs rounded-lg border border-border bg-background px-2 py-1"
            value={activeTaskId ?? ""}
            onChange={(event) => setActiveTask(event.target.value || null)}
          >
            <option value="">选择任务</option>
            {Object.values(tasks)
              .sort((a, b) => b.created_at - a.created_at)
              .map((task) => (
                <option key={task.id} value={task.id}>
                  {getSourceLabel(task.source) || task.id.slice(0, 8)} · {STATUS_LABELS[task.status] ?? task.status}
                </option>
              ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Progress value={progressPercent} />
          </div>
          <span className="w-12 text-xs text-muted-foreground text-right">{progressPercent}%</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={!activeTaskId || isPaused || isTerminal || pauseMutation.isPending}
            onClick={() => pauseMutation.mutate()}
          >
            <PauseIcon className="h-4 w-4" /> 暂停
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={!activeTaskId || !isPaused || isTerminal || resumeMutation.isPending}
            onClick={() => resumeMutation.mutate()}
          >
            <PlayIcon className="h-4 w-4" /> 继续
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={!activeTaskId || cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            <XCircleIcon className="h-4 w-4" /> 停止并跳过当前任务
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={Object.keys(tasks).length === 0 || stopAllMutation.isPending}
            onClick={() => stopAllMutation.mutate()}
          >
            <StopCircleIcon className="h-4 w-4" /> 停止所有任务
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="gap-1"
            disabled={clearAllMutation.isPending}
            onClick={() => clearAllMutation.mutate()}
          >
            <Trash2Icon className="h-4 w-4" /> 清空所有任务
          </Button>
        </div>
      </Card>
    </div>
  );
}
