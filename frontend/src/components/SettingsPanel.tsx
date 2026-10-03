// Settings drawer: every change is saved right away (text fields after a short pause or on leaving the field).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  XIcon,
  LoaderIcon,
  RotateCcwIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from "lucide-react";

import { HotwordEditor } from "./HotwordEditor";
import {
  fetchSettings,
  updateSettings,
  resetApiUsage,
  errorMessage,
  type CorrectionConfig,
  type ApiUsageStats,
} from "../lib/api";
import { useLocaleStore, useT } from "../lib/i18n";

export interface CorrectionState {
  /** correction mode is on (the corrected panel is shown) */
  on: boolean;
  /** on and usable (API key set): new tasks will be corrected */
  ready: boolean;
}

interface SettingsPanelProps {
  onClose: () => void;
  /** called after every save with the correction state the app depends on */
  onSaved?: (correction: CorrectionState) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

type CorrectionMode = "none" | "cloud_api";
type ApiProvider = CorrectionConfig["api_provider"];

const TYPING_SAVE_DELAY_MS = 600;
type SaveState = "idle" | "saving" | "saved";

const PROVIDER_DEFAULTS: Record<ApiProvider, { model: string; baseUrl: string }> = {
  doubao: { model: "doubao-seed-2-0-lite-260215", baseUrl: "" },
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  anthropic: { model: "claude-sonnet-4-20250514", baseUrl: "" },
  deepseek: { model: "deepseek-v4-flash", baseUrl: "" },
  custom: { model: "", baseUrl: "" },
};

export function SettingsPanel({
  onClose,
  onSaved,
  theme,
  onThemeChange,
}: SettingsPanelProps): JSX.Element {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const [mode, setMode] = useState<CorrectionMode>("none");
  const [provider, setProvider] = useState<ApiProvider>("openai");
  const [apiKey, setApiKey] = useState(""); // only what the user types; the saved key never enters the input
  const [maskedKey, setMaskedKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiModel, setApiModel] = useState("gpt-4o-mini");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [usage, setUsage] = useState<ApiUsageStats>({ total_calls: 0, total_segments: 0, failed_calls: 0 });
  const pending = useRef<Partial<CorrectionConfig>>({}); // typed edits not yet saved
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        const c = s.correction;
        setMode(c.mode);
        setProvider(c.api_provider);
        setMaskedKey(c.api_key);
        setApiKeySet(c.api_key_set);
        setApiModel(c.api_model);
        setApiBaseUrl(c.api_base_url);
        setUsage(s.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
      })
      .catch((e) => setError(errorMessage(e)));

