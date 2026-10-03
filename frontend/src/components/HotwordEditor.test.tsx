import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HotwordEditor } from "./HotwordEditor";
import { addHotword, importHotwords, removeHotword, saveExport, type HotwordList } from "../lib/api";

let list: HotwordList;
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fetchHotwords: vi.fn(async () => list),
  addHotword: vi.fn(async (w: string) => (list = { words: [...list.words, w], in_prompt: list.words.length + 1 })),
  removeHotword: vi.fn(async (w: string) => (list = { words: list.words.filter((x) => x !== w), in_prompt: list.words.length - 1 })),
  importHotwords: vi.fn(async (words: string[]) => (list = { words, in_prompt: words.length })),
  saveExport: vi.fn(async () => true),
}));

const chips = () => within(screen.getByRole("list", { name: "热词表" })).getAllByRole("listitem").map((li) => li.textContent);

describe("HotwordEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list = { words: ["耶稣", "基督", "司布真"], in_prompt: 2 };
  });

  it("shows every word and marks the ones beyond the prompt budget", async () => {
    render(<HotwordEditor correctionOn />);
    await waitFor(() => expect(chips()).toEqual(["耶稣", "基督", "司布真"]));
    expect(screen.getByText("司布真").closest("li")).toHaveAttribute("title", expect.stringContaining("不使用"));
  });

  it("adds a word with Enter and rejects duplicates", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    const input = await screen.findByPlaceholderText("添加热词");
    await user.type(input, "柏溪团契{Enter}");
    expect(addHotword).toHaveBeenCalledWith("柏溪团契");
    await waitFor(() => expect(chips()).toContain("柏溪团契"));
    await user.type(input, "耶稣{Enter}");
    expect(addHotword).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已在热词表中/)).toBeInTheDocument();
  });

  it("deletes a single word", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    await user.click(await screen.findByRole("button", { name: "移除 基督" }));
    expect(removeHotword).toHaveBeenCalledWith("基督");
    await waitFor(() => expect(chips()).toEqual(["耶稣", "司布真"]));
  });

  it("filters by search text", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    await user.type(await screen.findByPlaceholderText("搜索热词"), "司");
    expect(chips()).toEqual(["司布真"]);
  });

  it("clear needs a second click to confirm", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    await user.click(await screen.findByRole("button", { name: "清空" }));
    expect(importHotwords).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认清空？" }));
    expect(importHotwords).toHaveBeenCalledWith([]);
  });

  it("import appends and skips duplicates instead of replacing the list", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    await screen.findByText("耶稣");
    const file = new File(["基督\n景恩堂，约珥\n\n"], "words.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("导入热词文件"), file);
    await waitFor(() => expect(importHotwords).toHaveBeenCalledWith(["耶稣", "基督", "司布真", "景恩堂", "约珥"]));
    expect(await screen.findByText(/新增 2 个/)).toBeInTheDocument();
  });

  it("exports one word per line", async () => {
    const user = userEvent.setup();
    render(<HotwordEditor correctionOn />);
    await user.click(await screen.findByRole("button", { name: "导出" }));
    const [blob, name] = vi.mocked(saveExport).mock.calls[0];
    expect(name).toBe("hotwords.txt");
    expect(await (blob as Blob).text()).toBe("耶稣\n基督\n司布真\n");
  });

  it("warns that hotwords do nothing while correction is off", async () => {
    render(<HotwordEditor correctionOn={false} />);
    expect(await screen.findByText(/热词不会起作用/)).toBeInTheDocument();
  });
});
