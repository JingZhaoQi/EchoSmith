// Enhanced version of App.tsx with modern UI improvements
import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useTheme } from "../hooks/useTheme";
import { BatchTaskComposer } from "../components/BatchTaskComposer";
import { TaskStreamPanel } from "../components/TaskStreamPanel";
import { ResultPanel } from "../components/ResultPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { ensureBackendBase, fetchHealth, listTasks } from "../lib/api";
import { useBackendStatus } from "../lib/backendStatus";
import { useTasksStore } from "../hooks/useTasksStore";
import { useTaskSubscription } from "../hooks/useTaskSubscription";
import { AuroraBackground } from "../components/ui/aurora-background";

const queryClient = new QueryClient();

const logoUrl = new URL('../../echo_logo.svg', import.meta.url).href;

function AppShell(): JSX.Element {
  const [theme, setTheme] = useTheme();
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const setTasks = useTasksStore((state) => state.setTasks);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);
  const backendStatus = useBackendStatus();

  const {
    data: health,
    isLoading: isHealthLoading,
    isError: isHealthError
  } = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 30_000 });
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

  const healthStatusText = (() => {
    if (isHealthLoading) {
      return "后端检测中…";
    }
    if (isHealthError) {
      return "后端不可用";
    }
    if (health?.status === "ok") {
      return "后端在线";
    }
    return "后端降级";
  })();

  const healthIndicatorClass = (() => {
    if (isHealthLoading) {
      return "bg-amber-400 animate-pulse";
    }
    if (isHealthError || health?.status !== "ok") {
      return "bg-red-500";
    }
    return "bg-emerald-500";
  })();

  const backendStatusLabel = (() => {
    if (backendStatus.status === "ready") {
      return null;
    }
    if (backendStatus.status === "error") {
      return backendStatus.message ?? "后端认证失败";
    }
    if (backendStatus.status === "initializing") {
      return backendStatus.message ?? "后端启动中…";
    }
    return null;
  })();

  return (
    <AuroraBackground className="min-h-screen">
      <div className="min-h-screen flex flex-col backdrop-blur-[2px]">
        {/* macOS-style Header */}
        <header className="border-b border-black/[0.08] dark:border-white/[0.08] backdrop-blur-2xl backdrop-saturate-150 bg-white/80 dark:bg-zinc-900/80 px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-[0_1px_0_rgba(0,0,0,0.05)] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <img
                src={logoUrl}
                alt="EchoSmith logo"
                className="h-10 w-10 relative transform group-hover:scale-105 transition-transform duration-200"
              />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">
                闻见 · EchoSmith
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                跨平台本地语音转写工作台
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* macOS-style status indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.06]" aria-live="polite">
              <div className="relative">
                <span className={`h-2 w-2 rounded-full ${healthIndicatorClass}`} aria-hidden="true" />
                {/* Only show ping animation when loading or error */}
                {(isHealthLoading || isHealthError || health?.status !== "ok") && (
                  <span className={`absolute inset-0 h-2 w-2 rounded-full ${healthIndicatorClass} animate-ping opacity-75`} aria-hidden="true" />
                )}
              </div>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{healthStatusText}</span>
            </div>

            {backendStatusLabel ? (
              <div className="px-3 py-1.5 rounded-full bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/20 dark:border-amber-400/20 text-xs font-medium text-amber-700 dark:text-amber-300" aria-live="polite">
                {backendStatusLabel}
              </div>
            ) : null}

            <ThemeToggle theme={theme} onThemeChange={setTheme} />
          </div>
        </header>

        {/* Enhanced Main Content */}
        <main className="flex-1 grid lg:grid-cols-[440px_1fr] gap-8 p-8">
          <section className="space-y-6 animate-slide-in-left">
            <BatchTaskComposer />
          </section>
          <section className="space-y-6 animate-slide-in-right">
            <TaskStreamPanel />
            <ResultPanel />
          </section>
        </main>
      </div>

      {/* Additional animations CSS */}
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }

        @keyframes slide-in-left {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slide-in-right {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        .animate-slide-in-left {
          animation: slide-in-left 0.5s ease-out;
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.5s ease-out 0.1s both;
        }
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
