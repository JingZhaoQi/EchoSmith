import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "./SettingsPanel";
import { fetchHotwords, fetchSettings, updateSettings, type AppSettings } from "../lib/api";

const settings = (correction: Partial<AppSettings["correction"]> = {}): AppSettings => ({
  transcription: { asr_model: "sensevoice-sherpa-2024" },
  correction: { mode: "cloud_api", api_provider: "deepseek", api_key: "sk-****abcd", api_key_set: true, api_model: "deepseek-v4-flash", api_base_url: "", ...correction },
  api_usage: { total_calls: 0, total_segments: 0, failed_calls: 0 },
});

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fetchSettings: vi.fn(async () => settings()),
  fetchHotwords: vi.fn(async () => ({ words: ["弟兄姐妹"], in_prompt: 1 })),
  updateSettings: vi.fn(async (body: { correction?: Partial<AppSettings["correction"]> }) => settings({ ...body.correction, api_key: "sk-****wxyz" })),
}));

const renderPanel = (onClose = vi.fn(), onSaved = vi.fn()) =>
  render(<SettingsPanel onClose={onClose} onSaved={onSaved} theme="system" onThemeChange={vi.fn()} />);

describe("SettingsPanel saves as you go", () => {
  beforeEach(() => vi.clearAllMocks());

  it("has no Save button", async () => {
    renderPanel();
    await screen.findByDisplayValue("deepseek-v4-flash");
    expect(screen.queryByRole("button", { name: /保存设置/ })).not.toBeInTheDocument();
  });

  it("saves a mode change immediately and reports correction state", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderPanel(vi.fn(), onSaved);
    await screen.findByDisplayValue("deepseek-v4-flash");
    await user.click(screen.getByLabelText(/关闭/, { selector: "input" }));
    expect(updateSettings).toHaveBeenCalledWith({ correction: { mode: "none" } });
    await waitFor(() => expect(onSaved).toHaveBeenLastCalledWith(false));
    expect(await screen.findByText("已保存")).toBeInTheDocument();
  });

  it("debounces typing in the model field into one save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPanel();
      const model = await screen.findByDisplayValue("deepseek-v4-flash");
      fireEvent.change(model, { target: { value: "deepseek-v" } });
      fireEvent.change(model, { target: { value: "deepseek-v5" } });
      expect(updateSettings).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(700);
      });
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledWith({ correction: { api_model: "deepseek-v5" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the API key when leaving the field, then shows it masked", async () => {
    const user = userEvent.setup();
    renderPanel();
    const key = await screen.findByLabelText("API Key");
    await user.type(key, "sk-new-key-1234");
    expect(updateSettings).not.toHaveBeenCalled();
    await user.tab();
    expect(updateSettings).toHaveBeenCalledWith({ correction: { api_key: "sk-new-key-1234" } });
    await waitFor(() => expect(key).toHaveValue(""));
    expect(key).toHaveAttribute("placeholder", expect.stringContaining("sk-****wxyz"));
  });

  it("closing the panel saves what was still being typed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderPanel(onClose);
    await user.type(await screen.findByLabelText("API Key"), "sk-typed");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(updateSettings).toHaveBeenCalledWith({ correction: { api_key: "sk-typed" } });
  });

  it("clear key saves right away", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole("button", { name: "清除 Key" }));
    expect(updateSettings).toHaveBeenCalledWith({ correction: { api_key: "" } });
  });

  it("says when hotwords have no effect because correction is off", async () => {
    vi.mocked(fetchSettings).mockResolvedValueOnce(settings({ mode: "none" }));
    renderPanel();
    expect(await screen.findByText(/当前纠错已关闭，热词不会起作用/)).toBeInTheDocument();
  });

  it("warns when only part of the hotword list fits", async () => {
    vi.mocked(fetchHotwords).mockResolvedValueOnce({ words: ["甲", "乙", "丙"], in_prompt: 2 });
    renderPanel();
    expect(await screen.findByText(/只使用前 2 个/)).toBeInTheDocument();
  });
});
