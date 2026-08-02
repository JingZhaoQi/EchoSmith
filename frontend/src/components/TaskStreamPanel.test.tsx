import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskStreamPanel } from "./TaskStreamPanel";
import type { TaskSnapshot } from "../lib/api";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(() => Promise.resolve()),
  pauseTask: vi.fn(() => Promise.resolve()),
  resumeTask: vi.fn(() => Promise.resolve()),
}));

const makeTask = (id: string, status: TaskSnapshot["status"]): TaskSnapshot => ({
  id,
  status,
  progress: status === "completed" ? 1 : 0.45,
  message: status,
  result_text: status === "completed" ? "完成文本" : "",
  segments: [],
  source: { name: `${id}.m4a` },
  error: null,
  logs: [],
  created_at: 0,
  updated_at: 0,
});

function renderPanel(tasks: TaskSnapshot[], activeTaskId: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  useTasksStore.setState({
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    activeTaskId,
    userClearedAll: false,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TaskStreamPanel />
    </QueryClientProvider>
  );
}

describe("TaskStreamPanel buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
  });

  it("pause button pauses the active running task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("running", "running")], "running");

    await user.click(screen.getByRole("button", { name: "暂停" }));

    await waitFor(() => expect(pauseTask).toHaveBeenCalledWith("running"));
  });

  it("continue button resumes the active paused task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("paused", "paused")], "paused");

    await user.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => expect(resumeTask).toHaveBeenCalledWith("paused"));
  });

  it("skip button cancels and removes only the active non-terminal task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("running", "running"), makeTask("done", "completed")], "running");

    await user.click(screen.getByRole("button", { name: "跳过" }));

    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith("running"));
    expect(useTasksStore.getState().tasks.done).toBeDefined();
    expect(useTasksStore.getState().tasks.running).toBeUndefined();
    expect(useTasksStore.getState().activeTaskId).toBeNull();
  });

  it("stop all cancels unfinished tasks without clearing completed results", async () => {
    const user = userEvent.setup();
    renderPanel(
      [
        makeTask("queued", "queued"),
        makeTask("running", "running"),
        makeTask("paused", "paused"),
        makeTask("done", "completed"),
      ],
      "running"
    );

    await user.click(screen.getByRole("button", { name: "全部停止" }));

    await waitFor(() => expect(cancelTask).toHaveBeenCalledTimes(3));
    expect(cancelTask).toHaveBeenCalledWith("queued");
    expect(cancelTask).toHaveBeenCalledWith("running");
    expect(cancelTask).toHaveBeenCalledWith("paused");
    expect(cancelTask).not.toHaveBeenCalledWith("done");
    expect(useTasksStore.getState().tasks.done).toBeDefined();
  });

  it("clear deletes every task from the backend and clears the panel immediately", async () => {
    const user = userEvent.setup();
    const clearListener = vi.fn();
    window.addEventListener("clearAllFiles", clearListener);
    renderPanel([makeTask("running", "running"), makeTask("done", "completed")], "running");

    await user.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith("running"));
    expect(cancelTask).toHaveBeenCalledWith("done");
    expect(clearListener).toHaveBeenCalledTimes(1);
    expect(useTasksStore.getState().tasks).toEqual({});
    expect(useTasksStore.getState().activeTaskId).toBeNull();

    window.removeEventListener("clearAllFiles", clearListener);
  });

  it("terminal completed task disables pause, continue, skip, and stop while keeping clear available", () => {
    renderPanel([makeTask("done", "completed")], "done");

    expect(screen.getByRole("button", { name: "暂停" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "全部停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空" })).toBeEnabled();
  });
});
