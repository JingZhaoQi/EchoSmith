import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { RawTranscriptPanel } from "./RawTranscriptPanel";
import type { TaskSnapshot } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

const makeTask = (overrides: Partial<TaskSnapshot>): TaskSnapshot => ({
  id: "task-1",
  status: "running",
  progress: 0.5,
  message: "转写中 1/2",
  result_text: "",
  raw_text: "",
  segments: [],
  source: { name: "demo.m4a" },
  error: null,
  logs: [],
  created_at: 0,
  updated_at: 0,
  ...overrides,
});

function renderWithTask(task?: TaskSnapshot) {
  useTasksStore.setState({
    tasks: task ? { [task.id]: task } : {},
    activeTaskId: task ? task.id : null,
    userClearedAll: false,
  });
  return render(<RawTranscriptPanel />);
}

describe("RawTranscriptPanel", () => {
  beforeEach(() => {
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
  });

  it("shows empty hint when no task is selected", () => {
    renderWithTask();

    expect(screen.getByText(/从任务库选择任务/)).toBeInTheDocument();
  });

  it("displays raw_text of the active task", () => {
    renderWithTask(makeTask({ raw_text: "未纠错的原文" }));

    expect(screen.getByText("未纠错的原文")).toBeInTheDocument();
  });

  it("falls back to result_text when raw_text is absent", () => {
    const task = makeTask({ status: "completed", progress: 1, result_text: "旧任务文本" });
    delete task.raw_text;
    renderWithTask(task);

    expect(screen.getByText("旧任务文本")).toBeInTheDocument();
  });

  it("shows error details for failed tasks", () => {
    renderWithTask(makeTask({ status: "failed", error: "ffmpeg 转换失败" }));

    expect(screen.getByText("识别失败")).toBeInTheDocument();
    expect(screen.getByText("ffmpeg 转换失败")).toBeInTheDocument();
  });
});
