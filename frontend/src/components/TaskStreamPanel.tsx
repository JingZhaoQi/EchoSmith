// Realtime task progress stream.
import React from "react";
import { useMutation } from "@tanstack/react-query";
import { PauseIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Progress } from "./ui/progress";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useTasksStore } from "../hooks/useTasksStore";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  paused: "暂停中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已清空"
};

function getSourceLabel(source?: Record<string, unknown>): string {
  if (!source) return "";
  const name = (source as { name?: unknown }).name;
  if (typeof name === "string" && name.length > 0) {
    return name;
  }
  const value = (source as { value?: unknown }).value;
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "";
}

export function TaskStreamPanel(): JSX.Element {
  const { tasks, activeTaskId, setActiveTask, removeTask } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
    setActiveTask: state.setActiveTask,
    removeTask: state.removeTask
  }));

  const activeTask = activeTaskId ? tasks[activeTaskId] : undefined;

  // 直接从后端状态派生，不需要本地 state
  const currentStatus = activeTask?.status;
  const isPaused = currentStatus === "paused";
  const isRunning = currentStatus === "running" || currentStatus === "queued";
  const isTerminal = currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled";
  const progressPercent = Math.min(100, Math.max(0, Math.round((activeTask?.progress ?? 0) * 100)));

  const pauseMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error("没有任务可暂停");
      console.log("⏸️  [Mutation] 调用暂停 API:", activeTaskId);
      await pauseTask(activeTaskId);
      console.log("✅ [Mutation] 暂停 API 调用成功");
    }
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error("没有任务可恢复");
      console.log("▶️  [Mutation] 调用继续 API:", activeTaskId);
      await resumeTask(activeTaskId);
      console.log("✅ [Mutation] 继续 API 调用成功");
    }
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!activeTaskId) throw new Error("没有任务可清空");
      const taskToRemove = activeTaskId;
      await cancelTask(taskToRemove);
      removeTask(taskToRemove);
    }
  });

  // 调试日志（在所有变量定义之后）
  React.useEffect(() => {
    console.log("🔍 [TaskStreamPanel] 状态调试:", {
      activeTaskId,
      currentStatus,
      isPaused,
      isRunning,
      isTerminal,
      暂停按钮禁用: !activeTaskId || isPaused || isTerminal || pauseMutation.isPending,
      继续按钮禁用: !activeTaskId || !isPaused || isTerminal || resumeMutation.isPending,
      完整任务对象: activeTask
    });
  }, [activeTaskId, currentStatus, isPaused, isRunning, isTerminal, pauseMutation.isPending, resumeMutation.isPending, activeTask]);

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
        <div className="flex gap-2">
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
            <Trash2Icon className="h-4 w-4" /> 清空
          </Button>
        </div>
      </Card>
    </div>
  );
}
