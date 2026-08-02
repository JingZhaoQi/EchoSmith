import { useEffect, useState, useCallback } from "react";
import {
  XIcon,
  LoaderIcon,
  UploadIcon,
  FileTextIcon,
  SaveIcon,
  RotateCcwIcon,
  DownloadIcon,
  HardDriveIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "./ui/button";
import {
  fetchSettings,
  updateSettings,
  resetApiUsage,
  fetchHotwords,
  fetchASRModels,
  downloadASRModel,
  deleteASRModel,
  type TranscriptionConfig,
  type CorrectionConfig,
  type ApiUsageStats,
  type ASRModelId,
  type ASRModelStatus,
} from "../lib/api";

interface SettingsPanelProps {
  onClose: () => void;
  onSaved?: (active: boolean) => void;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

type CorrectionMode = "none" | "cloud_api";
type ApiProvider = CorrectionConfig["api_provider"];
type AccuracyMode = TranscriptionConfig["accuracy_mode"];
type DomainProfile = TranscriptionConfig["domain_profile"];

const PROVIDER_DEFAULTS: Record<ApiProvider, { model: string; baseUrl: string }> = {
  doubao: { model: "doubao-seed-2-0-lite-260215", baseUrl: "" },
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  anthropic: { model: "claude-sonnet-4-20250514", baseUrl: "" },
  deepseek: { model: "deepseek-chat", baseUrl: "" },
  custom: { model: "", baseUrl: "" },
};

const getDownloadErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (typeof data === "object" && data !== null && "detail" in data) {
      return String((data as { detail: unknown }).detail);
    }
    if (typeof data === "string" && data.trim()) {
      return data;
    }
  }
  return error instanceof Error ? error.message : "模型下载启动失败";
};

