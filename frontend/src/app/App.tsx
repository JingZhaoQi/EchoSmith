// Workspace: sidebar (new task + library) and a results-first main area (task view or intake).
import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MoonIcon, SettingsIcon, SparklesIcon, SunIcon, UploadIcon } from "lucide-react";

import { useTheme } from "../hooks/useTheme";
import { BatchTaskComposer } from "../components/BatchTaskComposer";
import { SettingsPanel, type CorrectionState } from "../components/SettingsPanel";
import { TaskView } from "../components/TaskView";
import { UrlTaskComposer } from "../components/UrlTaskComposer";
import { ResizeHandle } from "../components/ResizeHandle";
import { Button } from "../components/ui/button";
import { AuroraBackground } from "../components/ui/aurora-background";
import { ensureBackendBase, fetchSettings, listTaskSummaries } from "../lib/api";
import { isActive, useTasksStore } from "../hooks/useTasksStore";
import { useTaskSubscription } from "../hooks/useTaskSubscription";
import { useFileDrop } from "../hooks/useFileDrop";
import { useAutoSave } from "../hooks/useAutoSave";
import { isNumber, usePersistentState } from "../hooks/usePersistentState";
import { useLocaleStore, useT } from "../lib/i18n";

const queryClient = new QueryClient();
const logoUrl = new URL("../../echo_logo.svg", import.meta.url).href;
const POLL_ACTIVE_MS = 1000;
const SIDEBAR_DEFAULT = 300;
const SIDEBAR_MIN = 240;
const clampSidebar = (width: number) =>
  Math.round(Math.min(Math.max(width, SIDEBAR_MIN), Math.max(SIDEBAR_MIN, window.innerWidth * 0.5)));
const POLL_IDLE_MS = 5000;

type SourceTab = "batch" | "url";

function IntakeView({ tab, setTab }: { tab: SourceTab; setTab(tab: SourceTab): void }): JSX.Element {
  const t = useT();
  const tabs: Array<{ key: SourceTab; label: string }> = [
    { key: "batch", label: t.tabBatch },
    { key: "url", label: t.tabUrl },
  ];
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div role="tablist" className="relative flex flex-shrink-0 rounded-2xl border border-white/60 bg-white/40 p-1 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]">
        <div
          className="absolute bottom-1 top-1 rounded-xl bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-white/[0.10]"
          style={{ width: "calc(50% - 4px)", transform: tab === "batch" ? "translateX(0)" : "translateX(calc(100% + 8px))" }}
        />
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`relative z-10 flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 ${
              tab === key ? "text-slate-950 dark:text-white" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* both stay mounted: switching tabs never drops a running batch or download */}
      <div className="min-h-0 flex-1" hidden={tab !== "batch"}>
        <BatchTaskComposer />
      </div>
      <div className="min-h-0 flex-1" hidden={tab !== "url"}>
        <UrlTaskComposer />
      </div>
    </div>
  );
}

function AppShell(): JSX.Element {
  const [theme, setTheme] = useTheme();
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const [showSettings, setShowSettings] = useState(false);
  const [correction, setCorrection] = useState<CorrectionState>({ on: false, ready: false });
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>("batch");
  const [sidebarWidth, setSidebarWidth] = usePersistentState("echosmith-sidebar-width", SIDEBAR_DEFAULT, isNumber);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const activeTask = useTasksStore((state) => (state.activeTaskId ? state.tasks[state.activeTaskId] : undefined));
  const mergeSummaries = useTasksStore((state) => state.mergeSummaries);
  const anyActive = useTasksStore((state) => Object.values(state.tasks).some(isActive));
  const darkActive = theme === "dark" || (theme === "system" && systemDark);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: listTaskSummaries,
    refetchInterval: anyActive ? POLL_ACTIVE_MS : POLL_IDLE_MS,
  });

  const openedOnce = useRef(false);
  useEffect(() => {
    if (!tasksQuery.data) return;
    mergeSummaries(tasksQuery.data);
    if (!openedOnce.current) {
      openedOnce.current = true;
      const running = tasksQuery.data.find(isActive);
      if (running) useTasksStore.getState().setActiveTask(running.id);
    }
  }, [tasksQuery.data, mergeSummaries]);

  useTaskSubscription(activeTaskId);
  useAutoSave();

  const onRejected = useCallback(() => {
    setDropNotice(t.unsupportedFormat);
    setTimeout(() => setDropNotice(null), 3000);
  }, [t]);
  const onAccepted = useCallback(() => setSourceTab("batch"), []);
  const dragging = useFileDrop(onAccepted, onRejected);

  useEffect(() => {
    void ensureBackendBase();
  }, []);

  useEffect(() => {
    document.title = locale === "zh" ? "闻见 · EchoSmith" : "EchoSmith";
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  // Refresh correction status on mount and when the settings panel closes
  useEffect(() => {
    if (!showSettings) {
      fetchSettings()
        .then((s) => {
          const on = s.correction.mode !== "none";
          setCorrection({ on, ready: on && s.correction.api_key_set });
        })
        .catch(() => {});
    }
  }, [showSettings]);

  return (
    <AuroraBackground className="h-screen">
      <div className="flex h-screen flex-col overflow-hidden">
        <header className="glass-toolbar z-50 flex items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img src={logoUrl} alt="EchoSmith logo" className="h-9 w-9 flex-shrink-0" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 dark:text-white">
                {locale === "zh" ? "闻见 · EchoSmith" : "EchoSmith"}
              </h1>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{t.appSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="text-xs font-semibold"
              onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
              title={t.switchLanguage}
              aria-label={t.switchLanguage}
            >
              {t.languageButton}
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setTheme(darkActive ? "light" : "dark")}
              title={darkActive ? t.switchToLight : t.switchToDark}
              aria-label={darkActive ? t.switchToLight : t.switchToDark}
            >
              {darkActive ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`gap-1.5 ${correction.ready ? "status-pill-success border-emerald-500/20" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              title={t.openSettings}
            >
              {correction.ready ? <SparklesIcon className="h-4 w-4" /> : <SettingsIcon className="h-4 w-4" />}
              {t.settings}
            </Button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 gap-2 p-4 xl:p-5">
          <section ref={sidebarRef} className="min-h-0 flex-shrink-0" style={{ width: sidebarWidth }}>
            <IntakeView tab={sourceTab} setTab={setSourceTab} />
          </section>
          <ResizeHandle
            label={t.resizeHint}
            value={sidebarWidth}
            onDrag={(x) => setSidebarWidth(clampSidebar(x - (sidebarRef.current?.getBoundingClientRect().left ?? 0)))}
            onStep={(d) => setSidebarWidth(clampSidebar(sidebarWidth + d * 16))}
            onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
          />
          <section className="min-h-0 min-w-0 flex-1">
            <TaskView task={activeTask} correctionOn={correction.on} correctionActive={correction.ready} />
          </section>
        </main>

        {(dragging || dropNotice) && (
          <div className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-sky-500/10 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-sky-400 bg-white/80 px-12 py-10 text-slate-900 shadow-xl dark:bg-slate-900/80 dark:text-white">
              <UploadIcon className="h-10 w-10 text-sky-600 dark:text-sky-300" />
              <span className="text-base font-semibold">{dropNotice ?? t.dropToAdd}</span>
            </div>
          </div>
        )}

        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onSaved={setCorrection}
            theme={theme}
            onThemeChange={setTheme}
          />
        )}
      </div>
    </AuroraBackground>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
