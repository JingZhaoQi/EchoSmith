// Batch task creation form for EchoSmith with auto-export
import { FormEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { UploadIcon, PlayIcon, FileAudioIcon, XIcon, CheckIcon } from "lucide-react";

import { Button } from "./ui/button";
import { createTaskFromFile, createTaskFromPath, autoExportTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { useT } from "../lib/i18n";

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
  const t = useT();

  const upsertTask = useTasksStore((state) => state.upsertTask);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);
  const resetUserClearedFlag = useTasksStore((state) => state.resetUserClearedFlag);

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
      alert(t.unsupportedFormat);
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
        throw new Error(t.selectFilesFirst);
      }
      if (exportFormats.size === 0) {
        throw new Error(t.selectFormatFirst);
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
                    error: error instanceof Error ? error.message : t.unknownError,
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
    resetUserClearedFlag();
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
      className="liquid-panel flex h-full min-h-[360px] flex-col gap-5 overflow-y-auto p-5"
      onSubmit={handleSubmit}
    >
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t.batchTitle}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {t.batchSubtitle}
        </p>
      </div>

      {/* Export format selection */}
      <div>
        <label className="mb-2 block text-sm font-medium text-slate-900 dark:text-white">
          {t.exportFormat}
        </label>
        <div className="flex gap-2">
          {(["txt", "srt", "json"] as ExportFormat[]).map((format) => (
            <button
              key={format}
              type="button"
              onClick={() => toggleFormat(format)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                exportFormats.has(format)
                  ? "bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950"
                  : "glass-field text-slate-700 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/[0.10]"
              }`}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* File upload area */}
      <div className="space-y-3">
        <div
          className={`flex flex-col items-center justify-center rounded-[16px] border-2 border-dashed transition-all duration-200 px-5 py-8 text-center cursor-pointer group ${
            isDragging
              ? "border-sky-400 bg-sky-50/60 dark:bg-sky-400/10"
              : "border-slate-300/80 bg-white/35 hover:border-slate-400/70 hover:bg-white/55 dark:border-white/[0.12] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
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
              ? "bg-sky-500/20 dark:bg-sky-400/20"
              : "bg-sky-500/10 dark:bg-sky-400/10 group-hover:bg-sky-500/15 dark:group-hover:bg-sky-400/15"
          }`}>
            <UploadIcon
              className="h-8 w-8 text-sky-700 dark:text-sky-300"
              strokeWidth={2.5}
            />
          </div>
          <p className="mb-1 text-sm font-semibold text-slate-950 dark:text-white">
            {isDragging ? t.dropToAdd : t.clickOrDrag}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t.supportedFormats}
          </p>
        </div>

        {/* File list */}
        {batchFiles.length > 0 && (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {batchFiles.map((batchFile, index) => (
              <div
                key={index}
                className="glass-field flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {batchFile.status === "completed" ? (
                    <CheckIcon className="h-4 w-4 text-green-500 flex-shrink-0" />
                  ) : batchFile.status === "failed" ? (
                    <XIcon className="h-4 w-4 text-red-500 flex-shrink-0" />
                  ) : batchFile.status === "processing" ? (
                    <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
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
                    className="rounded-lg p-1 transition-colors hover:bg-black/[0.08] dark:hover:bg-white/[0.12]"
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
      <div className="flex items-center gap-3 mt-4">
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
            <><CheckIcon className="h-4 w-4" /> {t.allDone}</>
          ) : (
            <><PlayIcon className="h-4 w-4" />
            {mutation.isPending
              ? t.processing(batchFiles.filter((f) => f.status === "completed").length, batchFiles.length)
              : wasInterrupted
              ? t.resumeBatch(batchFiles.filter((f) => f.status === "pending").length)
              : t.startBatch(batchFiles.length)}</>
          )}
        </Button>
      </div>

      {mutation.isError && (
        <p className="text-xs text-red-600 dark:text-red-400">
          {(mutation.error as Error).message || t.batchFailed}
        </p>
      )}

    </form>
  );
}
