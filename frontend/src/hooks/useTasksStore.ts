// Zustand store managing task state.
import { create } from "zustand";

import type { TaskSnapshot } from "../lib/api";

interface TasksState {
  tasks: Record<string, TaskSnapshot>;
  activeTaskId: string | null;
  setActiveTask(id: string | null): void;
  upsertTask(snapshot: TaskSnapshot): void;
  setTasks(list: TaskSnapshot[]): void;
  removeTask(id: string): void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: {},
  activeTaskId: null,
  setActiveTask: (id) => set({ activeTaskId: id }),
  upsertTask: (snapshot) =>
    set((state) => ({ tasks: { ...state.tasks, [snapshot.id]: snapshot } })),
  setTasks: (list) =>
    set(() => ({ tasks: Object.fromEntries(list.map((item) => [item.id, item])) })),
  removeTask: (id) =>
    set((state) => {
      const { [id]: removed, ...remaining } = state.tasks;
      return {
        tasks: remaining,
        activeTaskId: state.activeTaskId === id ? null : state.activeTaskId
      };
    })
}));
