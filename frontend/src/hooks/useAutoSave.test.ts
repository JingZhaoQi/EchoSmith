import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAutoSave } from "./useAutoSave";
import { useSaveStore } from "./useSaveStore";
import { useTasksStore } from "./useTasksStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), isTauri: () => true }));

describe("useAutoSave", () => {
  const saveTask = vi.fn(async () => undefined);
  beforeEach(() => {
    saveTask.mockClear();
    useSaveStore.setState({ saveTask });
    useTasksStore.setState({ tasks: { old: makeTask("old", "completed"), run: makeTask("run", "running") }, activeTaskId: null });
  });

  it("saves tasks that finish while the app is open, once, and never old ones", () => {
    renderHook(() => useAutoSave());
    expect(saveTask).not.toHaveBeenCalled();
    act(() => useTasksStore.getState().upsertTask(makeTask("run", "completed")));
    act(() => useTasksStore.getState().upsertTask(makeTask("run", "completed", { message: "again" })));
    expect(saveTask).toHaveBeenCalledTimes(1);
    expect(saveTask).toHaveBeenCalledWith(expect.objectContaining({ id: "run", status: "completed" }));
  });

  it("does not save cancelled or failed tasks", () => {
    renderHook(() => useAutoSave());
    act(() => useTasksStore.getState().upsertTask(makeTask("run", "cancelled")));
    expect(saveTask).not.toHaveBeenCalled();
  });
});
