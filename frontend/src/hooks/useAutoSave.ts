// Save every task that finishes during this session in the default formats (desktop only).
import { useEffect } from "react";

import { isTauri } from "../lib/api";
import { useSaveStore } from "./useSaveStore";
import { TERMINAL_STATUSES, useTasksStore } from "./useTasksStore";

export function useAutoSave(): void {
  useEffect(() => {
    if (!isTauri()) return; // the browser would turn this into unrequested downloads
    const unfinished = new Set<string>();
    const scan = () => {
      for (const task of Object.values(useTasksStore.getState().tasks)) {
        if (!TERMINAL_STATUSES.has(task.status)) unfinished.add(task.id);
        else if (unfinished.delete(task.id) && task.status === "completed") void useSaveStore.getState().saveTask(task);
      }
    };
    scan();
    return useTasksStore.subscribe(scan);
  }, []);
}
