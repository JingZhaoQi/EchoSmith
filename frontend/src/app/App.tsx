// Root application shell for EchoSmith (闻见) desktop UI.
import { useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

import { useTheme } from "../hooks/useTheme";
import { TaskComposer } from "../components/TaskComposer";
import { TaskStreamPanel } from "../components/TaskStreamPanel";
import { ResultPanel } from "../components/ResultPanel";
import { ThemeToggle } from "../components/ThemeToggle";
import { ensureBackendBase, fetchHealth, listTasks } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { useTaskSubscription } from "../hooks/useTaskSubscription";

const queryClient = new QueryClient();

const logoUrl = new URL('../../echo_logo.svg', import.meta.url).href;

function AppShell(): JSX.Element {
  const [theme, setTheme] = useTheme();
  const activeTaskId = useTasksStore((state) => state.activeTaskId);
  const setTasks = useTasksStore((state) => state.setTasks);
  const setActiveTask = useTasksStore((state) => state.setActiveTask);

  const healthQuery = useQuery({ queryKey: ["health"], queryFn: fetchHealth, refetchInterval: 30_000 });
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

  const health = healthQuery.data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-indigo-50/20 dark:to-indigo-950/20 text-foreground flex flex-col">
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/20 blur-lg rounded-full" />
            <img src={logoUrl} alt="EchoSmith logo" className="h-9 w-9 relative" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">闻见 · EchoSmith</h1>
            <p className="text-sm text-muted-foreground/90">跨平台本地语音转写工作台</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>
      </header>
      <main className="flex-1 grid lg:grid-cols-[420px_1fr] gap-6 p-6">
        <section>
          <TaskComposer />
        </section>
        <section className="space-y-6">
          <TaskStreamPanel />
          <ResultPanel />
        </section>
      </main>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
