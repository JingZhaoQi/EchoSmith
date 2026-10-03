// One transcript column (ASR or corrected): header, own progress, scrollable text with copy.
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import { useT } from "../lib/i18n";

export type Tone = "default" | "success" | "error";

interface TranscriptPanelProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  status: string;
  tone: Tone;
  /** null hides the progress bar */
  progress: number | null;
  text: string;
  emptyText: string;
  /** follow new text at the bottom (live task) or start at the top (finished task) */
  live: boolean;
  /** changes when another task is opened */
  resetKey: string;
  /** extra header buttons (e.g. close / show the other panel) */
  actions?: ReactNode;
}

const STICK_PX = 40;

export function TranscriptPanel(props: TranscriptPanelProps): JSX.Element {
  const { icon, title, subtitle, status, tone, progress, text, emptyText, live, resetKey, actions } = props;
  const t = useT();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(live);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    stick.current = live;
    const el = scrollRef.current;
    if (el) el.scrollTop = live ? el.scrollHeight : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another task is opened
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const pill = tone === "success" ? "status-pill-success" : tone === "error" ? "status-pill-danger" : "";
  const percent = progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);

  return (
    <Card className="flex h-full min-h-0 flex-col gap-3 !space-y-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">{title}</h3>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={`status-pill ${pill}`}>{status}</span>
          {actions}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg"
            disabled={!text}
            onClick={copy}
            title={copied ? t.copied : t.copy}
            aria-label={copied ? t.copied : t.copy}
          >
            {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {percent !== null && (
        <div className="flex items-center gap-3">
          <Progress
            value={percent}
            variant={tone === "error" ? "error" : percent >= 100 ? "success" : "default"}
            animated={live && percent < 100}
            className="flex-1"
          />
          <span className="w-10 text-right text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
            {percent}%
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
        className="glass-field min-h-[120px] flex-1 overflow-y-auto whitespace-pre-wrap rounded-2xl p-4 text-[15px] leading-7 text-slate-800 dark:text-slate-100"
      >
        {text || (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
            {emptyText}
          </div>
        )}
      </div>
    </Card>
  );
}
