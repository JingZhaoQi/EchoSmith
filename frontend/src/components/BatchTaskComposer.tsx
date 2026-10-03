// Batch intake for local files; the list doubles as the task list (click a file to view its result).
import { useRef, useState } from "react";
import { PlayIcon, SquareIcon, Trash2Icon, UploadIcon } from "lucide-react";

import { TaskRow } from "./TaskRow";
import { Button } from "./ui/button";
import { MEDIA_EXTENSIONS, useBatchStore, type BatchItem } from "../hooks/useBatchStore";
import { useSaveStore } from "../hooks/useSaveStore";
import { useTasksStore } from "../hooks/useTasksStore";
import { isTauri, type TaskSnapshot } from "../lib/api";
import { useT, type Messages } from "../lib/i18n";

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Status for an item whose task is not (or no longer) in the store; otherwise the row shows the task's own. */
function itemNote(item: BatchItem, task: TaskSnapshot | undefined, t: Messages): string | undefined {
  if (task) return undefined;
  if (item.status === "pending") return t.status.queued;
  if (item.status === "processing") return t.status.running;
  return t.status[item.status];
}

export function BatchTaskComposer(): JSX.Element {
  const t = useT();
  const { items, running, addFiles, removeItem, start, stop, clear } = useBatchStore();
  const tasks = useTasksStore((state) => state.tasks);
  const saveResults = useSaveStore((state) => state.results);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = (files: Array<{ name: string; path?: string; file?: File }>) => {
    if (files.length && addFiles(files) === 0) setNotice(t.unsupportedFormat);
    else setNotice(null);
  };

  const chooseFiles = async () => {
    if (!isTauri()) {
      inputRef.current?.click();
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: true,
      // both cases: WebKit's file panel matches extensions case-sensitively
      filters: [{ name: "Audio/Video", extensions: MEDIA_EXTENSIONS.flatMap((e) => [e, e.toUpperCase()]) }],
    });
    if (selected) add(selected.map((path) => ({ name: baseName(path), path })));
  };

  const pending = items.filter((i) => i.status === "pending").length;
  const done = items.filter((i) => i.status === "completed").length;
  const compact = items.length > 0;

  return (
    <div className="liquid-panel flex h-full min-h-0 flex-col gap-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t.batchTitle}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.batchSubtitle}</p>
      </div>

      <button
        type="button"
        onClick={() => void chooseFiles()}
        className={`group flex flex-shrink-0 items-center justify-center rounded-2xl border-2 border-dashed border-slate-300/80 bg-white/35 text-center transition-all hover:border-slate-400/70 hover:bg-white/55 dark:border-white/[0.12] dark:bg-white/[0.04] dark:hover:bg-white/[0.07] ${
          compact ? "gap-3 px-4 py-3" : "flex-col px-5 py-8"
        }`}
      >
        <span className={`rounded-full bg-sky-500/10 transition-colors group-hover:bg-sky-500/15 dark:bg-sky-400/10 ${compact ? "p-2" : "mb-3 p-3"}`}>
          <UploadIcon className={`${compact ? "h-4 w-4" : "h-7 w-7"} text-sky-700 dark:text-sky-300`} strokeWidth={2.5} />
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-slate-950 dark:text-white">{t.clickOrDrag}</span>
          {!compact && <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.supportedFormats}</span>}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept={MEDIA_EXTENSIONS.map((e) => `.${e}`).join(",")}
        onChange={(e) => {
          add(Array.from(e.target.files ?? []).map((file) => ({ name: file.name, file })));
          e.target.value = "";
        }}
      />
      {notice && <p className="-mt-2 text-xs text-amber-600 dark:text-amber-400">{notice}</p>}

      {items.length > 0 && (
        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {items.map((item) => {
            const task = item.taskId ? tasks[item.taskId] : undefined;
            const saveError = item.taskId ? saveResults[item.taskId]?.error : undefined;
            return (
              <TaskRow
                key={item.id}
                name={item.name}
                task={task}
                note={itemNote(item, task, t)}
                error={item.error ?? (saveError && `${t.exportErrorPrefix}${saveError}`)}
                onRemove={() => removeItem(item.id)}
              />
            );
          })}
        </ul>
      )}

      <div className="mt-auto flex flex-shrink-0 items-center gap-2">
        {running ? (
          <Button variant="secondary" className="flex-1 gap-2" onClick={stop}>
            <SquareIcon className="h-4 w-4" />
            {t.stopBatch} ({done}/{items.length})
          </Button>
        ) : (
          <Button className="flex-1 gap-2" disabled={pending === 0} onClick={start}>
            <PlayIcon className="h-4 w-4" />
            {pending === 0 && done > 0 ? t.allDone : pending > 0 && done > 0 ? t.resumeBatch(pending) : t.startBatch(pending)}
          </Button>
        )}
        {/* icon-only: with a text label the start button wraps at the default sidebar width */}
        <Button
          variant="secondary"
          size="icon"
          className="h-10 w-10 flex-shrink-0"
          disabled={items.length === 0}
          onClick={() => void clear()}
          title={t.clearList}
          aria-label={t.clearList}
        >
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
