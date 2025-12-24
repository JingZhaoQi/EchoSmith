// Zustand store managing task state.
import { create } from "zustand";

import type { TaskSnapshot } from "../lib/api";

interface TasksState {
  tasks: Record<string, TaskSnapshot>;
  activeTaskId: string | null;
  userClearedAll: boolean;
  setActiveTask(id: string | null): void;
  upsertTask(snapshot: TaskSnapshot): void;
  setTasks(list: TaskSnapshot[]): void;
  removeTask(id: string): void;
  clearAllTasks(): void;
  resetUserClearedFlag(): void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: {},
  activeTaskId: null,
  userClearedAll: false,
  setActiveTask: (id) => set({ activeTaskId: id }),
  upsertTask: (snapshot) =>
    set((state) => ({
      tasks: { ...state.tasks, [snapshot.id]: snapshot },
      userClearedAll: false
    })),
  setTasks: (list) =>
    set((state) => {
      if (state.userClearedAll) {
        return state;
      }
      return {
        tasks: Object.fromEntries(list.map((item) => [item.id, item])),
        userClearedAll: false
      };
    }),
  removeTask: (id) =>
    set((state) => {
      const remaining = { ...state.tasks };
      delete remaining[id];
      return {
        tasks: remaining,
        activeTaskId: state.activeTaskId === id ? null : state.activeTaskId
      };
    }),
  clearAllTasks: () =>
    set(() => ({
      tasks: {},
      activeTaskId: null,
      userClearedAll: true
    })),
  resetUserClearedFlag: () =>
    set({ userClearedAll: false })
}));
