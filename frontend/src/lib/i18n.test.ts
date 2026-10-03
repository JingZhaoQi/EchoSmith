import { describe, expect, it } from "vitest";

import { localizeBackendMessage, useLocaleStore } from "./i18n";

describe("i18n", () => {
  it("translates backend progress messages only in English", () => {
    expect(localizeBackendMessage("转写中 3/10", "zh")).toBe("转写中 3/10");
    expect(localizeBackendMessage("转写中 3/10", "en")).toBe("Transcribing 3/10");
    expect(localizeBackendMessage("智能纠错中 2/5", "en")).toBe("Correcting 2/5");
    expect(localizeBackendMessage("下载完成，提取音频中…", "en")).toBe("Downloaded, extracting audio…");
  });

  it("persists the chosen locale", () => {
    useLocaleStore.getState().setLocale("en");
    expect(useLocaleStore.getState().locale).toBe("en");
    expect(window.localStorage.getItem("echosmith-locale")).toBe("en");
    useLocaleStore.getState().setLocale("zh");
  });
});
