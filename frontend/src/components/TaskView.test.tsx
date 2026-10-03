import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskView } from "./TaskView";
import { exportBaseName } from "../lib/constants";
import { saveTaskFiles } from "../lib/api";
import { useSaveStore } from "../hooks/useSaveStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  saveTaskFiles: vi.fn(() => Promise.resolve([])),
}));

describe("TaskView", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows raw and corrected text side by side for a corrected task", () => {
    render(<TaskView task={makeTask("t", "completed", { correction_enabled: true, raw_text: "于月结以前", result_text: "逾越节以前", correction_progress: 1 })} />);
    expect(screen.getByText("于月结以前")).toBeInTheDocument();
    expect(screen.getByText("逾越节以前")).toBeInTheDocument();
    expect(screen.getByText("智能纠错完成")).toBeInTheDocument();
  });

  it("uses the task's own correction flag, not the global setting", () => {
    render(<TaskView task={makeTask("t", "completed", { correction_enabled: false, raw_text: "原文", result_text: "原文" })} />);
    expect(screen.getByText(/此任务未开启智能纠错/)).toBeInTheDocument();
    expect(screen.getAllByText("原文")).toHaveLength(1);
  });

  it("streams: corrected status follows correction progress while transcribing", () => {
    render(
      <TaskView
        task={makeTask("t", "running", { correction_enabled: true, raw_text: "原文……", result_text: "纠错前缀", asr_progress: 0.6, correction_progress: 0.3 })}
      />
    );
    expect(screen.getByText("智能纠错中 30%")).toBeInTheDocument();
    expect(screen.getByText("纠错前缀")).toBeInTheDocument();
  });

  it("format buttons are lit/unlit default-save toggles", async () => {
    const user = userEvent.setup();
    useSaveStore.setState({ formats: ["txt"], results: {} });
    render(<TaskView task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.getByRole("button", { name: /TXT/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Markdown/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /Markdown/ }));
    await user.click(screen.getByRole("button", { name: /SRT/ }));
    expect(useSaveStore.getState().formats).toEqual(["txt", "srt", "md"]);
    expect(saveTaskFiles).not.toHaveBeenCalled(); // toggling never saves by itself
  });

  it("Save writes the lit formats now, and is unavailable while the task runs", async () => {
    const user = userEvent.setup();
    const saveTask = vi.fn(async () => undefined);
    useSaveStore.setState({ formats: ["txt", "md"], results: {}, saveTask });
    const task = makeTask("t", "completed", { raw_text: "原文" });
    const { rerender } = render(<TaskView task={makeTask("t", "running", { raw_text: "原文" })} />);
    expect(screen.getByRole("button", { name: /^保存$/ })).toBeDisabled();
    rerender(<TaskView task={task} />);
    await user.click(screen.getByRole("button", { name: /^保存$/ }));
    expect(saveTask).toHaveBeenCalledWith(task);
  });

  it("shows where the files were saved", () => {
    useSaveStore.setState({ formats: ["txt"], results: { t: { paths: ["/x/讲道.txt", "/x/讲道.md"] } } });
    render(<TaskView task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.getByText("已保存：讲道.txt, 讲道.md")).toBeInTheDocument();
  });

  it("warns when some correction batches fell back to raw text", () => {
    render(<TaskView task={makeTask("t", "completed", { correction_enabled: true, correction_failed_batches: 2, result_text: "x" })} />);
    expect(screen.getByText("2 批纠错失败，已保留原文")).toBeInTheDocument();
  });
});

describe("exportBaseName", () => {
  it("keeps video titles whole and strips file extensions", () => {
    expect(exportBaseName(makeTask("t", "completed", { source: { type: "url", name: "Dr. Smith: talk 1.2" } }))).toBe("Dr. Smith  talk 1.2");
    expect(exportBaseName(makeTask("t", "completed", { source: { type: "local", name: "/a/b/讲道.v2.m4a" } }))).toBe("讲道.v2");
  });
});
