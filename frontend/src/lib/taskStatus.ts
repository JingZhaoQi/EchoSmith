// One status line for a task, shared by the library rows and the task view.
import type { TaskSummary } from "./api";
import { localizeBackendMessage, type Locale, type Messages } from "./i18n";

const pct = (value: number) => `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;

export function taskStatusLabel(task: TaskSummary, t: Messages, locale: Locale): string {
  if (task.status === "running") {
    if (task.phase === "downloading") return localizeBackendMessage(task.message || t.downloading, locale);
    if (task.phase === "correcting") return `${t.correcting} ${pct(task.correction_progress)}`;
    // before recognition starts, the backend's stage ("模型加载中", "准备音频") says more than "0%"
    if (task.message && !task.message.startsWith("转写")) return localizeBackendMessage(task.message, locale);
    return `${t.transcribing} ${pct(task.asr_progress)}`;
  }
  return t.status[task.status] ?? task.status;
}
