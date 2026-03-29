import { useEffect, useState, useCallback } from "react";
import { XIcon, PlusIcon, DownloadIcon, CheckCircleIcon, LoaderIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  fetchSettings,
  updateSettings,
  fetchCorrectionModelStatus,
  triggerCorrectionModelDownload,
  fetchHotwords,
  addHotword,
  removeHotword,
  type CorrectionConfig,
  type CorrectionModelStatus,
} from "../lib/api";

interface SettingsPanelProps {
  onClose: () => void;
}

type CorrectionMode = CorrectionConfig["mode"];
type ApiProvider = CorrectionConfig["api_provider"];

const PROVIDER_DEFAULTS: Record<ApiProvider, { model: string; baseUrl: string }> = {
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  anthropic: { model: "claude-sonnet-4-20250514", baseUrl: "" },
  deepseek: { model: "deepseek-chat", baseUrl: "" },
  custom: { model: "", baseUrl: "" },
};

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  // Correction settings
  const [mode, setMode] = useState<CorrectionMode>("none");
  const [provider, setProvider] = useState<ApiProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  const [apiModel, setApiModel] = useState("gpt-4o-mini");
  const [apiBaseUrl, setApiBaseUrl] = useState("");

  // Local model
  const [modelStatus, setModelStatus] = useState<CorrectionModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Hotwords
  const [words, setWords] = useState<string[]>([]);
  const [hotwordInput, setHotwordInput] = useState("");
  const [hotwordLoading, setHotwordLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  // Load settings on mount
  useEffect(() => {
    fetchSettings()
      .then((s) => {
        const c = s.correction;
        setMode(c.mode);
        setProvider(c.api_provider);
        setApiKey(c.api_key);
        setApiKeySet(c.api_key_set);
        setApiModel(c.api_model);
        setApiBaseUrl(c.api_base_url);
      })
      .catch(console.error);

    fetchCorrectionModelStatus()
      .then(setModelStatus)
      .catch(console.error);

    fetchHotwords().then(setWords).catch(console.error);
  }, []);

  const saveSettings = useCallback(
    async (overrides: Partial<CorrectionConfig> = {}) => {
      setSaving(true);
      try {
        const payload: Partial<CorrectionConfig> = {
          mode,
          api_provider: provider,
          api_model: apiModel,
          api_base_url: apiBaseUrl,
          ...overrides,
        };
        // Only send api_key if user typed a new value
        if (apiKey && !apiKey.includes("****")) {
          payload.api_key = apiKey;
        }
        const result = await updateSettings({ correction: payload });
        const c = result.correction;
        setMode(c.mode);
        setApiKeySet(c.api_key_set);
        setApiKey(c.api_key);
      } catch (err) {
        console.error("保存设置失败:", err);
      } finally {
        setSaving(false);
      }
    },
    [mode, provider, apiKey, apiModel, apiBaseUrl],
  );

  const handleModeChange = (newMode: CorrectionMode) => {
    setMode(newMode);
    saveSettings({ mode: newMode });
  };

  const handleProviderChange = (newProvider: ApiProvider) => {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    setApiModel(defaults.model);
    setApiBaseUrl(defaults.baseUrl);
    saveSettings({
      api_provider: newProvider,
      api_model: defaults.model,
      api_base_url: defaults.baseUrl,
    });
  };

  const handleDownloadModel = async () => {
    setDownloading(true);
    try {
      await triggerCorrectionModelDownload();
      // Poll status
      const poll = setInterval(async () => {
        const status = await fetchCorrectionModelStatus();
        setModelStatus(status);
        if (status.exists) {
          clearInterval(poll);
          setDownloading(false);
        }
      }, 3000);
    } catch (err) {
      console.error("下载模型失败:", err);
      setDownloading(false);
    }
  };

  const handleAddHotword = async () => {
    const word = hotwordInput.trim();
    if (!word) return;
    setHotwordLoading(true);
    try {
      const updated = await addHotword(word);
      setWords(updated);
      setHotwordInput("");
    } catch (err) {
      console.error("添加热词失败:", err);
    } finally {
      setHotwordLoading(false);
    }
  };

  const handleRemoveHotword = async (word: string) => {
    try {
      const updated = await removeHotword(word);
      setWords(updated);
    } catch (err) {
      console.error("删除热词失败:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-y-auto animate-slide-in-right">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            设置
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/[0.06] dark:hover:bg-white/[0.06] transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Section: Correction Mode */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              纠错模式
            </h3>
            <div className="space-y-2">
              {([
                { value: "none" as CorrectionMode, label: "关闭", desc: "不进行纠错" },
                { value: "local_3b" as CorrectionMode, label: "本地 3B 模型", desc: "使用 Qwen2.5-3B 本地推理" },
                { value: "cloud_api" as CorrectionMode, label: "云端 API", desc: "调用 OpenAI / Anthropic / DeepSeek 等" },
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
                    onChange={() => handleModeChange(opt.value)}
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

          {/* Section: Local Model (shown when local_3b) */}
          {mode === "local_3b" && (
            <section className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                本地模型
              </h3>
              {modelStatus?.exists ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircleIcon className="h-4 w-4" />
                  <span>模型已就绪（{modelStatus.size_mb} MB）</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    需要下载 Qwen2.5-3B-Instruct Q4 模型（约 2 GB）
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    disabled={downloading}
                    onClick={handleDownloadModel}
                  >
                    {downloading ? (
                      <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <DownloadIcon className="h-3.5 w-3.5" />
                    )}
                    {downloading ? "下载中…" : "下载模型"}
                  </Button>
                </div>
              )}
            </section>
          )}

          {/* Section: Cloud API (shown when cloud_api) */}
          {mode === "cloud_api" && (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                云端 API 配置
              </h3>

              {/* Provider */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  服务商
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as ApiProvider)}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="custom">自定义</option>
                </select>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={() => saveSettings()}
                  placeholder={apiKeySet ? "已设置（输入新值覆盖）" : "输入 API Key"}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  模型名称
                </label>
                <input
                  type="text"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  onBlur={() => saveSettings()}
                  placeholder="模型名称"
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              {/* Base URL (only for custom) */}
              {provider === "custom" && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    API Base URL
                  </label>
                  <input
                    type="text"
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    onBlur={() => saveSettings()}
                    placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              )}

              {saving && (
                <p className="text-xs text-gray-400 flex items-center gap-1">
                  <LoaderIcon className="h-3 w-3 animate-spin" /> 保存中…
                </p>
              )}
            </section>
          )}

          {/* Section: Hotwords */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              热词表
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              添加专业术语、人名等，纠错时优先使用这些词汇
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                className="flex-1 rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                placeholder="输入热词…"
                value={hotwordInput}
                onChange={(e) => setHotwordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddHotword();
                  }
                }}
                disabled={hotwordLoading}
              />
              <Button
                variant="secondary"
                size="sm"
                className="gap-1"
                disabled={!hotwordInput.trim() || hotwordLoading}
                onClick={handleAddHotword}
              >
                <PlusIcon className="h-3.5 w-3.5" />
                添加
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {words.map((word) => (
                <span
                  key={word}
                  className="inline-flex items-center gap-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] px-2.5 py-0.5 text-xs"
                >
                  {word}
                  <button
                    className="ml-0.5 rounded-full p-0.5 hover:bg-red-500/20 transition-colors"
                    onClick={() => handleRemoveHotword(word)}
                  >
                    <XIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {words.length === 0 && (
                <span className="text-xs text-gray-400">暂无热词</span>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
