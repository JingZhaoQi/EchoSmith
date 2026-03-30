// Three-stage UI: Audio Source | ASR Results | Correction Results
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useTheme } from "../hooks/useTheme";
import { BatchTaskComposer } from "../components/BatchTaskComposer";
import { SettingsPanel } from "../components/SettingsPanel";
import { UrlTaskComposer } from "../components/UrlTaskComposer";
// TaskStreamPanel is now embedded inside BatchTaskComposer
import { ResultPanel } from "../components/ResultPanel";
import { CorrectionPanel } from "../components/CorrectionPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { Button } from "../components/ui/button";
import { SettingsIcon } from "lucide-react";
import { ensureBackendBase, fetchHealth, fetchSettings, listTasks } from "../lib/api";
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
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const setTasks = useTasksStore((state) => state.setTasks);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);
  useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 30_000 });
  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: listTasks
  });

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
      <div className="h-screen flex flex-col backdrop-blur-[2px] overflow-hidden">
        {/* Header */}
        <header className="border-b border-black/[0.08] dark:border-white/[0.08] backdrop-blur-2xl backdrop-saturate-150 bg-white/80 dark:bg-zinc-900/80 px-8 py-3 flex items-center justify-between sticky top-0 z-50 shadow-[0_1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-3">
            <img
              src={logoUrl}
              alt="EchoSmith logo"
              className="h-8 w-8"
            />
            <div>
              <h1 className="text-base font-semibold tracking-tight text-gray-900 dark:text-white">
                闻见 · EchoSmith
              </h1>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                跨平台本地语音转写工作台
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className={`gap-1.5 ${correctionActive ? "ring-1 ring-emerald-500/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
            >
              <SettingsIcon className="h-4 w-4" />
              {correctionActive ? "纠错已开启" : "纠错设置"}
            </Button>
            <ThemeToggle theme={theme} onThemeChange={setTheme} />
          </div>
        </header>

        {/* Main: left panel + right split */}
        <main className="flex-1 grid lg:grid-cols-[380px_1fr] gap-6 p-6 pb-3 min-h-0">
          {/* Left Column: Audio Source + Controls */}
          <section className="flex flex-col gap-3 min-h-0 animate-slide-in-left">
            {/* Tab switcher */}
            <div className="relative flex rounded-xl bg-black/[0.04] dark:bg-white/[0.06] p-1">
              <div
                className="absolute top-1 bottom-1 rounded-lg bg-white dark:bg-zinc-800 shadow-sm transition-transform duration-200 ease-out"
                style={{
                  width: "calc(50% - 4px)",
                  transform: leftTab === "batch" ? "translateX(0)" : "translateX(calc(100% + 8px))",
                }}
              />
              {([
                { key: "batch" as LeftTab, label: "批量转写" },
                { key: "url" as LeftTab, label: "在线视频" },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setLeftTab(key)}
                  className={`relative z-10 flex-1 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors duration-200 ${
                    leftTab === key
                      ? "text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Audio composer (shrunk) */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {leftTab === "batch" ? <BatchTaskComposer /> : <UrlTaskComposer />}
            </div>

          </section>

          {/* Right Column: ASR Results (top) + Correction Results (bottom) */}
          <section className="flex flex-col gap-4 min-h-0 animate-slide-in-right">
            {/* ASR Results */}
            <ResultPanel />

            {/* Correction Results */}
            <CorrectionPanel />

            {/* Export buttons */}
          </section>
        </main>

        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
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
