import { useEffect, useState, useCallback } from "react";
import {
  XIcon,
  LoaderIcon,
  UploadIcon,
  FileTextIcon,
  SaveIcon,
  RotateCcwIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from "lucide-react";

import { Button } from "./ui/button";
import {
  fetchSettings,
  updateSettings,
  resetApiUsage,
  fetchHotwords,
  importHotwords,
  errorMessage,
  type CorrectionConfig,
  type ApiUsageStats,
} from "../lib/api";
import { useLocaleStore, useT } from "../lib/i18n";

interface SettingsPanelProps {
  onClose: () => void;
  onSaved?: (active: boolean) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

type CorrectionMode = "none" | "cloud_api";
type ApiProvider = CorrectionConfig["api_provider"];

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
  const [clearKey, setClearKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiModel, setApiModel] = useState("gpt-4o-mini");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [usage, setUsage] = useState<ApiUsageStats>({ total_calls: 0, total_segments: 0, failed_calls: 0 });

  // Load initial state from the server
  const [serverState, setServerState] = useState<{
    mode: CorrectionMode;
    provider: ApiProvider;
    apiModel: string;
    apiBaseUrl: string;
    apiKeySet: boolean;
  } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        const c = s.correction;
        const m = c.mode;
        setMode(m);
        setProvider(c.api_provider);
        setMaskedKey(c.api_key);
        setApiKeySet(c.api_key_set);
        setApiModel(c.api_model);
        setApiBaseUrl(c.api_base_url);
        setUsage(s.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
        setServerState({
          mode: m,
          provider: c.api_provider,
          apiModel: c.api_model,
          apiBaseUrl: c.api_base_url,
          apiKeySet: c.api_key_set,
        });
      })
      .catch((e) => setError(errorMessage(e)));

    fetchHotwords().then(setWords).catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Track dirty state
  useEffect(() => {
    if (!serverState) return;
    const changed =
      mode !== serverState.mode ||
      provider !== serverState.provider ||
      apiModel !== serverState.apiModel ||
      apiBaseUrl !== serverState.apiBaseUrl ||
      apiKey.trim() !== "" ||
      clearKey;
    setDirty(changed);
    if (changed) setSaved(false); // a fresh save also updates serverState; keep its "Saved" note
  }, [mode, provider, apiKey, clearKey, apiModel, apiBaseUrl, serverState]);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<CorrectionConfig> = {
        mode,
        api_provider: provider,
        api_model: apiModel,
        api_base_url: apiBaseUrl,
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      else if (clearKey) payload.api_key = "";
      const result = await updateSettings({
        transcription: {
          asr_model: "sensevoice-sherpa-2024",
        },
        correction: payload,
      });
      const c = result.correction;
      const newMode = c.mode;
      setMode(newMode);
      setApiKeySet(c.api_key_set);
      setMaskedKey(c.api_key);
      setApiKey("");
      setClearKey(false);
      setUsage(result.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
      setServerState({
        mode: newMode,
        provider: c.api_provider,
        apiModel: c.api_model,
        apiBaseUrl: c.api_base_url,
        apiKeySet: c.api_key_set,
      });
      setDirty(false);
      setSaved(true);
      onSaved?.(newMode !== "none" && c.api_key_set);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [mode, provider, apiKey, clearKey, apiModel, apiBaseUrl, onSaved]);

  const handleProviderChange = (newProvider: ApiProvider) => {
    // keep a model name the user typed; replace only the previous provider's default
    if (!apiModel || apiModel === PROVIDER_DEFAULTS[provider].model) setApiModel(PROVIDER_DEFAULTS[newProvider].model);
    if (newProvider !== "custom") setApiBaseUrl("");
    setProvider(newProvider);
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
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      <div role="dialog" aria-modal="true" aria-label={t.settings} className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            {t.settings}
          </h2>
          <button
            onClick={onClose}
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
                    onChange={() => setMode(opt.value)}
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
                  {apiKeySet && !clearKey && (
                    <button type="button" onClick={() => { setClearKey(true); setApiKey(""); }} className="text-xs text-gray-500 underline-offset-2 hover:text-red-600 hover:underline">
                      {t.clearKey}
                    </button>
                  )}
                </div>
                <input
                  id="api-key"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setClearKey(false);
                  }}
                  placeholder={apiKeySet && !clearKey ? `${maskedKey} · ${t.apiKeySetPlaceholder}` : t.apiKeyPlaceholder}
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
                  onChange={(e) => setApiModel(e.target.value)}
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
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              )}
            </section>
          )}

          {/* Save button */}
          <div className="flex items-center gap-3">
            <Button
              variant={dirty ? "default" : "secondary"}
              size="sm"
              className="gap-1.5"
              disabled={saving || !dirty}
              onClick={saveSettings}
            >
              {saving ? (
                <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SaveIcon className="h-3.5 w-3.5" />
              )}
              {saving ? t.saving : t.saveSettings}
            </Button>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{t.saved}</span>
            )}
            {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
            {clearKey && <span className="text-xs text-amber-600 dark:text-amber-400">{t.keyWillBeCleared}</span>}
            {!dirty && !saved && !error && serverState && (
              <span className="text-xs text-gray-400">{t.upToDate}</span>
            )}
          </div>

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

          {/* Hotwords */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              {t.hotwords}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {t.hotwordsDesc}
            </p>
            <div className="flex items-center gap-3 mb-3">
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = ".txt,.csv,.text";
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const newWords = text.split(/[\n\r,，]+/).map(w => w.trim()).filter(Boolean);
                    if (newWords.length === 0) return;
                    try {
                      setWords(await importHotwords(newWords));
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  };
                  input.click();
                }}
              >
                <UploadIcon className="h-3.5 w-3.5" />
                {t.importHotwords}
              </Button>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <FileTextIcon className="h-3.5 w-3.5" />
                <span>{t.hotwordsLoaded(words.length)}</span>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              {t.hotwordsFormatHint}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
