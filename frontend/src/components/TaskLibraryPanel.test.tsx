import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskLibraryPanel } from "./TaskLibraryPanel";
import type { TaskSnapshot } from "../lib/api";
import { cancelTask, pauseTask, resumeTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(() => Promise.resolve()),
  pauseTask: vi.fn(() => Promise.resolve()),
  resumeTask: vi.fn(() => Promise.resolve()),
}));

const makeTask = (
  id: string,
  status: TaskSnapshot["status"],
  createdAt = 0
): TaskSnapshot => ({
  id,
  status,
  progress: status === "completed" ? 1 : 0.4,
  message: status,
  result_text: "",
  segments: [],
  source: { name: `${id}.m4a` },
  error: null,
  logs: [],
  created_at: createdAt,
  updated_at: createdAt,
});

function renderPanel(tasks: TaskSnapshot[], activeTaskId: string | null = null) {
  useTasksStore.setState({
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    activeTaskId,
    userClearedAll: false,
  });
  return render(<TaskLibraryPanel />);
}

describe("TaskLibraryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
  });

  it("shows empty state when there are no tasks", () => {
    renderPanel([]);

    expect(screen.getByText(/还没有任务/)).toBeInTheDocument();
  });

  it("lists tasks newest first with status counts", () => {
    renderPanel([
      makeTask("older", "completed", 100),
      makeTask("newer", "running", 200),
      makeTask("broken", "failed", 150),
    ]);

    const rows = screen.getAllByRole("button", { name: /\.m4a/ });
    expect(rows[0]).toHaveTextContent("newer.m4a");
    expect(rows[1]).toHaveTextContent("broken.m4a");
    expect(rows[2]).toHaveTextContent("older.m4a");

    expect(screen.getByText("进行中 1")).toBeInTheDocument();
    expect(screen.getByText("完成 1")).toBeInTheDocument();
    expect(screen.getByText("失败/取消 1")).toBeInTheDocument();
  });

  it("selects a task on click", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("task-a", "completed", 100)]);

    await user.click(screen.getByRole("button", { name: /task-a\.m4a/ }));

    expect(useTasksStore.getState().activeTaskId).toBe("task-a");
  });

  it("row pause button pauses a running task without selecting it", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("running", "running")]);

    await user.click(screen.getByRole("button", { name: "暂停" }));

    await waitFor(() => expect(pauseTask).toHaveBeenCalledWith("running"));
    expect(useTasksStore.getState().activeTaskId).toBeNull();
  });

  it("row continue button resumes a paused task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("paused", "paused")]);

    await user.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => expect(resumeTask).toHaveBeenCalledWith("paused"));
  });

  it("row remove button cancels and removes only that task", async () => {
    const user = userEvent.setup();
    renderPanel([makeTask("running", "running"), makeTask("done", "completed")], "running");

    const runningRow = screen.getByRole("button", { name: /running\.m4a/ });
    await user.click(within(runningRow).getByRole("button", { name: "移除" }));

    await waitFor(() => expect(cancelTask).toHaveBeenCalledWith("running"));
    expect(cancelTask).not.toHaveBeenCalledWith("done");
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

  it("completed task hides pause, disables stop all, keeps clear and remove available", () => {
    renderPanel([makeTask("done", "completed")], "done");

    expect(screen.queryByRole("button", { name: "暂停" })).toBeNull();
    expect(screen.queryByRole("button", { name: "继续" })).toBeNull();
    expect(screen.getByRole("button", { name: "全部停止" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "移除" })).toBeEnabled();
  });
});
