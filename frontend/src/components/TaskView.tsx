// Output area: header (current task + default-save formats), ASR and corrected text side by side.
import { useRef, useState } from "react";
import { AlertTriangleIcon, CheckIcon, DownloadIcon, FileTextIcon, GlobeIcon, SparklesIcon, XIcon } from "lucide-react";

import { ResizeHandle } from "./ResizeHandle";
import { TranscriptPanel, type Tone } from "./TranscriptPanel";
import { Button } from "./ui/button";
import { isBoolean, isNumber, usePersistentState } from "../hooks/usePersistentState";
import { useSaveStore } from "../hooks/useSaveStore";
import { EXPORT_FORMATS, type ExportFormat, type TaskSnapshot } from "../lib/api";
import { getSourceLabel } from "../lib/constants";
import { useLocaleStore, useT, type Locale, type Messages } from "../lib/i18n";
import { taskStatusLabel } from "../lib/taskStatus";

const FORMAT_LABEL: Record<ExportFormat, string> = { txt: "TXT", srt: "SRT", md: "Markdown" };
const SPLIT_DEFAULT = 50; // ASR column share, percent
const clampSplit = (percent: number) => Math.round(Math.min(80, Math.max(20, percent)));

function rawColumn(task: TaskSnapshot, t: Messages, locale: Locale): { status: string; tone: Tone; text: string } {
  const asrDone = task.asr_progress >= 1;
  const status =
    task.status === "failed"
      ? t.recognitionFailed
      : task.status === "running" && !asrDone
        ? taskStatusLabel(task, t, locale)
        : asrDone
          ? t.status.completed
          : (t.status[task.status] ?? task.status);
  return {
    status,
    tone: task.status === "failed" ? "error" : asrDone ? "success" : "default",
    text: task.raw_text ?? (task.correction_enabled ? "" : (task.result_text ?? "")),
  };
}

function correctedStatus(task: TaskSnapshot, t: Messages): string {
  if (!task.correction_enabled) return t.notEnabled;
  if (task.status === "completed") return t.correctionDone;
  if (task.status === "running" && (task.phase === "correcting" || task.result_text))
    return `${t.correcting} ${Math.round(task.correction_progress * 100)}%`;
  if (task.status === "running" || task.status === "queued") return t.waitingCorrection;
  return t.status[task.status] ?? task.status;
}

interface TaskViewProps {
  /** absent until a task is started or picked in the list */
  task?: TaskSnapshot;
  /** whether new tasks will be corrected (shown before any task exists) */
  correctionActive: boolean;
}

