// Task creation form for EchoSmith.
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UploadIcon, PlayIcon, FileAudioIcon } from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromFile } from "../lib/api";
import { STATUS_LABELS } from "../lib/constants";
import { useTasksStore } from "../hooks/useTasksStore";

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
      className="rounded-[20px] border border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out p-6 flex flex-col gap-5 min-h-[420px]"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold">新建任务</h2>
        <p className="text-xs text-muted-foreground mt-1">选择音视频文件进行转写</p>
      </div>
      <div className="space-y-4 flex-1">
        <div
          className="flex flex-col items-center justify-center rounded-[16px] border-2 border-dashed border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:border-black/20 dark:hover:border-white/20 transition-all duration-200 px-5 py-10 text-center cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="mb-4 p-3 rounded-full bg-indigo-500/10 dark:bg-indigo-400/10 group-hover:bg-indigo-500/15 dark:group-hover:bg-indigo-400/15 transition-colors">
            <UploadIcon className="h-7 w-7 text-indigo-600 dark:text-indigo-400" strokeWidth={2.5} />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">点击或拖拽音视频文件</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">支持 MP3 / WAV / M4A / MP4 / MOV 等常见格式</p>
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
