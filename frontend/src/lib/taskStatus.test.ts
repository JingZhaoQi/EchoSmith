import { describe, expect, it } from "vitest";

import type { TaskSummary } from "./api";
import { getMessages } from "./i18n";
import { taskStatusLabel } from "./taskStatus";

const base: TaskSummary = {
  id: "t", status: "running", progress: 0.4, message: "转写中 3/9", phase: "transcribing", asr_progress: 0.42,
  correction_enabled: true, correction_progress: 0.1, correction_failed_batches: 0, source: {}, created_at: 0, updated_at: 0,
};

describe("taskStatusLabel", () => {
  const t = getMessages();
  it("uses phase-specific progress, not the overall bar", () => {
    expect(taskStatusLabel(base, t, "zh")).toBe("转写中 42%");
    expect(taskStatusLabel({ ...base, phase: "correcting", correction_progress: 0.75 }, t, "zh")).toBe("智能纠错中 75%");
  });
  it("shows the downloader's message while downloading, localized", () => {
    expect(taskStatusLabel({ ...base, phase: "downloading", message: "下载中 45%" }, t, "en")).toBe("Downloading 45%");
  });
  it("falls back to the status name when not running", () => {
    expect(taskStatusLabel({ ...base, status: "paused" }, t, "zh")).toBe("暂停中");
  });
});
