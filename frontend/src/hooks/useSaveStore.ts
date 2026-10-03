// Default save formats (lit buttons) and saving a task's transcript in those formats.
import { create } from "zustand";

import {
  EXPORT_FORMATS,
  errorMessage,
  exportTask,
  isTauri,
  saveExport,
  saveTaskFiles,
  type ExportFormat,
  type TaskSummary,
} from "../lib/api";
import { exportBaseName } from "../lib/constants";

const STORAGE_KEY = "echosmith-save-formats";

export interface SaveResult {
  paths: string[];
  error?: string;
}

interface SaveState {
  /** Formats saved automatically when a task completes; never empty. */
  formats: ExportFormat[];
  results: Record<string, SaveResult>;
  toggleFormat(format: ExportFormat): void;
  /** Save the task in the lit formats: next to a local source file, else to Downloads. */
  saveTask(task: TaskSummary): Promise<void>;
}

function readFormats(): ExportFormat[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
    if (Array.isArray(stored)) {
      const valid = EXPORT_FORMATS.filter((f) => stored.includes(f));
      if (valid.length) return valid;
    }
  } catch {
    // unreadable storage: fall back to the default
  }
  return ["txt"];
}

async function targetDir(task: TaskSummary): Promise<string | null> {
  const { dirname, downloadDir } = await import("@tauri-apps/api/path");
  const path = task.source.path;
  if (task.source.type === "local" && typeof path === "string" && path) return dirname(path);
  if (task.source.type === "url") return downloadDir();
  return null; // uploaded file: no folder to put the result in
}

export const useSaveStore = create<SaveState>((set, get) => ({
  formats: readFormats(),
  results: {},
  toggleFormat: (format) => {
    const current = get().formats;
    const next = current.includes(format) ? current.filter((f) => f !== format) : [...current, format];
    if (!next.length) return; // keep at least one format lit
    const ordered = EXPORT_FORMATS.filter((f) => next.includes(f));
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ordered));
    } catch {
      // storage unavailable: keep the in-memory choice
    }
    set({ formats: ordered });
  },
  saveTask: async (task) => {
    // SRT needs final cue timings; a task stopped early still has them, a running one does not
    const finished = task.status === "completed" || task.status === "cancelled";
    const formats = get().formats.filter((f) => f !== "srt" || finished);
    const base = exportBaseName(task);
    const record = (result: SaveResult) => set((state) => ({ results: { ...state.results, [task.id]: result } }));
    try {
      const dir = isTauri() ? await targetDir(task) : null;
      if (dir) {
        record({ paths: await saveTaskFiles(task.id, formats, dir, base) });
        return;
      }
      const names: string[] = [];
      for (const format of formats) {
        if (await saveExport(await exportTask(task.id, format), `${base}.${format}`)) names.push(`${base}.${format}`);
      }
      record({ paths: names });
    } catch (error) {
      record({ paths: [], error: errorMessage(error) });
    }
  },
}));
