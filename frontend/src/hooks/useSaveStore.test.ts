import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveTaskFiles } from "../lib/api";
import { useSaveStore } from "./useSaveStore";
import { makeTask } from "../test/fixtures";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  isTauri: () => true,
  saveTaskFiles: vi.fn(async (_id: string, formats: string[], dir: string, base: string) => formats.map((f) => `${dir}/${base}.${f}`)),
}));
vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (p: string) => p.slice(0, p.lastIndexOf("/")),
  downloadDir: async () => "/Users/me/Downloads",
}));

describe("default save formats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useSaveStore.setState({ formats: ["txt"], results: {} });
  });

  it("toggles any combination, keeps at least one lit, and remembers the choice", () => {
    const { toggleFormat } = useSaveStore.getState();
    toggleFormat("txt"); // last one: refused
    expect(useSaveStore.getState().formats).toEqual(["txt"]);
    toggleFormat("md");
    toggleFormat("srt");
    expect(useSaveStore.getState().formats).toEqual(["txt", "srt", "md"]);
    toggleFormat("txt");
    expect(JSON.parse(window.localStorage.getItem("echosmith-save-formats") ?? "[]")).toEqual(["srt", "md"]);
  });

  it("saves a local file's transcript next to the source", async () => {
    useSaveStore.setState({ formats: ["txt", "srt", "md"] });
    await useSaveStore.getState().saveTask(makeTask("t", "completed", { source: { type: "local", name: "讲道.m4a", path: "/Volumes/录音/讲道.m4a" } }));
    expect(saveTaskFiles).toHaveBeenCalledWith("t", ["txt", "srt", "md"], "/Volumes/录音", "讲道");
    expect(useSaveStore.getState().results.t.paths).toContain("/Volumes/录音/讲道.srt");
  });

  it("saves online videos to Downloads and skips SRT while a task is unfinished", async () => {
    useSaveStore.setState({ formats: ["txt", "srt"] });
    await useSaveStore.getState().saveTask(makeTask("u", "paused", { source: { type: "url", name: "Talk 1.2" } }));
    expect(saveTaskFiles).toHaveBeenCalledWith("u", ["txt"], "/Users/me/Downloads", "Talk 1.2");
  });

  it("records failures for the task", async () => {
    vi.mocked(saveTaskFiles).mockRejectedValueOnce(new Error("forbidden path"));
    await useSaveStore.getState().saveTask(makeTask("t", "completed", { source: { type: "local", name: "a.m4a", path: "/x/a.m4a" } }));
    expect(useSaveStore.getState().results.t).toEqual({ paths: [], error: "forbidden path" });
  });
});

describe("saving one more format later", () => {
  it("adds the new file to what was saved before", async () => {
    useSaveStore.setState({ formats: ["txt"], results: {} });
    const task = makeTask("t", "completed", { source: { type: "local", name: "a.m4a", path: "/x/a.m4a" } });
    await useSaveStore.getState().saveTask(task);
    await useSaveStore.getState().saveTask(task, ["srt"]);
    expect(saveTaskFiles).toHaveBeenLastCalledWith("t", ["srt"], "/x", "a");
    expect(useSaveStore.getState().results.t.paths).toEqual(["/x/a.txt", "/x/a.srt"]);
  });
});
