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
    render(<TaskView correctionOn correctionActive task={makeTask("t", "completed", { correction_enabled: true, raw_text: "于月结以前", result_text: "逾越节以前", correction_progress: 1 })} />);
    expect(screen.getByText("于月结以前")).toBeInTheDocument();
    expect(screen.getByText("逾越节以前")).toBeInTheDocument();
    expect(screen.getByText("智能纠错完成")).toBeInTheDocument();
  });

  it("uses the task's own correction flag, not the global setting", () => {
    render(<TaskView correctionOn correctionActive task={makeTask("t", "completed", { correction_enabled: false, raw_text: "原文", result_text: "原文" })} />);
    expect(screen.getByText(/此任务未开启智能纠错/)).toBeInTheDocument();
    expect(screen.getAllByText("原文")).toHaveLength(1);
  });

  it("streams: corrected status follows correction progress while transcribing", () => {
    render(
      <TaskView
        correctionOn
        correctionActive
        task={makeTask("t", "running", { correction_enabled: true, raw_text: "原文……", result_text: "纠错前缀", asr_progress: 0.6, correction_progress: 0.3 })}
      />
    );
    expect(screen.getByText("智能纠错中 30%")).toBeInTheDocument();
    expect(screen.getByText("纠错前缀")).toBeInTheDocument();
  });

  it("format buttons are lit/unlit default-save toggles", async () => {
    const user = userEvent.setup();
    useSaveStore.setState({ formats: ["txt"], results: {} });
    render(<TaskView correctionOn correctionActive task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.getByRole("button", { name: /TXT/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Markdown/ })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /Markdown/ }));
    await user.click(screen.getByRole("button", { name: /SRT/ }));
    expect(useSaveStore.getState().formats).toEqual(["txt", "srt", "md"]);
    expect(saveTaskFiles).not.toHaveBeenCalled(); // toggling never saves by itself
  });

  it("lighting a format saves just that format for a finished task, not for a running one", async () => {
    const user = userEvent.setup();
    const saveTask = vi.fn(async () => undefined);
    useSaveStore.setState({ formats: ["txt"], results: {}, saveTask });
    const done = makeTask("t", "completed", { raw_text: "原文" });
    const { rerender } = render(<TaskView correctionOn correctionActive task={makeTask("t", "running", { raw_text: "原文" })} />);
    await user.click(screen.getByRole("button", { name: /Markdown/ }));
    expect(saveTask).not.toHaveBeenCalled(); // it will be saved when it finishes
    rerender(<TaskView correctionOn correctionActive task={done} />);
    await user.click(screen.getByRole("button", { name: /SRT/ }));
    expect(saveTask).toHaveBeenCalledWith(done, ["srt"]);
    await user.click(screen.getByRole("button", { name: /SRT/ })); // turning off saves nothing
    expect(saveTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^保存$/ })).not.toBeInTheDocument();
  });

  it("shows where the files were saved", () => {
    useSaveStore.setState({ formats: ["txt"], results: { t: { paths: ["/x/讲道.txt", "/x/讲道.md"] } } });
    render(<TaskView correctionOn correctionActive task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.getByText("已保存：讲道.txt, 讲道.md")).toBeInTheDocument();
  });

  it("warns when some correction batches fell back to raw text", () => {
    render(<TaskView correctionOn correctionActive task={makeTask("t", "completed", { correction_enabled: true, correction_failed_batches: 2, result_text: "x" })} />);
    expect(screen.getByText("2 批纠错失败，已保留原文")).toBeInTheDocument();
  });
});

describe("TaskView without a task", () => {
  it("still offers the default-save toggles and explains what to do", () => {
    useSaveStore.setState({ formats: ["txt"], results: {} });
    render(<TaskView correctionOn={false} correctionActive={false} />);
    expect(screen.getAllByText(/在左侧添加文件或粘贴链接开始转写/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /TXT/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("智能纠错结果")).not.toBeInTheDocument(); // correction mode is off
  });
});

describe("correction panel follows the correction mode", () => {
  it("is hidden when correction is off: ASR fills the space, no divider, no close button", () => {
    render(<TaskView correctionOn={false} correctionActive={false} task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.queryByText("智能纠错结果")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /智能纠错栏/ })).not.toBeInTheDocument();
  });

  it("is shown when correction is on, without a close button, even before the API key is set", () => {
    render(<TaskView correctionOn correctionActive={false} task={makeTask("t", "running", { raw_text: "原文" })} />);
    expect(screen.getByText("智能纠错结果")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /智能纠错栏/ })).not.toBeInTheDocument();
  });
});

describe("exportBaseName", () => {
  it("keeps video titles whole and strips file extensions", () => {
    expect(exportBaseName(makeTask("t", "completed", { source: { type: "url", name: "Dr. Smith: talk 1.2" } }))).toBe("Dr. Smith  talk 1.2");
    expect(exportBaseName(makeTask("t", "completed", { source: { type: "local", name: "/a/b/讲道.v2.m4a" } }))).toBe("讲道.v2");
  });
});