    return () => {
      clearTimeout(typingTimer.current);
      clearTimeout(savedTimer.current);
    };
  }, []);

  /** Send only the changed fields; the server echoes the full settings back. */
  const save = useCallback(
    async (changes: Partial<CorrectionConfig>) => {
      setSaveState("saving");
      setError(null);
      try {
        const result = await updateSettings({ correction: changes });
        const c = result.correction;
        setApiKeySet(c.api_key_set);
        setMaskedKey(c.api_key);
        setUsage(result.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
        onSaved?.({ on: c.mode !== "none", ready: c.mode !== "none" && c.api_key_set });
        setSaveState("saved");
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaveState("idle"), 1500);
      } catch (err) {
        setSaveState("idle");
        setError(errorMessage(err));
      }
    },
    [onSaved]
  );

  /** Save typed edits now (pause in typing, leaving a field, closing the panel). */
  const flush = useCallback(async () => {
    clearTimeout(typingTimer.current);
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length) await save(changes);
  }, [save]);

  const edit = (changes: Partial<CorrectionConfig>, immediate = false) => {
    pending.current = { ...pending.current, ...changes };
    clearTimeout(typingTimer.current);
    if (immediate) void flush();
    else typingTimer.current = setTimeout(() => void flush(), TYPING_SAVE_DELAY_MS);
  };

  const commitKey = () => {
    const key = apiKey.trim();
    if (!key) return;
    setApiKey("");
    edit({ api_key: key }, true);
  };

  const close = useCallback(() => {
    // the key is saved on leaving its field; closing also counts as leaving
    const key = apiKey.trim();
    if (key) pending.current = { ...pending.current, api_key: key };
    void flush().finally(onClose);
  }, [apiKey, flush, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const handleProviderChange = (newProvider: ApiProvider) => {
    // keep a model name the user typed; replace only the previous provider's default
    const model = !apiModel || apiModel === PROVIDER_DEFAULTS[provider].model ? PROVIDER_DEFAULTS[newProvider].model : apiModel;
    const baseUrl = newProvider === "custom" ? apiBaseUrl : "";
    setProvider(newProvider);
    setApiModel(model);
    setApiBaseUrl(baseUrl);
    edit({ api_provider: newProvider, api_model: model, api_base_url: baseUrl }, true);
  };

  const handleResetUsage = async () => {
    try {
      const result = await resetApiUsage();
      setUsage(result.api_usage);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={close} />

      <div role="dialog" aria-modal="true" aria-label={t.settings} className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t.settings}</h2>
            <span aria-live="polite" className="flex items-center gap-1 text-xs">
              {saveState === "saving" && (
                <span className="flex items-center gap-1 text-gray-400">
                  <LoaderIcon className="h-3 w-3 animate-spin" />
                  {t.saving}
                </span>
              )}
              {saveState === "saved" && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <CheckIcon className="h-3 w-3" />
                  {t.saved}
                </span>
              )}
              {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
            </span>
          </div>
          <button
            onClick={close}
            aria-label={t.close}
            title={t.close}
            className="p-1.5 rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Status bar */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
            mode === "cloud_api" && apiKeySet
              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : mode === "cloud_api" && !apiKeySet
                ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-gray-50 dark:bg-white/[0.04] text-gray-500 dark:text-gray-400"
          }`}>
            <div className={`h-2 w-2 rounded-full ${
              mode === "cloud_api" && apiKeySet ? "bg-emerald-500" : mode === "cloud_api" ? "bg-amber-500" : "bg-gray-400"
            }`} />
            {mode === "none" && t.correctionOff}
            {mode === "cloud_api" && apiKeySet && t.correctionOn}
            {mode === "cloud_api" && !apiKeySet && t.needApiKey}
          </div>

          {/* Appearance */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              {t.appearance}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "light" as const, label: t.themeLight, icon: SunIcon },
                { value: "dark" as const, label: t.themeDark, icon: MoonIcon },
                { value: "system" as const, label: t.themeSystem, icon: MonitorIcon },
              ]).map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onThemeChange(value)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-all ${
                    theme === value
                      ? "border-sky-500/50 bg-sky-500/[0.07] text-sky-800 dark:text-sky-200"
                      : "border-black/[0.08] text-gray-700 hover:border-black/[0.15] dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-white/[0.15]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Language */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              {t.language}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "zh" as const, label: "中文" },
                { value: "en" as const, label: "English" },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLocale(value)}
                  className={`flex items-center justify-center rounded-xl border px-3 py-2 text-sm transition-all ${
                    locale === value
                      ? "border-sky-500/50 bg-sky-500/[0.07] text-sky-800 dark:text-sky-200"
                      : "border-black/[0.08] text-gray-700 hover:border-black/[0.15] dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-white/[0.15]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Correction Mode */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              {t.correctionMode}
            </h3>
            <div className="space-y-2">
              {([
                { value: "none" as CorrectionMode, label: t.modeNone, desc: t.modeNoneDesc },
                { value: "cloud_api" as CorrectionMode, label: t.modeCloud, desc: t.modeCloudDesc },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                    mode === opt.value
                      ? "border-indigo-500/50 bg-indigo-500/[0.05] dark:bg-indigo-500/[0.08]"
                      : "border-black/[0.08] dark:border-white/[0.08] hover:border-black/[0.15] dark:hover:border-white/[0.15]"
                  }`}
                >
                  <input
                    type="radio"
                    name="correction-mode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => {
                      setMode(opt.value);
                      edit({ mode: opt.value }, true);
                    }}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* Cloud API Config */}
          {mode === "cloud_api" && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t.cloudConfig}
              </h3>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t.provider}
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as ApiProvider)}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                >
                  <option value="doubao">{t.providerDoubao}</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="custom">{t.providerCustom}</option>
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="api-key" className="block text-xs font-medium text-gray-600 dark:text-gray-400">
                    API Key
                  </label>
                  {apiKeySet && (
                    <button
                      type="button"
                      onClick={() => {
                        setApiKey("");
                        edit({ api_key: "" }, true);
                      }}
                      className="text-xs text-gray-500 underline-offset-2 hover:text-red-600 hover:underline"
                    >
                      {t.clearKey}
                    </button>
                  )}
                </div>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={commitKey}
                  onKeyDown={(e) => e.key === "Enter" && commitKey()}
                  placeholder={apiKeySet ? `${maskedKey} · ${t.apiKeySetPlaceholder}` : t.apiKeyPlaceholder}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t.modelName}
                </label>
                <input
                  type="text"
                  value={apiModel}
                  onChange={(e) => {
                    setApiModel(e.target.value);
                    edit({ api_model: e.target.value });
                  }}
                  onBlur={() => void flush()}
                  placeholder={t.modelName}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              {provider === "custom" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    API Base URL
                  </label>
                  <input
                    type="text"
                    value={apiBaseUrl}
                    onChange={(e) => {
                      setApiBaseUrl(e.target.value);
                      edit({ api_base_url: e.target.value });
                    }}
                    onBlur={() => void flush()}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              )}
            </section>
          )}

          {/* API Usage Stats */}
          {mode === "cloud_api" && (
            <section className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t.apiUsage}
                </h3>
                <button
                  onClick={handleResetUsage}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title={t.resetUsage}
                >
                  <RotateCcwIcon className="h-3 w-3" />
                  {t.reset}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{usage.total_calls}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.totalCalls}</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{usage.total_segments}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.correctedSegments}</div>
                </div>
                <div className="text-center">
                  <div className={`text-lg font-semibold ${usage.failed_calls > 0 ? "text-red-500" : "text-gray-900 dark:text-white"}`}>
                    {usage.failed_calls}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">{t.failedCalls}</div>
                </div>
              </div>
            </section>
          )}

          <HotwordEditor correctionOn={mode !== "none"} />
        </div>
      </div>
    </div>
  );
}
