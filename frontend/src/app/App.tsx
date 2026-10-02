// Media workspace UI: task library + source intake + dual transcript panels.
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useTheme } from "../hooks/useTheme";
import { BatchTaskComposer } from "../components/BatchTaskComposer";
import { CorrectedPanel } from "../components/CorrectedPanel";
import { RawTranscriptPanel } from "../components/RawTranscriptPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { TaskLibraryPanel } from "../components/TaskLibraryPanel";
import { UrlTaskComposer } from "../components/UrlTaskComposer";
import { Button } from "../components/ui/button";
import { MoonIcon, SettingsIcon, SparklesIcon, SunIcon } from "lucide-react";
import { ensureBackendBase, fetchSettings, listTasks } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { useTaskSubscription } from "../hooks/useTaskSubscription";
import { AuroraBackground } from "../components/ui/aurora-background";
import { useLocaleStore, useT } from "../lib/i18n";

const queryClient = new QueryClient();

const logoUrl = new URL('../../echo_logo.svg', import.meta.url).href;

type SourceTab = "batch" | "url";

function AppShell(): JSX.Element {
  const [theme, setTheme] = useTheme();
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const [sourceTab, setSourceTab] = useState<SourceTab>("batch");
  const [showSettings, setShowSettings] = useState(false);
  const [correctionActive, setCorrectionActive] = useState(false);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const setTasks = useTasksStore((state) => state.setTasks);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: listTasks
  });
  const darkActive = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    if (tasksQuery.data) {
      setTasks(tasksQuery.data);
      if (!activeTaskId && tasksQuery.data.length > 0) {
        const running = tasksQuery.data.find((task) => task.status === "running") ?? tasksQuery.data[0];
        setActiveTask(running.id);
      }
    }
  }, [tasksQuery.data, activeTaskId, setTasks, setActiveTask]);

  useTaskSubscription(activeTaskId);

  useEffect(() => {
    void ensureBackendBase();
  }, []);

  useEffect(() => {
    document.title = locale === "zh" ? "闻见 · EchoSmith" : "EchoSmith";
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDark(media.matches);
    updateSystemTheme();
    if (media.addEventListener) {
      media.addEventListener("change", updateSystemTheme);
      return () => media.removeEventListener("change", updateSystemTheme);
    }
    media.addListener(updateSystemTheme);
    return () => media.removeListener(updateSystemTheme);
  }, []);

  // Refresh correction status on mount and when settings panel closes
  useEffect(() => {
    if (!showSettings) {
      fetchSettings()
        .then((s) => setCorrectionActive(s.correction.mode !== "none" && s.correction.api_key_set))
        .catch(() => {});
    }
  }, [showSettings]);

  return (
    <AuroraBackground className="h-screen">
      <div className="h-screen flex flex-col overflow-hidden">
        <header className="glass-toolbar z-50 flex items-center justify-between px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={logoUrl}
              alt="EchoSmith logo"
              className="h-9 w-9 flex-shrink-0"
            />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 dark:text-white">
                {locale === "zh" ? "闻见 · EchoSmith" : "EchoSmith"}
              </h1>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {t.appSubtitle}
              </p>
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
              className={`gap-1.5 ${correctionActive ? "status-pill-success border-emerald-500/20" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              title={t.openSettings}
            >
              {correctionActive ? <SparklesIcon className="h-4 w-4" /> : <SettingsIcon className="h-4 w-4" />}
              {t.settings}
            </Button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[260px_minmax(360px,420px)_minmax(0,1fr)] lg:overflow-hidden xl:gap-5 xl:p-5">
          <section className="min-h-[240px] lg:min-h-0">
            <TaskLibraryPanel />
          </section>

          <section className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto">
            <div className="relative flex flex-shrink-0 rounded-2xl border border-white/60 bg-white/40 p-1 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]">
              <div
                className="absolute top-1 bottom-1 rounded-xl bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-white/[0.10]"
                style={{
                  width: "calc(50% - 4px)",
                  transform: sourceTab === "batch" ? "translateX(0)" : "translateX(calc(100% + 8px))",
                }}
              />
              {([
                { key: "batch" as SourceTab, label: t.tabBatch },
                { key: "url" as SourceTab, label: t.tabUrl },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSourceTab(key)}
                  className={`relative z-10 flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                    sourceTab === key
                      ? "text-slate-950 dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1">
              {sourceTab === "batch" ? <BatchTaskComposer /> : <UrlTaskComposer />}
            </div>
          </section>

          <section className="grid min-h-[480px] grid-rows-2 gap-4 lg:min-h-0">
            <div className="min-h-0">
              <RawTranscriptPanel />
            </div>
            <div className="min-h-0">
              <CorrectedPanel correctionActive={correctionActive} />
            </div>
          </section>
        </main>

        {showSettings && (
          <SettingsPanel
            onClose={() => setShowSettings(false)}
            onSaved={(active) => setCorrectionActive(active)}
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
