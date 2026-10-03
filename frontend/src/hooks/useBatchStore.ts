// Batch queue for local files: lives outside components so switching views never loses progress.
import { create } from "zustand";

import { cancelTask, createTaskFromFile, createTaskFromPath, deleteTask, errorMessage, type TaskSnapshot } from "../lib/api";
import { useTasksStore, waitForTerminal } from "./useTasksStore";

export const MEDIA_EXTENSIONS = [
  "mp3", "wav", "m4a", "flac", "ogg", "aac", "wma", "aiff", "caf",
  "mp4", "mov", "avi", "mkv", "webm", "m4v",
];

export type BatchItemStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

export interface BatchItem {
  id: string;
  name: string;
  path?: string; // desktop: full path; results are auto-saved next to it (useAutoSave)
  file?: File; // browser fallback: uploaded
  status: BatchItemStatus;
  taskId?: string;
  error?: string;
}

export interface NewBatchFile {
  name: string;
  path?: string;
  file?: File;
}

interface BatchState {
  items: BatchItem[];
  running: boolean;
  /** Adds supported media files; returns how many were accepted. */
  addFiles(files: NewBatchFile[]): number;
  removeItem(id: string): void;
  start(): void;
  stop(): void;
  /** Stop, drop every file, delete their tasks and empty the output area. */
  clear(): Promise<void>;
}

let nextId = 0;
const isMedia = (name: string) => MEDIA_EXTENSIONS.includes(name.split(".").pop()?.toLowerCase() ?? "");

export const useBatchStore = create<BatchState>((set, get) => ({
  items: [],
  running: false,
  addFiles: (files) => {
    const known = new Set(get().items.map((item) => item.path).filter(Boolean));
    const fresh = files
      .filter((f) => isMedia(f.name) && !(f.path && known.has(f.path)))
      .map((f): BatchItem => ({ ...f, id: `b${++nextId}`, status: "pending" }));
    if (fresh.length) set((state) => ({ items: [...state.items, ...fresh] }));
    return fresh.length;
  },
  removeItem: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (item?.status === "processing" && item.taskId) void cancelTask(item.taskId).catch(() => undefined);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },
  start: () => {
    if (get().running || !get().items.some((i) => i.status === "pending")) return;
    useTasksStore.getState().setFollowBatch(true);
    set({ running: true });
    void runQueue();
  },
  stop: () => {
    set({ running: false });
    for (const item of get().items) {
      if (item.status === "processing" && item.taskId) void cancelTask(item.taskId).catch(() => undefined);
    }
  },
  clear: async () => {
    get().stop();
    const taskIds = get().items.flatMap((item) => (item.taskId ? [item.taskId] : []));
    set({ items: [] });
    const tasks = useTasksStore.getState();
    tasks.setActiveTask(null);
    await Promise.all(
      taskIds.map((id) =>
        deleteTask(id)
          .catch(() => undefined) // already gone
          .then(() => tasks.removeTask(id))
      )
    );
  },
}));

function patch(id: string, changes: Partial<BatchItem>): void {
  useBatchStore.setState((state) => ({ items: state.items.map((i) => (i.id === id ? { ...i, ...changes } : i)) }));
}

const exists = (id: string) => useBatchStore.getState().items.some((i) => i.id === id);

async function runQueue(): Promise<void> {
  for (;;) {
    const { running, items } = useBatchStore.getState();
    const item = items.find((i) => i.status === "pending");
    if (!running || !item) break;
    patch(item.id, { status: "processing" });
    try {
      const taskId = item.path ? await createTaskFromPath(item.path) : await createTaskFromFile(item.file as File);
      patch(item.id, { taskId });
      const now = Date.now() / 1000;
      const tasks = useTasksStore.getState();
      tasks.upsertTask(placeholderTask(taskId, item, now));
      // Follow the batch until the user picks a row to look at.
      if (tasks.followBatch) tasks.setActiveTask(taskId);
      if (!useBatchStore.getState().running || !exists(item.id)) void cancelTask(taskId).catch(() => undefined);

      const final = await waitForTerminal(taskId);
      if (!exists(item.id)) continue;
      if (!final || final.status === "cancelled") {
        patch(item.id, { status: "cancelled" });
        continue;
      }
      if (final.status === "failed") {
        patch(item.id, { status: "failed", error: final.error ?? undefined });
        continue;
      }
      patch(item.id, { status: "completed" });
    } catch (error) {
      patch(item.id, { status: "failed", error: errorMessage(error) });
    }
  }
  useBatchStore.setState({ running: false });
}

function placeholderTask(id: string, item: BatchItem, now: number): TaskSnapshot {
  return {
    id,
    status: "queued",
    progress: 0,
    message: "",
    phase: "queued",
    asr_progress: 0,
    correction_enabled: false,
    correction_progress: 0,
    correction_failed_batches: 0,
    source: { type: item.path ? "local" : "upload", name: item.name },
    created_at: now,
    updated_at: now,
  };
}
