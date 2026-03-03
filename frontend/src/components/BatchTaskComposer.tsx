// Batch task creation form for EchoSmith with auto-export
import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UploadIcon, PlayIcon, FileAudioIcon, XIcon, CheckIcon } from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromFile, createTaskFromPath, autoExportTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

type ExportFormat = "txt" | "srt" | "json";

interface BatchFile {
  file: File;
  path?: string; // Full file path from Tauri
  status: "pending" | "processing" | "completed" | "failed";
  taskId?: string;
  error?: string;
}

// Allowed audio/video extensions
const ALLOWED_EXTENSIONS = new Set([
  "mp3", "wav", "m4a", "flac", "ogg", "aac", "wma", "aiff", "caf",
  "mp4", "mov", "avi", "mkv", "webm", "m4v"
]);

export function BatchTaskComposer(): JSX.Element {
  const [batchFiles, setBatchFiles] = useState<BatchFile[]>([]);
  const [exportFormats, setExportFormats] = useState<Set<ExportFormat>>(
    new Set(["txt"])
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const [wasInterrupted, setWasInterrupted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const upsertTask = useTasksStore((state) => state.upsertTask);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    const validFiles: BatchFile[] = [];

    for (const file of droppedFiles) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && ALLOWED_EXTENSIONS.has(ext)) {
        validFiles.push({
          file,
          path: undefined, // Drag-drop doesn't provide full path in browser
          status: "pending",
        });
      }
    }

    if (validFiles.length > 0) {
      setBatchFiles((prev) => [...prev, ...validFiles]);
    } else if (droppedFiles.length > 0) {
      alert("不支持的文件格式，请选择音视频文件");
    }
  };

  // Listen for clear all files event
  useEffect(() => {
    const handleClearAll = () => {
      setBatchFiles([]);
      setExportFormats(new Set(["txt"]));
      setWasInterrupted(false);
    };

    window.addEventListener("clearAllFiles", handleClearAll);
    return () => window.removeEventListener("clearAllFiles", handleClearAll);
  }, []);

  // Tauri native drag-and-drop (provides full file paths)
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");

        unlisten = await getCurrentWindow().onDragDropEvent((event) => {
          if (event.payload.type === "enter") {
            setIsDragging(true);
          } else if (event.payload.type === "drop") {
            setIsDragging(false);
            const paths = event.payload.paths;
            const newFiles: BatchFile[] = [];

            for (const filePath of paths) {
              const fileName = filePath.split(/[\\/]/).pop() || filePath;
              // Don't read file content — backend reads directly from path
              const file = new File([], fileName);
              newFiles.push({ file, path: filePath, status: "pending" });
            }

            if (newFiles.length > 0) {
              setBatchFiles((prev) => [...prev, ...newFiles]);
            }
          }
        });
      } catch (error) {
        console.warn("Drag-drop setup failed (not in Tauri?):", error);
      }
    };

    setup();
    return () => { unlisten?.(); };
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      if (batchFiles.length === 0) {
        throw new Error("请先选择文件");
      }
      if (exportFormats.size === 0) {
        throw new Error("请至少选择一种导出格式");
      }

      // Create abort controller for this batch
      abortControllerRef.current = new AbortController();

      // Process files sequentially, skip completed ones
      for (let i = 0; i < batchFiles.length; i++) {
        // Skip already completed or failed files
        if (batchFiles[i].status === "completed" || batchFiles[i].status === "failed") {
          continue;
        }

        // Check if user cleared all tasks
        if (useTasksStore.getState().userClearedAll) {
          console.log("Batch processing interrupted by user, can resume later");
          setWasInterrupted(true);
          return; // Exit gracefully without throwing error
        }

        const batchFile = batchFiles[i];

        try {
          // Update status to processing
          setBatchFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "processing" as const } : f
            )
          );

          // Create task — use direct path when available (avoids file corruption)
          const taskId = batchFile.path
            ? await createTaskFromPath(batchFile.path)
            : await createTaskFromFile(batchFile.file);

          // Check again after async operation
          if (useTasksStore.getState().userClearedAll) {
            console.log("Batch processing interrupted by user after task creation");
            setWasInterrupted(true);
            return;
          }

          // Update task ID
          setBatchFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, taskId } : f
            )
          );

          // Add to store
          upsertTask({
            id: taskId,
            status: "queued",
            progress: 0,
            message: "排队中",
            result_text: "",
            segments: [],
            source: { type: batchFile.path ? "local" : "upload", name: batchFile.file.name },
            error: null,
            logs: [],
            created_at: Date.now() / 1000,
            updated_at: Date.now() / 1000,
          });

          setActiveTask(taskId);

          // Wait for task to complete
          await waitForTaskCompletion(taskId);

          // Mark as completed immediately after transcription finishes
          setBatchFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "completed" as const } : f
            )
          );

          // Check again after task completion
          if (useTasksStore.getState().userClearedAll) {
            console.log("Batch processing interrupted by user after task completion");
            setWasInterrupted(true);
            return;
          }

          // Auto-export if we have a file path (don't block status update)
          if (batchFile.path && exportFormats.size > 0) {
            console.log(`[BatchExport] Starting auto-export for ${batchFile.file.name}`);
            console.log(`[BatchExport] Formats:`, Array.from(exportFormats));
            console.log(`[BatchExport] Source path:`, batchFile.path);
            try {
              await autoExportTask(
                taskId,
                Array.from(exportFormats),
                batchFile.path
              );
              console.log(`[BatchExport] Auto-export completed for ${batchFile.file.name}`);
            } catch (exportError) {
              console.error(`[BatchExport] Auto-export failed for ${batchFile.file.name}:`, exportError);
              // Don't fail the task, just log the export error
            }
          } else {
            console.warn(`[BatchExport] Skipped auto-export for ${batchFile.file.name}:`, {
              hasPath: !!batchFile.path,
              hasFormats: exportFormats.size > 0,
              path: batchFile.path
            });
          }
        } catch (error) {
          console.error(`Failed to process ${batchFile.file.name}:`, error);
          setBatchFiles((prev) =>
            prev.map((f, idx) =>
              idx === i
                ? {
                    ...f,
                    status: "failed" as const,
                    error: error instanceof Error ? error.message : "未知错误",
                  }
                : f
            )
          );
        }
      }

      // Check if all files are completed
      const allCompleted = batchFiles.every(
        (f) => f.status === "completed" || f.status === "failed"
      );
      if (allCompleted) {
        setWasInterrupted(false);
      }

      // Clean up
      abortControllerRef.current = null;
    },
  });

  // Helper to wait for task completion
  const waitForTaskCompletion = (taskId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        // Check if user cleared all tasks
        if (useTasksStore.getState().userClearedAll) {
          clearInterval(checkInterval);
          // Resolve instead of reject to allow graceful interruption
          resolve();
          return;
        }

        const task = useTasksStore.getState().tasks[taskId];
        if (!task) {
          clearInterval(checkInterval);
          reject(new Error("Task not found"));
          return;
        }

        if (task.status === "completed") {
          clearInterval(checkInterval);
          resolve();
        } else if (task.status === "failed" || task.status === "cancelled") {
          clearInterval(checkInterval);
          reject(new Error(task.error || "Task failed"));
        }
      }, 500);

      // Timeout after 30 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Task timeout"));
      }, 30 * 60 * 1000);
    });
  };

  // Use Tauri dialog with explicit extensions (bypasses WebKit MIME bug #242110)
  const handleFileSelect = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Audio/Video",
            extensions: [
              "mp3", "MP3", "wav", "WAV", "m4a", "M4A",
              "flac", "FLAC", "ogg", "OGG", "aac", "AAC",
              "wma", "WMA", "aiff", "AIFF", "caf", "CAF",
              "mp4", "MP4", "mov", "MOV", "avi", "AVI",
              "mkv", "MKV", "webm", "WEBM", "m4v", "M4V"
            ],
          },
        ],
      });

      if (!selected || selected.length === 0) return;

      const newFiles: BatchFile[] = selected.map((filePath) => {
        const fileName = filePath.split(/[\\/]/).pop() || filePath;
        return { file: new File([], fileName), path: filePath, status: "pending" as const };
      });
      setBatchFiles((prev) => [...prev, ...newFiles]);
    } catch (error) {
      console.error("File dialog failed:", error);
    }
  };

  const handleRemoveFile = (index: number) => {
    setBatchFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const toggleFormat = (format: ExportFormat) => {
    setExportFormats((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(format)) {
        newSet.delete(format);
      } else {
        newSet.add(format);
      }
      return newSet;
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (batchFiles.length === 0) return;
    if (exportFormats.size === 0) return;
    mutation.mutate();
  };

  const allDone =
    batchFiles.length > 0 &&
    !mutation.isPending &&
    batchFiles.every((f) => f.status === "completed" || f.status === "failed");

  const canStart =
    batchFiles.length > 0 &&
    exportFormats.size > 0 &&
    !mutation.isPending &&
    !allDone;

  return (
    <form
      className="rounded-[20px] border border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.4)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_rgba(0,0,0,0.5)] transition-all duration-300 ease-out p-6 flex flex-col gap-5 min-h-[420px]"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold">批量转写</h2>
        <p className="text-xs text-muted-foreground mt-1">
          选择多个音视频文件，自动转写并保存到源文件目录
        </p>
      </div>

      {/* Export format selection */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-white mb-2 block">
          导出格式
        </label>
        <div className="flex gap-2">
          {(["txt", "srt", "json"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => toggleFormat(format)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                exportFormats.has(format)
                  ? "bg-indigo-500 text-white shadow-sm"
                  : "bg-black/[0.04] dark:bg-white/[0.06] text-gray-700 dark:text-gray-300 hover:bg-black/[0.08] dark:hover:bg-white/[0.12]"
              }`}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* File upload area */}
      <div className="space-y-3 flex-1">
        <div
          className={`flex flex-col items-center justify-center rounded-[16px] border-2 border-dashed transition-all duration-200 px-5 py-8 text-center cursor-pointer group ${
            isDragging
              ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-400/10"
              : "border-black/15 dark:border-white/15 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] hover:border-black/25 dark:hover:border-white/25"
          }`}
          onClick={handleFileSelect}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              handleFileSelect();
            }
          }}
        >
          <div className={`mb-4 p-3 rounded-full transition-colors ${
            isDragging
              ? "bg-indigo-500/20 dark:bg-indigo-400/20"
              : "bg-indigo-500/10 dark:bg-indigo-400/10 group-hover:bg-indigo-500/15 dark:group-hover:bg-indigo-400/15"
          }`}>
            <UploadIcon
              className="h-8 w-8 text-indigo-600 dark:text-indigo-400"
              strokeWidth={2.5}
            />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
            {isDragging ? "松开以添加文件" : "点击选择或拖拽文件到此处"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            支持 MP3 / WAV / M4A / MP4 / MOV 等常见格式
          </p>
        </div>

        {/* File list */}
        {batchFiles.length > 0 && (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {batchFiles.map((batchFile, index) => (
              <div
                key={index}
                className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/60 dark:bg-zinc-800/60 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {batchFile.status === "completed" ? (
                    <CheckIcon className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : batchFile.status === "failed" ? (
                    <XIcon className="h-4 w-4 text-red-500 flex-shrink-0" />
                  ) : batchFile.status === "processing" ? (
                    <div className="h-4 w-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  ) : (
                    <FileAudioIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="font-medium truncate">
                    {batchFile.file.name}
                  </span>
                </div>
                {batchFile.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(index)}
                    className="p-1 rounded hover:bg-black/[0.08] dark:hover:bg-white/[0.12] transition-colors"
                  >
                    <XIcon className="h-4 w-4 text-gray-500" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start button */}
      <div className="flex items-center gap-3 pt-2">
        <Button
          type={allDone ? "button" : "submit"}
          variant="default"
          className={`gap-2 flex-1 transition-colors duration-500 ${
            allDone ? "!bg-emerald-500 hover:!bg-emerald-600 !shadow-none" : ""
          }`}
          disabled={!canStart && !allDone}
          onClick={allDone ? () => { setBatchFiles([]); setWasInterrupted(false); } : undefined}
        >
          {allDone ? (
            <><CheckIcon className="h-4 w-4" /> 全部完成</>
          ) : (
            <><PlayIcon className="h-4 w-4" />
            {mutation.isPending
              ? `处理中 (${batchFiles.filter((f) => f.status === "completed").length}/${batchFiles.length})`
              : wasInterrupted
              ? `继续转写 (剩余 ${batchFiles.filter((f) => f.status === "pending").length} 个文件)`
              : `开始转写 (${batchFiles.length} 个文件)`}</>
          )}
        </Button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(mutation.error as Error).message || "批量处理失败"}
        </p>
      )}
    </form>
  );
}
