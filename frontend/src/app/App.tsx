// Media workspace UI: source controls plus one unified transcript result panel.
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useTheme } from "../hooks/useTheme";
import { BatchTaskComposer } from "../components/BatchTaskComposer";
import { SettingsPanel } from "../components/SettingsPanel";
import { UrlTaskComposer } from "../components/UrlTaskComposer";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { Button } from "../components/ui/button";
import { MoonIcon, SettingsIcon, SparklesIcon, SunIcon } from "lucide-react";
import { ensureBackendBase, fetchSettings, listTasks } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { useTaskSubscription } from "../hooks/useTaskSubscription";
import { AuroraBackground } from "../components/ui/aurora-background";

const queryClient = new QueryClient();

const logoUrl = new URL('../../echo_logo.svg', import.meta.url).href;

type LeftTab = "batch" | "url";

function AppShell(): JSX.Element {
  const [theme, setTheme] = useTheme();
  const [leftTab, setLeftTab] = useState<LeftTab>("batch");
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
    document.title = "闻见 · EchoSmith";
    void ensureBackendBase();
  }, []);

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
                闻见 · EchoSmith
              </h1>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                本地媒体下载、转写、纠错与导出中心
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setTheme(darkActive ? "light" : "dark")}
              title={darkActive ? "切换浅色模式" : "切换深色模式"}
              aria-label={darkActive ? "切换浅色模式" : "切换深色模式"}
            >
              {darkActive ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`gap-1.5 ${correctionActive ? "status-pill-success border-emerald-500/20" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              title="打开设置"
            >
              {correctionActive ? <SparklesIcon className="h-4 w-4" /> : <SettingsIcon className="h-4 w-4" />}
              设置
            </Button>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] xl:gap-5 xl:p-5">
          <section className="flex min-h-0 flex-col gap-4 overflow-hidden">
            <div className="relative flex flex-shrink-0 rounded-2xl border border-white/60 bg-white/40 p-1 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05]">
              <div
                className="absolute top-1 bottom-1 rounded-xl bg-white shadow-sm transition-transform duration-200 ease-out dark:bg-white/[0.10]"
                style={{
                  width: "calc(50% - 4px)",
                  transform: leftTab === "batch" ? "translateX(0)" : "translateX(calc(100% + 8px))",
                }}
              />
              {([
                { key: "batch" as LeftTab, label: "本地批量" },
                { key: "url" as LeftTab, label: "在线视频" },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLeftTab(key)}
                  className={`relative z-10 flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                    leftTab === key
                      ? "text-slate-950 dark:text-white"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {leftTab === "batch" ? <BatchTaskComposer /> : <UrlTaskComposer />}
            </div>
          </section>

          <section className="min-h-0">
            <TranscriptPanel correctionActive={correctionActive} />
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

      <style>{`
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-slide-in-left { animation: slide-in-left 0.5s ease-out; }
        .animate-slide-in-right { animation: slide-in-right 0.5s ease-out 0.1s both; }
      `}</style>
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
