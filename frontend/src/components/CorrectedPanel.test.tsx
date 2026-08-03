import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CorrectedPanel } from "./CorrectedPanel";
import type { TaskSnapshot } from "../lib/api";
import { exportTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

vi.mock("../lib/api", () => ({
  exportTask: vi.fn(() => Promise.resolve(new Blob(["content"]))),
}));

const makeTask = (overrides: Partial<TaskSnapshot>): TaskSnapshot => ({
  id: "task-1",
  status: "completed",
  progress: 1,
  message: "完成",
  result_text: "纠错后的文本",
  raw_text: "原始识别文本",
  segments: [],
  source: { name: "demo.m4a" },
  error: null,
  logs: [],
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

function renderPanel(task: TaskSnapshot | undefined, correctionActive: boolean) {
  useTasksStore.setState({
    tasks: task ? { [task.id]: task } : {},
    activeTaskId: task ? task.id : null,
    userClearedAll: false,
  });
  return render(<CorrectedPanel correctionActive={correctionActive} />);
}

describe("CorrectedPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });

    // jsdom lacks these APIs used by copy/export handlers
    global.URL.createObjectURL = vi.fn(() => "blob:mock");
    global.URL.revokeObjectURL = vi.fn();
  });

  it("shows not-enabled empty state when correction is off", () => {
    renderPanel(makeTask({}), false);

    expect(screen.getByText(/未启用智能纠错/)).toBeInTheDocument();
    expect(screen.queryByText("纠错后的文本")).not.toBeInTheDocument();
  });

  it("shows corrected text when correction is active and task completed", () => {
    renderPanel(makeTask({}), true);

    expect(screen.getByText("纠错后的文本")).toBeInTheDocument();
    expect(screen.getByText("智能纠错完成")).toBeInTheDocument();
  });

  it("shows waiting hint while transcription runs before correction starts", () => {
    renderPanel(
      makeTask({ status: "running", progress: 0.5, message: "转写中 3/10", result_text: "原文" }),
      true
    );

    expect(screen.getByText(/转写进行中，纠错结果会随批次完成逐步显示/)).toBeInTheDocument();
    expect(screen.queryByText("原文")).not.toBeInTheDocument();
  });

  it("copies raw text when correction is off", async () => {
    const user = userEvent.setup();
    renderPanel(makeTask({}), false);

    // userEvent.setup() installs its own clipboard stub; override it after.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole("button", { name: "复制" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("纠错后的文本"));
  });

  it("exports the requested format for completed tasks", async () => {
    const user = userEvent.setup();
    renderPanel(makeTask({}), true);

    await user.click(screen.getByRole("button", { name: "SRT" }));

    await waitFor(() => expect(exportTask).toHaveBeenCalledWith("task-1", "srt"));
  });

  it("disables export when no exportable task exists", () => {
    renderPanel(undefined, true);

    expect(screen.getByRole("button", { name: "TXT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "复制" })).toBeDisabled();
  });
});
