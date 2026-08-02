import type { TaskSnapshot } from "../lib/api";

const TERMINAL_STATUSES = new Set<TaskSnapshot["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalTask(task?: TaskSnapshot): boolean {
  return Boolean(task && TERMINAL_STATUSES.has(task.status));
}

export function getStoppableTaskIds(tasks: Record<string, TaskSnapshot>): string[] {
  return Object.values(tasks)
    .filter((task) => !TERMINAL_STATUSES.has(task.status))
    .map((task) => task.id);
}

export function getClearableTaskIds(tasks: Record<string, TaskSnapshot>): string[] {
  return Object.values(tasks).map((task) => task.id);
}
