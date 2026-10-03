// Main area for an opened task: header with status + default-save formats, ASR and corrected text side by side.
import { useState } from "react";
import { AlertTriangleIcon, CheckIcon, DownloadIcon, FileTextIcon, GlobeIcon, SparklesIcon } from "lucide-react";

import { TranscriptPanel, type Tone } from "./TranscriptPanel";
import { Button } from "./ui/button";
import { useSaveStore } from "../hooks/useSaveStore";
import { EXPORT_FORMATS, type ExportFormat, type TaskSnapshot } from "../lib/api";
import { getSourceLabel } from "../lib/constants";
import { useLocaleStore, useT } from "../lib/i18n";
import { taskStatusLabel } from "../lib/taskStatus";

const FORMAT_LABEL: Record<ExportFormat, string> = { txt: "TXT", srt: "SRT", md: "Markdown" };

export function TaskView({ task }: { task: TaskSnapshot }): JSX.Element {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const formats = useSaveStore((state) => state.formats);
  const toggleFormat = useSaveStore((state) => state.toggleFormat);
  const saveTask = useSaveStore((state) => state.saveTask);
  const saveResult = useSaveStore((state) => state.results[task.id]);
  const [saving, setSaving] = useState(false);

  const running = task.status === "running" || task.status === "queued";
  const finished = task.status === "completed" || task.status === "cancelled";
  const hasText = Boolean(task.result_text || task.raw_text);
  const canSave = hasText && (finished || task.status === "paused" || task.status === "failed");
  const isUrl = task.source.type === "url";

  const handleSave = async () => {
    setSaving(true);
    await saveTask(task);
    setSaving(false);
  };


  // ASR column
  const asrDone = task.asr_progress >= 1;
  const rawStatus =
    task.status === "failed"
      ? t.recognitionFailed
      : task.status === "running" && !asrDone
        ? taskStatusLabel(task, t, locale)
        : asrDone
          ? t.status.completed
          : (t.status[task.status] ?? task.status);
  const rawTone: Tone = task.status === "failed" ? "error" : asrDone ? "success" : "default";
  const rawText = task.raw_text ?? (task.correction_enabled ? "" : (task.result_text ?? ""));

  // Corrected column
  const corrected = task.correction_enabled;
  const correctedText = corrected ? (task.result_text ?? "") : "";
  const corrStatus = !corrected
    ? t.notEnabled
    : task.status === "completed"
      ? t.correctionDone
      : task.status === "running" && (task.phase === "correcting" || correctedText)
        ? `${t.correcting} ${Math.round(task.correction_progress * 100)}%`
        : task.status === "running" || task.status === "queued"
          ? t.waitingCorrection
          : (t.status[task.status] ?? task.status);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="liquid-panel flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isUrl ? (
            <GlobeIcon className="h-4 w-4 flex-shrink-0 text-slate-500" />
          ) : (
            <FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500" />
          )}
          <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white" title={getSourceLabel(task.source, 400)}>
            {getSourceLabel(task.source, 80) || task.id.slice(0, 8)}
          </h2>
          <span className={`status-pill flex-shrink-0 ${task.status === "completed" ? "status-pill-success" : task.status === "failed" ? "status-pill-danger" : ""}`}>
            {taskStatusLabel(task, t, locale)}
          </span>
          {task.correction_failed_batches > 0 && (
            <span className="status-pill flex-shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
              <AlertTriangleIcon className="h-3 w-3" />
              {t.correctionFailedBatches(task.correction_failed_batches)}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400" title={t.defaultSaveHint}>
            {t.defaultSave}
          </span>
          <div className="flex items-center gap-1.5" role="group" aria-label={t.defaultSave}>
            {EXPORT_FORMATS.map((format) => {
              const lit = formats.includes(format);
              return (
                <button
                  key={format}
                  type="button"
                  aria-pressed={lit}
                  title={lit && formats.length === 1 ? t.keepOneFormat : t.defaultSaveHint}
                  onClick={() => toggleFormat(format)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-all ${
                    lit
                      ? "bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950"
                      : "glass-field text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {lit && <CheckIcon className="h-3.5 w-3.5" />}
                  {FORMAT_LABEL[format]}
                </button>
              );
            })}
          </div>
          <Button variant="secondary" size="sm" className="gap-1.5" disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <DownloadIcon className="h-3.5 w-3.5" />
            )}
            {t.saveNow}
          </Button>
        </div>
        {saveResult && (
          <p
            className={`w-full truncate text-xs ${saveResult.error ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}
            title={saveResult.error ?? saveResult.paths.join("\n")}
          >
            {saveResult.error
              ? `${t.exportFailed}: ${saveResult.error}`
              : t.savedFiles(saveResult.paths.map((p) => p.split(/[\\/]/).pop()).join(", "))}
          </p>
        )}
      </header>

      {task.error && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-200">
          {task.error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-4 xl:grid-cols-2 xl:grid-rows-1">
        <TranscriptPanel
          icon={<FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500 dark:text-slate-300" />}
          title={t.rawTitle}
          subtitle={t.rawSubtitle}
          status={rawStatus}
          tone={rawTone}
          progress={task.status === "queued" ? 0 : task.asr_progress}
          text={rawText}
          emptyText={running ? t.rawEmptyWithTask : ""}
          live={running}
          resetKey={task.id}
        />
        <TranscriptPanel
          icon={<SparklesIcon className={`h-4 w-4 flex-shrink-0 ${corrected ? "text-teal-600 dark:text-teal-300" : "text-slate-400"}`} />}
          title={t.correctedTitle}
          subtitle={corrected ? t.correctedSubtitleOn : t.correctedSubtitleOff}
          status={corrStatus}
          tone={corrected && task.status === "completed" ? "success" : "default"}
          progress={corrected ? task.correction_progress : null}
          text={correctedText}
          emptyText={!corrected ? t.correctionOffForTask : running ? t.correctedPending : t.correctedEmpty}
          live={running}
          resetKey={task.id}
        />
      </div>
    </div>
  );
}
