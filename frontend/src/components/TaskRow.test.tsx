import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskRow } from "./TaskRow";
import { pauseTask, resumeTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  pauseTask: vi.fn(() => Promise.resolve()),
  resumeTask: vi.fn(() => Promise.resolve()),
}));

describe("TaskRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null, followBatch: true });
  });

  it("clicking a row shows that task and stops following the batch", async () => {
    const user = userEvent.setup();
    render(<ul><TaskRow name="讲道01.m4a" task={makeTask("a", "completed")} onRemove={vi.fn()} /></ul>);
    await user.click(screen.getByText("讲道01.m4a"));
    expect(useTasksStore.getState()).toMatchObject({ activeTaskId: "a", followBatch: false });
    expect(screen.getByText("讲道01.m4a").closest("li")).toHaveAttribute("aria-current", "true");
  });

  it("shows phase progress and pauses / resumes a running task", async () => {
    const user = userEvent.setup();
    const task = makeTask("r", "running", { asr_progress: 0.42 });
    useTasksStore.setState({ tasks: { r: task } });
    const { rerender } = render(<ul><TaskRow name="r.m4a" task={task} onRemove={vi.fn()} /></ul>);
    expect(screen.getByText("转写中 42%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(pauseTask).toHaveBeenCalledWith("r");
    await waitFor(() => expect(useTasksStore.getState().tasks.r.status).toBe("paused"));
    rerender(<ul><TaskRow name="r.m4a" task={useTasksStore.getState().tasks.r} onRemove={vi.fn()} /></ul>);
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(resumeTask).toHaveBeenCalledWith("r");
  });

  it("a waiting file is not selectable; remove does not select", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<ul><TaskRow name="wait.m4a" note="排队中" onRemove={onRemove} /></ul>);
    expect(screen.getByText("wait.m4a").closest("li")).not.toHaveAttribute("role");
    await user.click(screen.getByRole("button", { name: "移除 wait.m4a" }));
    expect(onRemove).toHaveBeenCalled();
    expect(useTasksStore.getState().activeTaskId).toBeNull();
  });
});
