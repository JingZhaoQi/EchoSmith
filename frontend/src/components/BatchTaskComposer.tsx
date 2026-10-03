// Batch intake for local files; the queue itself lives in useBatchStore so it survives view changes.
import { useRef, useState } from "react";
import { CheckIcon, FileAudioIcon, PlayIcon, SquareIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import { MEDIA_EXTENSIONS, useBatchStore, type BatchItem } from "../hooks/useBatchStore";
import { EXPORT_FORMATS, isTauri, type ExportFormat } from "../lib/api";
import { useT, type Messages } from "../lib/i18n";

const FORMAT_LABEL: Record<ExportFormat, string> = { txt: "TXT", srt: "SRT", md: "Markdown" };
const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

function ItemIcon({ status }: { status: BatchItem["status"] }): JSX.Element {
  if (status === "completed") return <CheckIcon className="h-4 w-4 flex-shrink-0 text-emerald-500" />;
  if (status === "failed" || status === "cancelled") return <XIcon className="h-4 w-4 flex-shrink-0 text-red-500" />;
  if (status === "processing")
    return <div className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />;
  return <FileAudioIcon className="h-4 w-4 flex-shrink-0 text-slate-400" />;
}

const itemStatus = (item: BatchItem, t: Messages) =>
  item.status === "pending" ? t.status.queued : item.status === "processing" ? t.status.running : t.status[item.status];

export function BatchTaskComposer(): JSX.Element {
  const t = useT();
  const { items, formats, running, addFiles, removeItem, toggleFormat, start, stop, clear } = useBatchStore();
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

  return (
    <div className="liquid-panel flex h-full min-h-0 flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t.batchTitle}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.batchSubtitle}</p>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-slate-900 dark:text-white">{t.exportFormat}</span>
        <div className="flex gap-2" role="group" aria-label={t.exportFormat}>
          {EXPORT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={formats.includes(format)}
              onClick={() => toggleFormat(format)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                formats.includes(format)
                  ? "bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950"
                  : "glass-field text-slate-700 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/[0.10]"
              }`}
            >
              {FORMAT_LABEL[format]}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void chooseFiles()}
        className="group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300/80 bg-white/35 px-5 py-7 text-center transition-all hover:border-slate-400/70 hover:bg-white/55 dark:border-white/[0.12] dark:bg-white/[0.04] dark:hover:bg-white/[0.07]"
      >
        <span className="mb-3 rounded-full bg-sky-500/10 p-3 transition-colors group-hover:bg-sky-500/15 dark:bg-sky-400/10">
          <UploadIcon className="h-7 w-7 text-sky-700 dark:text-sky-300" strokeWidth={2.5} />
        </span>
        <span className="mb-1 text-sm font-semibold text-slate-950 dark:text-white">{t.clickOrDrag}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{t.supportedFormats}</span>
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
          {items.map((item) => (
            <li key={item.id} className="glass-field rounded-2xl px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <ItemIcon status={item.status} />
                <span className="min-w-0 flex-1 truncate font-medium" title={item.path ?? item.name}>
                  {item.name}
                </span>
                <span className="flex-shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{itemStatus(item, t)}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  title={t.remove}
                  aria-label={`${t.remove} ${item.name}`}
                  className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-black/[0.08] dark:hover:bg-white/[0.12]"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              {(item.error || item.exportError) && (
                <p className="mt-1 truncate pl-6 text-[11px] text-red-500 dark:text-red-300" title={item.error ?? item.exportError}>
                  {item.error ?? `${t.exportErrorPrefix}${item.exportError}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-2">
        {running ? (
          <Button variant="secondary" className="flex-1 gap-2" onClick={stop}>
            <SquareIcon className="h-4 w-4" />
            {t.stopBatch} · {t.processing(done, items.length)}
          </Button>
        ) : (
          <Button className="flex-1 gap-2" disabled={pending === 0 || formats.length === 0} onClick={start}>
            <PlayIcon className="h-4 w-4" />
            {pending === 0 && done > 0 ? t.allDone : pending > 0 && done > 0 ? t.resumeBatch(pending) : t.startBatch(pending)}
          </Button>
        )}
        <Button variant="secondary" className="gap-1.5" disabled={items.length === 0} onClick={clear} title={t.clearList}>
          <Trash2Icon className="h-4 w-4" />
          {t.clearList}
        </Button>
      </div>
      {formats.length === 0 && <p className="-mt-3 text-xs text-amber-600 dark:text-amber-400">{t.selectFormatFirst}</p>}
    </div>
  );
}