const FALLBACK_ASR_MODELS: ASRModelStatus[] = [
  {
    id: "sensevoice-sherpa-2024",
    label: "SenseVoice INT8",
    provider: "sherpa",
    description: "当前稳定默认模型，速度快，适合普通中文/英文媒体转写。",
    size_hint: "~240 MB",
    estimated_size_bytes: 240_000_000,
    estimated_size_label: "240 MB",
    dependency: "内置 sherpa-onnx",
    source: "sherpa-onnx",
    repo_id: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
    hub: "sherpa",
    hf_repo_id: null,
    recommended: true,
    experimental: false,
    installed: true,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: true,
    path: "~/.cache/sherpa-onnx/sense-voice",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
  {
    id: "qwen3-asr-0.6b",
    label: "Qwen3-ASR 0.6B",
    provider: "qwen3",
    description: "Qwen3-ASR 轻量高准确率路线，支持多语言和方言。",
    size_hint: "0.6B 参数",
    estimated_size_bytes: 1_880_000_000,
    estimated_size_label: "1.88 GB",
    dependency: "需要 qwen-asr",
    source: "ModelScope / Hugging Face",
    repo_id: "Qwen/Qwen3-ASR-0.6B",
    hub: "modelscope",
    hf_repo_id: "Qwen/Qwen3-ASR-0.6B",
    recommended: true,
    experimental: true,
    installed: false,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: false,
    path: "~/.cache/echosmith/asr-models/qwen3-asr-0.6b",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
  {
    id: "qwen3-asr-1.7b",
    label: "Qwen3-ASR 1.7B",
    provider: "qwen3",
    description: "更高准确率的 Qwen3-ASR 模型，资源占用更高。",
    size_hint: "1.7B 参数",
    estimated_size_bytes: 4_700_000_000,
    estimated_size_label: "4.7 GB",
    dependency: "需要 qwen-asr",
    source: "ModelScope / Hugging Face",
    repo_id: "Qwen/Qwen3-ASR-1.7B",
    hub: "modelscope",
    hf_repo_id: "Qwen/Qwen3-ASR-1.7B",
    recommended: false,
    experimental: true,
    installed: false,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: false,
    path: "~/.cache/echosmith/asr-models/qwen3-asr-1.7b",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
  {
    id: "funasr-sensevoice-small",
    label: "FunASR SenseVoiceSmall",
    provider: "funasr",
    description: "FunASR 集成的 SenseVoiceSmall，支持情绪/事件等扩展能力。",
    size_hint: "~234M 参数",
    estimated_size_bytes: 944_000_000,
    estimated_size_label: "944 MB",
    dependency: "需要 funasr",
    source: "ModelScope / Hugging Face",
    repo_id: "iic/SenseVoiceSmall",
    hub: "modelscope",
    hf_repo_id: "FunAudioLLM/SenseVoiceSmall",
    recommended: false,
    experimental: true,
    installed: false,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: false,
    path: "~/.cache/echosmith/asr-models/funasr-sensevoice-small",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
  {
    id: "funasr-paraformer-zh",
    label: "FunASR Paraformer zh",
    provider: "funasr",
    description: "中文 Paraformer 路线，适合中文长音频和热词增强。",
    size_hint: "~890 MB",
    estimated_size_bytes: 890_000_000,
    estimated_size_label: "890 MB",
    dependency: "需要 funasr",
    source: "ModelScope / Hugging Face",
    repo_id: "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    hub: "modelscope",
    hf_repo_id: "funasr/paraformer-zh",
    recommended: true,
    experimental: true,
    installed: false,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: false,
    path: "~/.cache/echosmith/asr-models/funasr-paraformer-zh",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
  {
    id: "funasr-nano",
    label: "Fun-ASR-Nano",
    provider: "funasr",
    description: "FunASR 多语言路线，兼顾速度和结构化输出。",
    size_hint: "~800M 参数",
    estimated_size_bytes: 1_990_000_000,
    estimated_size_label: "1.99 GB",
    dependency: "需要 funasr",
    source: "Hugging Face / ModelScope",
    repo_id: "FunAudioLLM/Fun-ASR-Nano-2512",
    hub: "huggingface",
    hf_repo_id: "FunAudioLLM/Fun-ASR-Nano-2512",
    recommended: false,
    experimental: true,
    installed: false,
    installed_size_bytes: 0,
    installed_size_label: "",
    selected: false,
    path: "~/.cache/echosmith/asr-models/funasr-nano",
    downloading: false,
    download_progress: 0,
    download_message: "",
    download_error: "",
  },
];

export function SettingsPanel({
  onClose,
  onSaved,
  theme,
  onThemeChange,
}: SettingsPanelProps): JSX.Element {
  const [accuracyMode, setAccuracyMode] = useState<AccuracyMode>("balanced");
  const [domainProfile, setDomainProfile] = useState<DomainProfile>("general");
  const [asrModel, setAsrModel] = useState<ASRModelId | null>(null);
  const [asrModels, setAsrModels] = useState<ASRModelStatus[]>(FALLBACK_ASR_MODELS);
  const [asrModelLoadError, setAsrModelLoadError] = useState("");
  const [modelDownloadMessage, setModelDownloadMessage] = useState("");
  const [modelDeletingId, setModelDeletingId] = useState<ASRModelId | null>(null);
  const [modelSavingId, setModelSavingId] = useState<ASRModelId | null>(null);
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
    accuracyMode: AccuracyMode;
    domainProfile: DomainProfile;
    asrModel: ASRModelId;
    mode: CorrectionMode;
    provider: ApiProvider;
    apiModel: string;
    apiBaseUrl: string;
    apiKeySet: boolean;
  } | null>(null);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setAccuracyMode(s.transcription?.accuracy_mode ?? "balanced");
        setDomainProfile(s.transcription?.domain_profile ?? "general");
        setAsrModel(s.transcription?.asr_model ?? "sensevoice-sherpa-2024");
        const c = s.correction;
        const m = (c.mode === "local_3b" ? "none" : c.mode) as CorrectionMode;
        setMode(m);
        setProvider(c.api_provider);
        setApiKey(c.api_key);
        setApiKeySet(c.api_key_set);
        setApiModel(c.api_model);
        setApiBaseUrl(c.api_base_url);
        setUsage(s.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
        setServerState({
          accuracyMode: s.transcription?.accuracy_mode ?? "balanced",
          domainProfile: s.transcription?.domain_profile ?? "general",
          asrModel: s.transcription?.asr_model ?? "sensevoice-sherpa-2024",
          mode: m,
          provider: c.api_provider,
          apiModel: c.api_model,
          apiBaseUrl: c.api_base_url,
          apiKeySet: c.api_key_set,
        });
      })
      .catch(console.error);

    fetchHotwords().then(setWords).catch(console.error);
    fetchASRModels()
      .then((models) => {
        setAsrModels(models);
        setAsrModelLoadError("");
      })
      .catch((error) => {
        console.error(error);
        setAsrModelLoadError("无法读取模型安装状态，请确认后端已更新并重新打开应用。");
      });
  }, []);

  useEffect(() => {
    if (!asrModels.some((model) => model.downloading)) return;
    const timer = window.setInterval(() => {
      fetchASRModels()
        .then((models) => {
          setAsrModels(models);
          setAsrModelLoadError("");
        })
        .catch((error) => {
          console.error(error);
          setAsrModelLoadError("无法读取模型安装状态，请确认后端已更新并重新打开应用。");
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [asrModels]);

  // Track dirty state
  useEffect(() => {
    if (!serverState) return;
    const keyChanged = Boolean(apiKey) && !apiKey.includes("****");
    const changed =
      accuracyMode !== serverState.accuracyMode ||
      domainProfile !== serverState.domainProfile ||
      asrModel !== serverState.asrModel ||
      mode !== serverState.mode ||
      provider !== serverState.provider ||
      apiModel !== serverState.apiModel ||
      apiBaseUrl !== serverState.apiBaseUrl ||
      keyChanged;
    setDirty(changed);
    setSaved(false);
  }, [accuracyMode, domainProfile, asrModel, mode, provider, apiKey, apiModel, apiBaseUrl, serverState]);

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
      const result = await updateSettings({
        transcription: {
          accuracy_mode: accuracyMode,
          domain_profile: domainProfile,
          asr_model: asrModel ?? serverState?.asrModel ?? "sensevoice-sherpa-2024",
        },
        correction: payload,
      });
      const c = result.correction;
      const newMode = (c.mode === "local_3b" ? "none" : c.mode) as CorrectionMode;
      setAccuracyMode(result.transcription?.accuracy_mode ?? "balanced");
      setDomainProfile(result.transcription?.domain_profile ?? "general");
      setAsrModel(result.transcription?.asr_model ?? "sensevoice-sherpa-2024");
      setMode(newMode);
      setApiKeySet(c.api_key_set);
      setApiKey(c.api_key);
      setUsage(result.api_usage ?? { total_calls: 0, total_segments: 0, failed_calls: 0 });
      setServerState({
        accuracyMode: result.transcription?.accuracy_mode ?? "balanced",
        domainProfile: result.transcription?.domain_profile ?? "general",
        asrModel: result.transcription?.asr_model ?? "sensevoice-sherpa-2024",
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
      console.error("保存设置失败:", err);
    } finally {
      setSaving(false);
    }
  }, [accuracyMode, domainProfile, asrModel, mode, provider, apiKey, apiModel, apiBaseUrl, serverState]);

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

  const handleDownloadModel = async (modelId: ASRModelId) => {
    setModelDownloadMessage("");
    setAsrModels((models) =>
      models.map((model) =>
        model.id === modelId
          ? {
              ...model,
              downloading: true,
              download_progress: 0,
              download_message: "准备下载",
              download_error: "",
            }
          : model
      )
    );
    try {
      const response = await downloadASRModel(modelId);
      setModelDownloadMessage(
        response.status === "already_downloading"
          ? "模型正在下载中"
          : response.status === "already_exists"
            ? "模型已经下载完成"
            : "已开始下载模型，完成前请保持应用打开"
      );
      const models = await fetchASRModels();
      setAsrModels(models);
    } catch (err) {
      const message = getDownloadErrorMessage(err);
      setAsrModels((models) =>
        models.map((model) =>
          model.id === modelId
            ? {
                ...model,
                downloading: false,
                download_progress: 0,
                download_message: "",
                download_error: message,
              }
            : model
        )
      );
      setModelDownloadMessage(message);
    }
  };

  const handleSelectASRModel = async (model: ASRModelStatus) => {
    if (!model.installed || model.downloading || modelSavingId) return;
    if (model.id === asrModel) return;

    const previousModel = asrModel;
    setAsrModel(model.id);
    setModelSavingId(model.id);
    setModelDownloadMessage("");

    try {
      const result = await updateSettings({
        transcription: {
          asr_model: model.id,
        },
      });
      const nextAsrModel = result.transcription?.asr_model ?? "sensevoice-sherpa-2024";
      setAsrModel(nextAsrModel);
      setServerState((state) => (state ? { ...state, asrModel: nextAsrModel } : state));
      setModelDownloadMessage(`已切换到 ${model.label}`);
    } catch (err) {
      setAsrModel(previousModel);
      setModelDownloadMessage(getDownloadErrorMessage(err));
    } finally {
      setModelSavingId(null);
    }
  };

  const handleDeleteModel = async (model: ASRModelStatus) => {
    if (model.provider === "sherpa" || model.downloading) return;
    const confirmed = window.confirm(`删除 ${model.label} 的本地模型文件？`);
    if (!confirmed) return;

    setModelDeletingId(model.id);
    setModelDownloadMessage("");
    try {
      await deleteASRModel(model.id);
      const [settings, models] = await Promise.all([fetchSettings(), fetchASRModels()]);
      const nextAsrModel = settings.transcription?.asr_model ?? "sensevoice-sherpa-2024";
      setAsrModel(nextAsrModel);
      setServerState((state) => (state ? { ...state, asrModel: nextAsrModel } : state));
      setAsrModels(models);
      setModelDownloadMessage(`已删除 ${model.label}`);
    } catch (err) {
      const message = getDownloadErrorMessage(err);
      setModelDownloadMessage(message);
    } finally {
      setModelDeletingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 border-l border-black/[0.08] dark:border-white/[0.08] shadow-2xl overflow-y-auto animate-slide-in-right">
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

          {/* Appearance */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              外观
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "light" as const, label: "浅色", icon: SunIcon },
                { value: "dark" as const, label: "深色", icon: MoonIcon },
                { value: "system" as const, label: "系统", icon: MonitorIcon },
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

          {/* Local ASR Model */}
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  本地识别模型
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  选择后续任务使用的本地 ASR 引擎
                </p>
              </div>
              <HardDriveIcon className="h-4 w-4 text-gray-400" />
            </div>

            {asrModelLoadError && (
              <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <span>{asrModelLoadError}</span>
              </div>
            )}

            <div className="space-y-2">
              {asrModels.map((model) => {
                const selected = asrModel === model.id;
                const needsDownload = !model.installed && model.provider !== "sherpa";
                const estimatedSize = model.estimated_size_label || model.size_hint || "未知";
                const installedSize = model.installed_size_label || "";
                const hasLocalFiles = model.installed_size_bytes > 0;
                const canDeleteLocalFiles = model.provider !== "sherpa" && hasLocalFiles;
                const deleting = modelDeletingId === model.id;
                const savingModel = modelSavingId === model.id;
                const selectable = model.installed && !model.downloading;
                const localProgress =
                  model.estimated_size_bytes > 0
                    ? model.installed_size_bytes / model.estimated_size_bytes
                    : 0;
                const downloadProgress = Math.min(
                  1,
                  Math.max(model.download_progress || 0, localProgress)
                );
                const showProgress =
                  model.downloading || (!model.installed && hasLocalFiles && model.provider !== "sherpa");
                const modelPath = model.path || "后端未返回模型路径";
                return (
                  <div
                    key={model.id}
                    className={`rounded-xl border p-3 transition-all ${
                      selected
                        ? "border-sky-500/50 bg-sky-500/[0.06]"
                        : "border-black/[0.08] dark:border-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="asr-model"
                        value={model.id}
                        checked={selected}
                        disabled={!selectable || Boolean(modelSavingId)}
                        onChange={() => handleSelectASRModel(model)}
                        className="mt-1 accent-sky-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {model.label}
                          </span>
                          {model.recommended && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              推荐
                            </span>
                          )}
                          {model.experimental && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              可选
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                          {model.description}
                        </p>
                        <div className="mt-2 grid gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-gray-600 dark:text-gray-300">
                              {model.provider.toUpperCase()}
                            </span>
                            <span>参数：{model.size_hint}</span>
                            <span>预计下载：{estimatedSize}</span>
                          </div>
                          {installedSize && (
                            <div>
                              {model.installed ? "已安装大小" : model.downloading ? "已下载" : "本地残留"}：
                              {installedSize}
                            </div>
                          )}
                          <div className="min-w-0">
                            <span>存放路径：</span>
                            <span
                              className="break-all font-mono text-[10.5px] text-gray-500 dark:text-gray-400"
                              title={modelPath}
                            >
                              {modelPath}
                            </span>
                          </div>
                          <div>{model.dependency}</div>
                        </div>
                        {model.downloading && model.download_message && (
                          <div className="mt-2 text-xs text-sky-700 dark:text-sky-300">
                            {model.download_message}
                          </div>
                        )}
                        {model.download_error && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                            <AlertCircleIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>{model.download_error}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        {savingModel ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[11px] text-sky-700 dark:text-sky-300">
                            <LoaderIcon className="h-3 w-3 animate-spin" />
                            保存中
                          </span>
                        ) : model.downloading ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-[11px] text-sky-700 dark:text-sky-300">
                            <LoaderIcon className="h-3 w-3 animate-spin" />
                            下载中
                          </span>
                        ) : model.installed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2Icon className="h-3 w-3" />
                            已安装
                          </span>
                        ) : hasLocalFiles && model.provider !== "sherpa" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
                            <AlertCircleIcon className="h-3 w-3" />
                            未完成
                          </span>
                        ) : needsDownload ? (
                          <span className="rounded-full bg-gray-500/10 px-2 py-1 text-[11px] text-gray-500">
                            未下载
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-500/10 px-2 py-1 text-[11px] text-gray-500">
                            使用现有入口
                          </span>
                        )}

                        {needsDownload && (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="gap-1.5"
                            disabled={model.downloading}
                            onClick={() => handleDownloadModel(model.id)}
                          >
                            {model.downloading ? (
                              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <DownloadIcon className="h-3.5 w-3.5" />
                            )}
                            {model.downloading ? "下载中" : hasLocalFiles ? "继续下载" : "下载"}
                          </Button>
                        )}

                        {canDeleteLocalFiles && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            disabled={model.downloading || deleting}
                            onClick={() => handleDeleteModel(model)}
                          >
                            {deleting ? (
                              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2Icon className="h-3.5 w-3.5" />
                            )}
                            删除
                          </Button>
                        )}

                        {showProgress && (
                          <div className="w-24">
                            <div className="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                              <div
                                className="h-full rounded-full bg-sky-500 transition-all"
                                style={{
                                  width: `${Math.max(5, Math.round(downloadProgress * 100))}%`,
                                }}
                              />
                            </div>
                            <div className="mt-1 text-right text-[11px] text-gray-400">
                              {Math.round(downloadProgress * 100)}%
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {modelDownloadMessage && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {modelDownloadMessage}
              </p>
            )}
          </section>

          {/* Transcription Accuracy */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
              转写准确率
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "fast" as AccuracyMode, label: "快速", desc: "少量处理" },
                { value: "balanced" as AccuracyMode, label: "均衡", desc: "推荐默认" },
                { value: "accurate" as AccuracyMode, label: "高准确率", desc: "更慢更稳" },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAccuracyMode(opt.value)}
                  className={`rounded-xl border px-3 py-2 text-left transition-all ${
                    accuracyMode === opt.value
                      ? "border-sky-500/50 bg-sky-500/[0.07] text-sky-800 dark:text-sky-200"
                      : "border-black/[0.08] text-gray-700 hover:border-black/[0.15] dark:border-white/[0.08] dark:text-gray-300 dark:hover:border-white/[0.15]"
                  }`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                内容领域
              </label>
              <select
                value={domainProfile}
                onChange={(e) => setDomainProfile(e.target.value as DomainProfile)}
                className="w-full rounded-lg border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="general">通用媒体</option>
                <option value="sermon">讲道 / 神学</option>
                <option value="academic">学术讲座</option>
                <option value="meeting">会议访谈</option>
                <option value="tech">编程技术</option>
              </select>
              <p className="mt-2 text-xs text-gray-400">
                领域会影响术语恢复、同音词纠错和二遍纠错上下文。
              </p>
            </div>
          </section>

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
