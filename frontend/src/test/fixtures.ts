import type { TaskSnapshot } from "../lib/api";

export const makeTask = (id: string, status: TaskSnapshot["status"], overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  id,
  status,
  progress: status === "completed" ? 1 : 0.4,
  message: "",
  phase: status === "completed" ? "done" : status === "queued" ? "queued" : "transcribing",
  asr_progress: status === "completed" ? 1 : 0.4,
  correction_enabled: false,
  correction_progress: 0,
  correction_failed_batches: 0,
  source: { name: `${id}.m4a`, type: "local" },
  error: null,
  created_at: 0,
  updated_at: 0,
  ...overrides,
});