export function TaskView({ task, correctionActive }: TaskViewProps): JSX.Element {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const formats = useSaveStore((state) => state.formats);
  const toggleFormat = useSaveStore((state) => state.toggleFormat);
  const saveTask = useSaveStore((state) => state.saveTask);
  const saveResult = useSaveStore((state) => (task ? state.results[task.id] : undefined));
  const [saving, setSaving] = useState(false);
  const [split, setSplit] = usePersistentState("echosmith-output-split", SPLIT_DEFAULT, isNumber);
  const [correctionClosed, setCorrectionClosed] = usePersistentState("echosmith-correction-closed", false, isBoolean);
  const columnsRef = useRef<HTMLDivElement | null>(null);

  const running = task?.status === "running" || task?.status === "queued";
  const finished = task?.status === "completed" || task?.status === "cancelled";
  const canSave =
    Boolean(task?.result_text || task?.raw_text) && (finished || task?.status === "paused" || task?.status === "failed");

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    await saveTask(task);
    setSaving(false);
  };

  const raw = task ? rawColumn(task, t, locale) : { status: t.waitingTask, tone: "default" as Tone, text: "" };
  const corrected = task ? task.correction_enabled : correctionActive;
  const correctedText = task?.correction_enabled ? (task.result_text ?? "") : "";
  // With correction on in Settings (or a corrected task open) the panel always shows; otherwise it can be closed.
  const closable = !correctionActive && !task?.correction_enabled;
  const showCorrection = !closable || !correctionClosed;
  const iconButton = "inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-black/[0.07] dark:text-slate-300 dark:hover:bg-white/[0.09]";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="liquid-panel flex flex-wrap items-center gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {task?.source.type === "url" ? (
            <GlobeIcon className="h-4 w-4 flex-shrink-0 text-slate-500" />
          ) : (
            <FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500" />
          )}
          {task ? (
            <>
              <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white" title={getSourceLabel(task.source, 400)}>
                {getSourceLabel(task.source, 80) || task.id.slice(0, 8)}
              </h2>
              <span
                className={`status-pill flex-shrink-0 ${task.status === "completed" ? "status-pill-success" : task.status === "failed" ? "status-pill-danger" : ""}`}
              >
                {taskStatusLabel(task, t, locale)}
              </span>
              {task.correction_failed_batches > 0 && (
                <span className="status-pill flex-shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  <AlertTriangleIcon className="h-3 w-3" />
                  {t.correctionFailedBatches(task.correction_failed_batches)}
                </span>
              )}
            </>
          ) : (
            <h2 className="truncate text-base font-semibold text-slate-950 dark:text-white">{t.outputTitle}</h2>
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

      {task?.error && (
        <div className="rounded-2xl border border-red-500/15 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-200">
          {task.error}
        </div>
      )}

      <div ref={columnsRef} className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0" style={{ flex: showCorrection ? `0 0 ${split}%` : "1 1 0%" }}>
          <TranscriptPanel
            icon={<FileTextIcon className="h-4 w-4 flex-shrink-0 text-slate-500 dark:text-slate-300" />}
            title={t.rawTitle}
            subtitle={t.rawSubtitle}
            status={raw.status}
            tone={raw.tone}
            progress={task ? (task.status === "queued" ? 0 : task.asr_progress) : null}
            text={raw.text}
            emptyText={!task ? t.selectOrCreateTask : running ? t.rawEmptyWithTask : ""}
            live={running}
            resetKey={task?.id ?? ""}
            actions={
              !showCorrection && (
                <button type="button" className={iconButton} title={t.showCorrection} aria-label={t.showCorrection} onClick={() => setCorrectionClosed(false)}>
                  <SparklesIcon className="h-4 w-4" />
                </button>
              )
            }
          />
        </div>
        {showCorrection && (
          <>
            <ResizeHandle
              label={t.resizeHint}
              value={split}
              onDrag={(x) => {
                const box = columnsRef.current?.getBoundingClientRect();
                if (box && box.width > 0) setSplit(clampSplit(((x - box.left) / box.width) * 100));
              }}
              onStep={(d) => setSplit(clampSplit(split + d * 2))}
              onReset={() => setSplit(SPLIT_DEFAULT)}
            />
            <div className="min-h-0 min-w-0 flex-1">
              <TranscriptPanel
                icon={<SparklesIcon className={`h-4 w-4 flex-shrink-0 ${corrected ? "text-teal-600 dark:text-teal-300" : "text-slate-400"}`} />}
                title={t.correctedTitle}
                subtitle={corrected ? t.correctedSubtitleOn : t.correctedSubtitleOff}
                status={task ? correctedStatus(task, t) : corrected ? t.waitingTask : t.notEnabled}
                tone={task?.correction_enabled && task.status === "completed" ? "success" : "default"}
                progress={task?.correction_enabled ? task.correction_progress : null}
                text={correctedText}
                emptyText={
                  !corrected
                    ? task
                      ? t.correctionOffForTask
                      : t.correctionDisabledHint
                    : !task
                      ? t.selectOrCreateTask
                      : running
                        ? t.correctedPending
                        : t.correctedEmpty
                }
                live={running}
                resetKey={task?.id ?? ""}
                actions={
                  closable && (
                    <button type="button" className={iconButton} title={t.hideCorrection} aria-label={t.hideCorrection} onClick={() => setCorrectionClosed(true)}>
                      <XIcon className="h-4 w-4" />
                    </button>
                  )
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
