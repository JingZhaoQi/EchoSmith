import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskView } from "./TaskView";
import { exportBaseName } from "../lib/constants";
import { exportTask, saveExport } from "../lib/api";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  exportTask: vi.fn(() => Promise.resolve(new Blob(["x"]))),
  saveExport: vi.fn(() => Promise.resolve(true)),
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

  it("offers SRT only once the task has finished", () => {
    const { rerender } = render(<TaskView task={makeTask("t", "paused", { raw_text: "原文" })} />);
    expect(screen.getByRole("button", { name: /SRT/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /TXT/ })).toBeEnabled();
    rerender(<TaskView task={makeTask("t", "completed", { raw_text: "原文" })} />);
    expect(screen.getByRole("button", { name: /SRT/ })).toBeEnabled();
  });

  it("exports Markdown through the save dialog with the source name", async () => {
    const user = userEvent.setup();
    render(<TaskView task={makeTask("t", "completed", { raw_text: "原文", source: { name: "约13-21-38-1.m4a", type: "local" } })} />);
    await user.click(screen.getByRole("button", { name: /Markdown/ }));
    await waitFor(() => expect(saveExport).toHaveBeenCalledWith(expect.any(Blob), "约13-21-38-1.md"));
    expect(exportTask).toHaveBeenCalledWith("t", "md");
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
