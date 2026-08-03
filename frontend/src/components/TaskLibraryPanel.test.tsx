import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskLibraryPanel } from "./TaskLibraryPanel";
import type { TaskSnapshot } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

const makeTask = (
  id: string,
  status: TaskSnapshot["status"],
  createdAt: number
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

describe("TaskLibraryPanel", () => {
  beforeEach(() => {
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
  });

  it("shows empty state when there are no tasks", () => {
    useTasksStore.setState({ tasks: {}, activeTaskId: null });
    render(<TaskLibraryPanel />);

    expect(screen.getByText(/还没有任务/)).toBeInTheDocument();
  });

  it("lists tasks newest first with status counts", () => {
    const tasks = [
      makeTask("older", "completed", 100),
      makeTask("newer", "running", 200),
      makeTask("broken", "failed", 150),
    ];
    useTasksStore.setState({
      tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
      activeTaskId: null,
    });

    render(<TaskLibraryPanel />);

    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toHaveTextContent("newer.m4a");
    expect(buttons[1]).toHaveTextContent("broken.m4a");
    expect(buttons[2]).toHaveTextContent("older.m4a");

    expect(screen.getByText("进行中 1")).toBeInTheDocument();
    expect(screen.getByText("完成 1")).toBeInTheDocument();
    expect(screen.getByText("失败/取消 1")).toBeInTheDocument();
  });

  it("selects a task on click", async () => {
    const user = userEvent.setup();
    const task = makeTask("task-a", "completed", 100);
    useTasksStore.setState({ tasks: { "task-a": task }, activeTaskId: null });

    render(<TaskLibraryPanel />);

    await user.click(screen.getByRole("button", { name: /task-a\.m4a/ }));

    expect(useTasksStore.getState().activeTaskId).toBe("task-a");
  });
});
