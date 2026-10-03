// Shared constants and utility functions.
import type { TaskSummary } from "./api";

export function getSourceLabel(source?: Record<string, unknown>, maxLen = 50): string {
  if (!source) return "";
  const truncate = (s: string) => (s.length > maxLen ? s.slice(0, maxLen) + "…" : s);
  const name = (source as { name?: unknown }).name;
  if (typeof name === "string" && name.length > 0) {
    return truncate(name);
  }
  const value = (source as { value?: unknown }).value;
  if (typeof value === "string" && value.length > 0) {
    return truncate(value);
  }
  const url = (source as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) {
    return truncate(url);
  }
  return "";
}

/** File name for exports: source name without its extension; video titles are kept whole. */
export function exportBaseName(task: TaskSummary): string {
  const name = String(task.source.name ?? task.id);
  if (task.source.type === "url") return name.replace(/[\\/:*?"<>|]+/g, " ").trim() || task.id;
  const file = name.split(/[\\/]/).pop() ?? name;
  return file.includes(".") ? file.replace(/\.[^.]+$/, "") : file;
}
