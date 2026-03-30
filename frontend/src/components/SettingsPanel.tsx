import { useEffect, useState, useCallback } from "react";
import { XIcon, LoaderIcon, UploadIcon, FileTextIcon, SaveIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "./ui/button";
import {
  fetchSettings,
  updateSettings,
  resetApiUsage,
  fetchHotwords,
  type CorrectionConfig,
  type ApiUsageStats,
} from "../lib/api";

interface SettingsPanelProps {
  onClose: () => void;
}

type CorrectionMode = "none" | "cloud_api";
type ApiProvider = CorrectionConfig["api_provider"];

const PROVIDER_DEFAULTS: Record<ApiProvider, { model: string; baseUrl: string }> = {
  doubao: { model: "doubao-seed-2-0-lite-260215", baseUrl: "" },
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  anthropic: { model: "claude-sonnet-4-20250514", baseUrl: "" },
  deepseek: { model: "deepseek-chat", baseUrl: "" },
  custom: { model: "", baseUrl: "" },
};

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const [mode, setMode] = useState<CorrectionMode>("none");
  const [provider, setProvider] = useState<ApiProvider>("openai");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
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
        const m = (c.mode === "local_3b" ? "none" : c.mode) as CorrectionMode;
        setMode(m);
        setProvider(c.api_provider);
        setApiKey(c.api_key);
        setApiKeySet(c.api_key_set);
        setApiModel(c.api_model);
        setApiBaseUrl(c.api_base_url);
        setUsage(s.api_usage);
        setServerState({ mode: m, provider: c.api_provider, apiModel: c.api_model, apiBaseUrl: c.api_base_url, apiKeySet: c.api_key_set });
      })
      .catch(console.error);

    fetchHotwords().then(setWords).catch(console.error);
  }, []);

  // Track dirty state
  useEffect(() => {
    if (!serverState) return;
    const keyChanged = Boolean(apiKey) && !apiKey.includes("****");
    const changed =
      mode !== serverState.mode ||
      provider !== serverState.provider ||
      apiModel !== serverState.apiModel ||
      apiBaseUrl !== serverState.apiBaseUrl ||
      keyChanged;
    setDirty(changed);
    setSaved(false);
  }, [mode, provider, apiKey, apiModel, apiBaseUrl, serverState]);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Partial<CorrectionConfig> = {
        mode,
        api_provider: provider,
        api_model: apiModel,
        api_base_url: apiBaseUrl,
      };
      if (apiKey && !apiKey.includes("****")) {
        payload.api_key = apiKey;
      }
      const result = await updateSettings({ correction: payload });
      const c = result.correction;
      const newMode = (c.mode === "local_3b" ? "none" : c.mode) as CorrectionMode;
      setMode(newMode);
      setApiKeySet(c.api_key_set);
      setApiKey(c.api_key);
      setUsage(result.api_usage);
      setServerState({ mode: newMode, provider: c.api_provider, apiModel: c.api_model, apiBaseUrl: c.api_base_url, apiKeySet: c.api_key_set });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("保存设置失败:", err);
    } finally {
      setSaving(false);
    }
  }, [mode, provider, apiKey, apiModel, apiBaseUrl]);

  const handleProviderChange = (newProvider: ApiProvider) => {
    setProvider(newProvider);
    const defaults = PROVIDER_DEFAULTS[newProvider];
    setApiModel(defaults.model);
    setApiBaseUrl(defaults.baseUrl);
  };

  const handleResetUsage = async () => {
    try {
      const result = await resetApiUsage();
      setUsage(result.api_usage);
    } catch (err) {
      console.error("重置统计失败:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-y-auto animate-slide-in-right">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-black/[0.08] dark:border-white/[0.08] bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            纠错模式设置
          </h2>
          <button
            onClick={onClose}
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
            {mode === "none" && "纠错已关闭"}
            {mode === "cloud_api" && apiKeySet && "纠错已开启"}
            {mode === "cloud_api" && !apiKeySet && "需要配置 API Key"}
          </div>

          {/* Correction Mode */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              纠错模式
            </h3>
            <div className="space-y-2">
              {([
                { value: "none" as CorrectionMode, label: "关闭", desc: "不进行纠错，直接输出转写结果" },
                { value: "cloud_api" as CorrectionMode, label: "云端 API 纠错", desc: "调用 OpenAI / Anthropic / DeepSeek 等大模型纠错" },
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
                云端 API 配置
              </h3>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  服务商
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as ApiProvider)}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                >
                  <option value="doubao">豆包（火山引擎）</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="custom">自定义</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={apiKeySet ? "已设置（输入新值覆盖）" : "输入 API Key"}
                  className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  模型名称
                </label>
                <input
                  type="text"
                  value={apiModel}
                  onChange={(e) => setApiModel(e.target.value)}
                  placeholder="模型名称"
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
              {saving ? "保存中…" : "保存设置"}
            </Button>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">已保存</span>
            )}
            {!dirty && !saved && serverState && (
              <span className="text-xs text-gray-400">设置已是最新</span>
            )}
          </div>

          {/* API Usage Stats */}
          {mode === "cloud_api" && (
            <section className="p-4 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.06] dark:border-white/[0.06]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  API 调用统计
                </h3>
                <button
                  onClick={handleResetUsage}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="重置统计"
                >
                  <RotateCcwIcon className="h-3 w-3" />
                  重置
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{usage.total_calls}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">总调用次数</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{usage.total_segments}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">纠错段数</div>
                </div>
                <div className="text-center">
                  <div className={`text-lg font-semibold ${usage.failed_calls > 0 ? "text-red-500" : "text-gray-900 dark:text-white"}`}>
                    {usage.failed_calls}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">失败次数</div>
                </div>
              </div>
            </section>
          )}

          {/* Hotwords */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              热词表
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              导入文本文件，每行一个词。纠错时优先使用这些词汇。
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
                      const { apiClient } = await import("../lib/api");
                      await apiClient.post("/hotwords/import", { words: newWords });
                      const updated = await fetchHotwords();
                      setWords(updated);
                    } catch (err) {
                      console.error("导入热词失败:", err);
                    }
                  };
                  input.click();
                }}
              >
                <UploadIcon className="h-3.5 w-3.5" />
                导入热词文件
              </Button>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <FileTextIcon className="h-3.5 w-3.5" />
                <span>已加载 {words.length} 个热词</span>
              </div>
            </div>
            <p className="text-xs text-gray-400">
              支持 .txt 文件，每行一个词，或用逗号分隔
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
