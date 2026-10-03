import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelTask, createTaskFromPath } from "../lib/api";
import { useBatchStore } from "./useBatchStore";
import { useTasksStore } from "./useTasksStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  createTaskFromPath: vi.fn(),
  cancelTask: vi.fn(() => Promise.resolve()),
}));

let created = 0;
const finish = (id: string, status: "completed" | "failed" | "cancelled") =>
  useTasksStore.getState().upsertTask(makeTask(id, status, { created_at: Date.now() / 1000 }));
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await tick();
};

describe("batch queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    created = 0;
    vi.mocked(createTaskFromPath).mockImplementation(async () => `task${++created}`);
    useTasksStore.setState({ tasks: {}, activeTaskId: null });
    useBatchStore.setState({ items: [], running: false });
  });

  it("accepts media files only and ignores duplicates", () => {
    const { addFiles } = useBatchStore.getState();
    expect(addFiles([{ name: "a.m4a", path: "/x/a.m4a" }, { name: "b.pdf", path: "/x/b.pdf" }])).toBe(1);
    expect(addFiles([{ name: "a.m4a", path: "/x/a.m4a" }])).toBe(0);
    expect(addFiles([{ name: "C.MP3", path: "/x/C.MP3" }])).toBe(1);
  });

  it("runs files one at a time and follows the running task", async () => {
    const store = useBatchStore.getState();
    store.addFiles([{ name: "a.m4a", path: "/x/a.m4a" }, { name: "b.m4a", path: "/x/b.m4a" }]);
    store.start();
    await until(() => created === 1);
    expect(useTasksStore.getState().activeTaskId).toBe("task1");
    expect(created).toBe(1); // second file waits

    finish("task1", "completed");
    await until(() => created === 2);
    expect(useTasksStore.getState().activeTaskId).toBe("task2");

    finish("task2", "failed");
    await until(() => !useBatchStore.getState().running);
    expect(useBatchStore.getState().items.map((i) => i.status)).toEqual(["completed", "failed"]);
  });

  it("does not steal focus from a task the user opened", async () => {
    useTasksStore.setState({ activeTaskId: "other", tasks: { other: makeTask("other", "completed", { created_at: Date.now() / 1000 }) } });
    useBatchStore.getState().addFiles([{ name: "a.m4a", path: "/x/a.m4a" }]);
    useBatchStore.getState().start();
    await until(() => created === 1);
    expect(useTasksStore.getState().activeTaskId).toBe("other");
  });

  it("stop cancels the running task and leaves the rest pending", async () => {
    const store = useBatchStore.getState();
    store.addFiles([{ name: "a.m4a", path: "/x/a.m4a" }, { name: "b.m4a", path: "/x/b.m4a" }]);
    store.start();
    await until(() => created === 1);
    useBatchStore.getState().stop();
    expect(cancelTask).toHaveBeenCalledWith("task1");
    finish("task1", "cancelled");
    await until(() => useBatchStore.getState().items[0].status === "cancelled");
    expect(useBatchStore.getState().items.map((i) => i.status)).toEqual(["cancelled", "pending"]);
    expect(created).toBe(1);
  });

  it("removing the processing file cancels its task", async () => {
    const store = useBatchStore.getState();
    store.addFiles([{ name: "a.m4a", path: "/x/a.m4a" }, { name: "b.m4a", path: "/x/b.m4a" }]);
    store.start();
    await until(() => created === 1);
    const first = useBatchStore.getState().items[0];
    useBatchStore.getState().removeItem(first.id);
    expect(cancelTask).toHaveBeenCalledWith("task1");
    finish("task1", "cancelled");
    await until(() => created === 2); // continues with the next file
    expect(useBatchStore.getState().items).toHaveLength(1);
  });

});
