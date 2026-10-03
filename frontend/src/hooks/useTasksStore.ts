// Zustand store managing task state: library summaries (polled) + live text of the open task (websocket).
import { create } from "zustand";

import type { TaskSnapshot, TaskStatus, TaskSummary } from "../lib/api";

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

const RECENT_TASK_GRACE_S = 5;

export const isActive =(task: TaskSummary): boolean => !TERMINAL_STATUSES.has(task.status);

interface TasksState {
  tasks: Record<string, TaskSnapshot>;
  /** Task shown in the output area. */
  activeTaskId: string | null;
  /** True while the output follows the running batch file; cleared when the user picks a row. */
  followBatch: boolean;
  setActiveTask(id: string | null): void;
  /** The user picked a task to look at: show it and stop following the batch. */
  selectTask(id: string): void;
  setFollowBatch(follow: boolean): void;
  upsertTask(snapshot: TaskSnapshot): void;
  /** Replace the library with the polled list, keeping texts already loaded for each task. */
  mergeSummaries(list: TaskSummary[]): void;
  removeTask(id: string): void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: {},
  activeTaskId: null,
  followBatch: true,
  setActiveTask: (id) => set({ activeTaskId: id }),
  selectTask: (id) => set({ activeTaskId: id, followBatch: false }),
  setFollowBatch: (follow) => set({ followBatch: follow }),
  upsertTask: (snapshot) =>
    set((state) => ({ tasks: { ...state.tasks, [snapshot.id]: { ...state.tasks[snapshot.id], ...snapshot } } })),
  mergeSummaries: (list) =>
    set((state) => {
      const tasks: Record<string, TaskSnapshot> = Object.fromEntries(
        list.map((summary) => [summary.id, { ...state.tasks[summary.id], ...summary }])
      );
      // A poll issued just before a task was created does not contain it yet; keep fresh local tasks.
      const now = Date.now() / 1000;
      for (const task of Object.values(state.tasks)) {
        if (!tasks[task.id] && now - task.created_at < RECENT_TASK_GRACE_S) tasks[task.id] = task;
      }
      return { tasks, activeTaskId: state.activeTaskId && tasks[state.activeTaskId] ? state.activeTaskId : null };
    }),
  removeTask: (id) =>
    set((state) => {
      const remaining = { ...state.tasks };
      delete remaining[id];
      return { tasks: remaining, activeTaskId: state.activeTaskId === id ? null : state.activeTaskId };
    }),
}));

/** Resolve with the task once it reaches a final state, or null if it disappears (deleted). */
export function waitForTerminal(taskId: string): Promise<TaskSnapshot | null> {
  return new Promise((resolve) => {
    let seen = false;
    let unsubscribe: () => void = () => undefined;
    const check = (state: TasksState): boolean => {
      const task = state.tasks[taskId];
      if (task) seen = true;
      if (task && TERMINAL_STATUSES.has(task.status)) {
        resolve(task);
        return true;
      }
      if (!task && seen) {
        resolve(null);
        return true;
      }
      return false;
    };
    if (check(useTasksStore.getState())) return;
    unsubscribe = useTasksStore.subscribe((state) => {
      if (check(state)) unsubscribe();
    });
  });
}
