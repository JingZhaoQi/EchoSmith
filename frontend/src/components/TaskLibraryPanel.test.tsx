import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskLibraryPanel } from "./TaskLibraryPanel";
import type { TaskSnapshot } from "../lib/api";
import { cancelTask, deleteTask, pauseTask, resumeTask } from "../lib/api";
import { useBatchStore } from "../hooks/useBatchStore";
import { useTasksStore } from "../hooks/useTasksStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  cancelTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  pauseTask: vi.fn(() => Promise.resolve()),
  resumeTask: vi.fn(() => Promise.resolve()),
}));

function renderPanel(tasks: TaskSnapshot[], activeTaskId: string | null = null) {
  useTasksStore.setState({ tasks: Object.fromEntries(tasks.map((task) => [task.id, task])), activeTaskId });
  return render(<TaskLibraryPanel />);
}

const row = (name: string) => screen.getByText(name).closest("[role=button]") as HTMLElement;

describe("TaskLibraryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null });
    useBatchStore.setState({ items: [], running: false });
  });

  it("shows empty state when there are no tasks", () => {
    renderPanel([]);
    expect(screen.getByText(/还没有任务/)).toBeInTheDocument();
  });

  it("lists tasks newest first with counts and phase-specific status", () => {
    renderPanel([
      makeTask("older", "completed", { created_at: 100 }),
      makeTask("newer", "running", { created_at: 200, asr_progress: 0.5 }),
      makeTask("broken", "failed", { created_at: 150 }),
    ]);
    const names = screen.getAllByText(/\.m4a$/).map((el) => el.textContent);
    expect(names).toEqual(["newer.m4a", "broken.m4a", "older.m4a"]);
    expect(screen.getByText("进行中 1")).toBeInTheDocument();
    expect(screen.getByText("完成 1")).toBeInTheDocument();
    expect(screen.getByText("失败/取消 1")).toBeInTheDocument();
    expect(within(row("newer.m4a")).getByText("转写中 50%")).toBeInTheDocument();
  });

  it("selecting a row opens it; New Task returns to the intake view", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("a", "completed")]);
    await user.click(row("a.m4a"));
    expect(useTasksStore.getState().activeTaskId).toBe("a");
    await user.click(screen.getByRole("button", { name: /新建任务/ }));
    expect(useTasksStore.getState().activeTaskId).toBeNull();
  });

  it("pauses and resumes and reflects the new state immediately", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("run", "running")]);
    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(pauseTask).toHaveBeenCalledWith("run");
    await waitFor(() => expect(screen.getByRole("button", { name: "继续" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(resumeTask).toHaveBeenCalledWith("run");
  });

  it("remove deletes the task and drops it from the list", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("run", "running"), makeTask("done", "completed")], "run");
    await user.click(within(row("run.m4a")).getByRole("button", { name: "移除" }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledWith("run"));
    expect(useTasksStore.getState().tasks.run).toBeUndefined();
    expect(useTasksStore.getState().activeTaskId).toBeNull();
    expect(deleteTask).not.toHaveBeenCalledWith("done");
  });

  it("stop all cancels only unfinished tasks and stops the batch queue", async () => {
    const user = userEvent.setup();
    useBatchStore.setState({ running: true });
    renderPanel([makeTask("q", "queued"), makeTask("r", "running"), makeTask("p", "paused"), makeTask("d", "completed")]);
    await user.click(screen.getByRole("button", { name: /全部停止/ }));
    await waitFor(() => expect(cancelTask).toHaveBeenCalledTimes(3));
    expect(cancelTask).not.toHaveBeenCalledWith("d");
    expect(useBatchStore.getState().running).toBe(false);
  });

  it("clear deletes every task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("r", "running"), makeTask("d", "completed")]);
    await user.click(screen.getByRole("button", { name: /清空/ }));
    await waitFor(() => expect(deleteTask).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(Object.keys(useTasksStore.getState().tasks)).toHaveLength(0));
  });
});
