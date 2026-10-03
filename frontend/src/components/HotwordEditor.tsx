// Hotword list management in Settings: view/search, add, delete, import (append), export, clear.
import { useEffect, useRef, useState } from "react";
import { DownloadIcon, PlusIcon, SearchIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  addHotword,
  errorMessage,
  fetchHotwords,
  importHotwords,
  removeHotword,
  saveExport,
  type HotwordList,
} from "../lib/api";
import { useT } from "../lib/i18n";

const SEPARATORS = /[\n\r,，、;；\t]+/;
const CONFIRM_MS = 3000;

type Notice = { text: string; error?: boolean } | null;

export function HotwordEditor({ correctionOn }: { correctionOn: boolean }): JSX.Element {
  const t = useT();
  const [list, setList] = useState<HotwordList>({ words: [], in_prompt: 0 });
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchHotwords()
      .then(setList)
      .catch((e) => setNotice({ text: errorMessage(e), error: true }));
    return () => clearTimeout(confirmTimer.current);
  }, []);

  /** Apply a server change; the server returns the whole list. */
  const apply = async (action: () => Promise<HotwordList>, success?: string) => {
    try {
      setList(await action());
      setNotice(success ? { text: success } : null);
      return true;
    } catch (e) {
      setNotice({ text: errorMessage(e), error: true });
      return false;
    }
  };

  const add = async () => {
    const word = draft.trim();
    if (!word) return;
    if (list.words.includes(word)) {
      setNotice({ text: t.hotwordsExists(word) });
      return;
    }
    if (await apply(() => addHotword(word))) setDraft("");
  };

  const importFile = async (file: File) => {
    const known = new Set(list.words);
    const fresh: string[] = [];
    for (const raw of (await file.text()).split(SEPARATORS)) {
      const word = raw.trim();
      if (word && !known.has(word)) {
        known.add(word);
        fresh.push(word);
      }
    }
    if (!fresh.length) {
      setNotice({ text: t.hotwordsNothingNew });
      return;
    }
    // the import endpoint replaces the list, so send old + new to append
    await apply(() => importHotwords([...list.words, ...fresh]), t.hotwordsImported(fresh.length));
  };

  const exportList = async () => {
    const body = list.words.length ? `${list.words.join("\n")}\n` : "";
    try {
      await saveExport(new Blob([body], { type: "text/plain" }), "hotwords.txt");
    } catch (e) {
      setNotice({ text: errorMessage(e), error: true });
    }
  };

  const clear = async () => {
    if (!confirmClear) {
      setConfirmClear(true);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmClear(false), CONFIRM_MS);
      return;
    }
    clearTimeout(confirmTimer.current);
    setConfirmClear(false);
    await apply(() => importHotwords([]));
  };

  const needle = query.trim();
  const shown = needle ? list.words.filter((w) => w.includes(needle)) : list.words;
  const unused = new Set(list.words.slice(list.in_prompt));
  const input =
    "w-full rounded-lg border border-black/[0.1] bg-white py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 dark:border-white/[0.1] dark:bg-zinc-800";

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t.hotwords} <span className="ml-1 text-xs font-normal text-gray-400">{t.hotwordsLoaded(list.words.length)}</span>
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap">
          <Button variant="secondary" size="sm" className="gap-1" onClick={() => fileRef.current?.click()}>
            <UploadIcon className="h-3.5 w-3.5" />
            {t.hotwordsImport}
          </Button>
          <Button variant="secondary" size="sm" className="gap-1" disabled={!list.words.length} onClick={() => void exportList()}>
            <DownloadIcon className="h-3.5 w-3.5" />
            {t.hotwordsExport}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={`gap-1 ${confirmClear ? "!border-red-500/40 !text-red-600 dark:!text-red-400" : ""}`}
            disabled={!list.words.length}
            onClick={() => void clear()}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
            {confirmClear ? t.hotwordsClearConfirm : t.hotwordsClear}
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{t.hotwordsDesc}</p>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv,.text"
        aria-label={t.importHotwords}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />

      <div className="mb-2 flex gap-2">
        <div className="flex flex-1 gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder={t.hotwordsAddPlaceholder}
            className={`${input} px-3`}
          />
          <Button variant="secondary" size="sm" className="flex-shrink-0 gap-1 whitespace-nowrap" disabled={!draft.trim()} onClick={() => void add()}>
            <PlusIcon className="h-3.5 w-3.5" />
            {t.hotwordsAdd}
          </Button>
        </div>
        <div className="relative w-40">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.hotwordsSearch} className={`${input} pl-8 pr-2`} />
        </div>
      </div>

      {notice && (
        <p className={`mb-2 text-xs ${notice.error ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>{notice.text}</p>
      )}

      {shown.length ? (
        <ul
          aria-label={t.hotwords}
          className="flex max-h-56 flex-wrap content-start gap-1.5 overflow-y-auto rounded-xl border border-black/[0.06] bg-black/[0.02] p-2 dark:border-white/[0.06] dark:bg-white/[0.03]"
        >
          {shown.map((word) => (
            <li
              key={word}
              title={unused.has(word) ? t.hotwordUnused : undefined}
              className={`group inline-flex items-center gap-0.5 rounded-lg border py-0.5 pl-2 pr-0.5 text-xs ${
                unused.has(word)
                  ? "border-dashed border-amber-500/40 text-gray-400 dark:text-gray-500"
                  : "border-black/[0.08] bg-white text-gray-800 dark:border-white/[0.1] dark:bg-zinc-800 dark:text-gray-200"
              }`}
            >
              {word}
              <button
                type="button"
                aria-label={`${t.remove} ${word}`}
                title={t.remove}
                onClick={() => void apply(() => removeHotword(word))}
                className="rounded p-0.5 text-gray-400 hover:bg-black/[0.06] hover:text-red-600 dark:hover:bg-white/[0.08]"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-black/[0.1] p-4 text-center text-xs text-gray-400 dark:border-white/[0.1]">
          {list.words.length ? t.hotwordsNoMatch : t.hotwordsEmpty}
        </p>
      )}

      <p className="mt-2 text-xs text-gray-400">{t.hotwordsFormatHint}</p>
      {list.in_prompt < list.words.length && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t.hotwordsOverBudget(list.in_prompt)}</p>
      )}
      {!correctionOn && list.words.length > 0 && (
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t.hotwordsNeedCorrection}</p>
      )}
    </section>
  );
}
