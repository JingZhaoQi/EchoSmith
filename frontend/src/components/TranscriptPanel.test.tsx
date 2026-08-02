import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptPanel } from "./TranscriptPanel";
import type { TaskSnapshot } from "../lib/api";
import { exportTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

vi.mock("../lib/api", () => ({
  cancelTask: vi.fn(() => Promise.resolve()),
  exportTask: vi.fn(() => Promise.resolve(new Blob(["exported"], { type: "text/plain" }))),
  pauseTask: vi.fn(() => Promise.resolve()),
  resumeTask: vi.fn(() => Promise.resolve()),
}));

const completedTask: TaskSnapshot = {
  id: "task-1",
  status: "completed",
  progress: 1,
  message: "完成",
  result_text: "这是转写结果",
  segments: [],
  source: { name: "组长-护教学意识.m4a" },
  error: null,
  logs: [],
  created_at: 0,
  updated_at: 0,
};

function renderPanel(task: TaskSnapshot = completedTask) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  useTasksStore.setState({
    tasks: { [task.id]: task },
    activeTaskId: task.id,
    userClearedAll: false,
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TranscriptPanel correctionActive={false} />
    </QueryClientProvider>
  );
}

describe("TranscriptPanel result buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:echosmith-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copy button copies the transcript text and confirms the action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPanel();

    await user.click(screen.getByRole("button", { name: "复制" }));

    expect(writeText).toHaveBeenCalledWith("这是转写结果");
    expect(await screen.findByRole("button", { name: "已复制" })).toBeInTheDocument();
  });

  it.each([
    ["TXT", "txt"],
    ["SRT", "srt"],
    ["JSON", "json"],
  ] as const)("%s export button downloads the requested format", async (label, format) => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(exportTask).toHaveBeenCalledWith("task-1", format));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:echosmith-test");
  });

  it("copy and export buttons are disabled when no active result exists", () => {
    useTasksStore.setState({ tasks: {}, activeTaskId: null, userClearedAll: false });
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <TranscriptPanel correctionActive={false} />
      </QueryClientProvider>
    );

    expect(screen.getByRole("button", { name: "复制" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TXT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "SRT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON" })).toBeDisabled();
  });
});
