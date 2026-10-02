import { describe, expect, it } from "vitest";

import { getStoppableTaskIds } from "./taskControls";
import type { TaskSnapshot } from "../lib/api";

const task = (id: string, status: TaskSnapshot["status"]): TaskSnapshot => ({
  id,
  status,
  progress: status === "completed" ? 1 : 0.4,
  message: "",
  result_text: "",
  segments: [],
  source: { name: `${id}.m4a` },
  error: null,
  logs: [],
  created_at: 0,
  updated_at: 0,
});

describe("task controls", () => {
  it("stops only non-terminal tasks and keeps completed results out of the stop action", () => {
    const tasks: Record<string, TaskSnapshot> = {
      completed: task("completed", "completed"),
      failed: task("failed", "failed"),
      cancelled: task("cancelled", "cancelled"),
      queued: task("queued", "queued"),
      running: task("running", "running"),
      paused: task("paused", "paused"),
    };

    expect(getStoppableTaskIds(tasks)).toEqual(["queued", "running", "paused"]);
  });
});
