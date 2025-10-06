// Task creation form for EchoSmith.
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UploadIcon, PlayIcon, FileAudioIcon } from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromFile } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  paused: "暂停中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已清空"
};

export function TaskComposer(): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [displaySource, setDisplaySource] = useState<string>("");

  const { activeTaskId, activeTask, setActiveTask, upsertTask } = useTasksStore((state) => {
    const id = state.activeTaskId;
    return {
      activeTaskId: id,
      activeTask: id ? state.tasks[id] : null,
      setActiveTask: state.setActiveTask,
      upsertTask: state.upsertTask
    };
  });

  useEffect(() => {
    if (!activeTaskId) {
      setDisplaySource("");
      setSelectedFile(null);
      setSelectedFileName("");
      return;
    }
    if (activeTask?.source) {
      const source = activeTask.source as { name?: unknown };
      if (typeof source.name === "string" && source.name.length > 0) {
        setDisplaySource(source.name);
      }
    }
  }, [activeTaskId, activeTask]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) {
        throw new Error("请先选择文件");
      }
      return await createTaskFromFile(selectedFile);
    },
    onSuccess: (taskId) => {
      const sourceDescriptor = { type: "upload", name: selectedFile!.name };
      setDisplaySource(selectedFile!.name);

      setActiveTask(taskId);
      upsertTask({
        id: taskId,
        status: "queued",
        progress: 0,
        message: "排队中",
        result_text: "",
        segments: [],
        source: sourceDescriptor,
        error: null,
        logs: [],
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000
      });
      setSelectedFile(null);
      setSelectedFileName("");
    }
  });

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setSelectedFileName(file ? file.name : "");
    setSelectedFile(file ?? null);
    if (file) {
      setDisplaySource(file.name);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedFile) return;
    mutation.mutate();
  };

  return (
    <form
      className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-lg shadow-indigo-500/5 dark:shadow-indigo-900/20 hover:shadow-2xl hover:shadow-indigo-500/20 dark:hover:shadow-indigo-900/40 transition-shadow duration-300 p-6 flex flex-col gap-5 min-h-[420px]"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold">新建任务</h2>
        <p className="text-xs text-muted-foreground mt-1">选择音视频文件进行转写</p>
      </div>
      <div className="space-y-4 flex-1">
        <div
          className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-sky-200/70 hover:bg-sky-300/80 dark:bg-indigo-900/50 dark:hover:bg-indigo-900/60 transition-colors px-5 py-8 text-center cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              fileInputRef.current?.click();
            }
          }}
        >
          <UploadIcon className="h-7 w-7 text-indigo-500 dark:text-indigo-400 mb-2" />
          <p className="text-sm font-medium text-foreground">点击或拖拽音视频文件</p>
          <p className="text-xs text-muted-foreground/90 dark:!text-white">支持 MP3 / WAV / M4A / MP4 / MOV 等常见格式</p>
          {selectedFileName && <p className="text-sm font-medium text-foreground mt-3">已选择：{selectedFileName}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button
          type="submit"
          variant="default"
          className="gap-2 flex-1"
          disabled={mutation.isPending || !selectedFile}
        >
          <PlayIcon className="h-4 w-4" />
          {mutation.isPending ? "创建中..." : "开始转写"}
        </Button>
      </div>
      {displaySource && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/80 px-3 py-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            <FileAudioIcon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium truncate">{displaySource}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {activeTask ? STATUS_LABELS[activeTask.status] ?? activeTask.status : "待创建"}
          </span>
        </div>
      )}
      {mutation.isError && (
        <p className="text-xs text-destructive">
          {(mutation.error as Error).message || "任务创建失败"}
        </p>
      )}
    </form>
  );
}
