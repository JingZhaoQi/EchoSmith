// REST/WebSocket API helpers for EchoSmith frontend.
import axios, { AxiosHeaders } from "axios";
import { backendStatusStore } from "./backendStatus";
import { getMessages } from "./i18n";

export interface HealthStatus {
  ffmpeg: boolean;
  models: boolean;
  status: string;
  model_cache_dir?: string;
  model_downloading?: boolean;
  download_progress?: number;
  download_message?: string;
  ytdlp?: boolean;
  correction_model?: boolean;
  correction_model_loaded?: boolean;
  correction_model_path?: string;
  asr_model?: string;
}

export type TaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type TaskPhase = "queued" | "downloading" | "transcribing" | "correcting" | "done";

/** Lightweight task state polled for the library (GET /tasks?summary=true). */
export interface TaskSummary {
  id: string;
  status: TaskStatus;
  progress: number;
  message: string;
  phase: TaskPhase;
  asr_progress: number;
  correction_enabled: boolean;
  correction_progress: number;
  correction_failed_batches: number;
  source: Record<string, unknown>;
  error?: string | null;
  created_at: number;
  updated_at: number;
}

/** Live state of one task (websocket / GET /tasks/{id}); texts are absent until loaded. */
export interface TaskSnapshot extends TaskSummary {
  result_text?: string | null;
  raw_text?: string | null;
  logs?: Array<{ timestamp: number; type: string; message: string; progress?: number }>;
}

export type ExportFormat = "txt" | "srt" | "md";
export const EXPORT_FORMATS: ExportFormat[] = ["txt", "srt", "md"];

const baseURL = "/api";
let backendToken: string | null = null;

type HeaderContainer = {
  set?: (name: string, value: string, rewrite?: boolean) => void;
  delete?: (name: string) => void;
  Authorization?: string;
  authorization?: string;
  [key: string]: unknown;
};

const applyAuthorizationHeader = (container: HeaderContainer | undefined, token: string) => {
  if (!container) {
    return;
  }

  const value = `Bearer ${token}`;

  if (typeof container.set === "function") {
    container.set("Authorization", value, true);
    return;
  }

  container.Authorization = value;
  container.authorization = value;
};

const clearAuthorizationHeader = (container: HeaderContainer | undefined) => {
  if (!container) {
    return;
  }

  if (typeof container.delete === "function") {
    container.delete("Authorization");
    return;
  }

  delete container.Authorization;
  delete container.authorization;
};

export const apiClient = axios.create({ baseURL });
let backendBasePromise: Promise<string> | null = null;

apiClient.interceptors.request.use((config) => {
  if (!backendToken) {
    clearAuthorizationHeader(config.headers as HeaderContainer | undefined);
    return config;
  }

  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }

  applyAuthorizationHeader(config.headers as HeaderContainer, backendToken);
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      backendStatusStore.getState().setError("后端拒绝请求，正在重新获取认证信息…");
      backendToken = null;
      backendBasePromise = null;
    }
    return Promise.reject(error);
  }
);

const stringifyError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

async function resolveBackendBase(): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const config = await invoke<{ url: string; token: string }>("get_backend_config");

    if (config?.url && config?.token) {
      console.debug("[EchoSmith][api] 获取到后端配置", config);
      backendToken = config.token;
      apiClient.defaults.baseURL = `${config.url}/api`;
      applyAuthorizationHeader(apiClient.defaults.headers.common as HeaderContainer, config.token);
      backendStatusStore.getState().setReady({
        baseURL: apiClient.defaults.baseURL,
        token: config.token
      });
      return apiClient.defaults.baseURL;
    }
    const warning = "[EchoSmith][api] get_backend_config 返回结果缺失 url 或 token";
    console.warn(warning, config);
    backendStatusStore.getState().setError(warning);
  } catch (error) {
    const rawMessage = stringifyError(error);
    const message = rawMessage.includes("not allowed")
      ? "缺少 get_backend_config 权限，请检查 Tauri capabilities 配置"
      : rawMessage;
    console.warn("[EchoSmith][api] 无法通过 Tauri 获取后端配置，改用默认 /api", message);
    backendToken = null;
    clearAuthorizationHeader(apiClient.defaults.headers.common as HeaderContainer);
    backendStatusStore.getState().setError(message);
  }

  return baseURL;
}

export async function ensureBackendBase(): Promise<string> {
  if (!backendBasePromise) {
    backendStatusStore.getState().setInitializing("正在连接 EchoSmith 后端…");
    backendBasePromise = resolveBackendBase().finally(() => {
      if (!backendToken) {
        backendBasePromise = null;
      }
    });
  }
  return backendBasePromise;
}

export async function fetchHealth(): Promise<HealthStatus> {
  await ensureBackendBase();
  const response = await apiClient.get<HealthStatus>("/health");
  const data = response.data;
  return {
    ffmpeg: data.ffmpeg,
    models: data.models ?? false,
    status: data.status,
    model_cache_dir: data.model_cache_dir,
    model_downloading: data.model_downloading ?? false,
    download_progress: data.download_progress ?? (data.model_downloading ? 0 : 1),
    download_message: data.download_message,
    ytdlp: data.ytdlp ?? false,
    correction_model: data.correction_model ?? false,
    correction_model_loaded: data.correction_model_loaded ?? false,
    correction_model_path: data.correction_model_path,
    asr_model: data.asr_model,
  };
}

type ModelDownloadStatus = "started" | "already_downloading" | "already_exists";

export async function triggerModelDownload(): Promise<{ status: ModelDownloadStatus }> {
  await ensureBackendBase();
  const response = await apiClient.post<{ status: ModelDownloadStatus }>("/models/download");
  return response.data;
}

export async function fetchHotwords(): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.get<{ words: string[] }>("/hotwords");
  return response.data.words;
}

export async function addHotword(word: string): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.post<{ words: string[] }>("/hotwords", { word });
  return response.data.words;
}

/** Replace the whole hotword list. */
export async function importHotwords(words: string[]): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.post<{ words: string[] }>("/hotwords/import", { words });
  return response.data.words;
}

export async function removeHotword(word: string): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.delete<{ words: string[] }>(
    `/hotwords/${encodeURIComponent(word)}`
  );
  return response.data.words;
}

// Settings types
export interface CorrectionConfig {
  mode: "none" | "cloud_api";
  api_provider: "doubao" | "openai" | "anthropic" | "deepseek" | "custom";
  api_key: string;
  api_key_set: boolean;
  api_model: string;
  api_base_url: string;
}

export interface TranscriptionConfig {
  asr_model: ASRModelId;
}

export type ASRModelId = "sensevoice-sherpa-2024";

export interface ApiUsageStats {
  total_calls: number;
  total_segments: number;
  failed_calls: number;
}

export interface AppSettings {
  transcription: TranscriptionConfig;
  correction: CorrectionConfig;
  api_usage: ApiUsageStats;
}

// Settings API
export async function fetchSettings(): Promise<AppSettings> {
  await ensureBackendBase();
  const response = await apiClient.get<AppSettings>("/settings");
  return response.data;
}

export async function updateSettings(settings: {
  transcription?: Partial<TranscriptionConfig>;
  correction?: Partial<CorrectionConfig>;
}): Promise<AppSettings> {
  await ensureBackendBase();
  const response = await apiClient.post<AppSettings>("/settings", settings);
  return response.data;
}

export async function resetApiUsage(): Promise<AppSettings> {
  await ensureBackendBase();
  const response = await apiClient.post<AppSettings>("/settings/reset-usage");
  return response.data;
}

export async function listTaskSummaries(): Promise<TaskSummary[]> {
  await ensureBackendBase();
  const response = await apiClient.get<TaskSummary[]>("/tasks", { params: { summary: true } });
  return response.data;
}

export async function createTaskFromFile(file: File, language = "auto"): Promise<string> {
  await ensureBackendBase();
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  const response = await apiClient.post<{ id: string }>("/tasks", form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return response.data.id;
}

export async function createTaskFromPath(path: string, language = "auto"): Promise<string> {
  await ensureBackendBase();
  const response = await apiClient.post<{ id: string }>("/tasks/local", { path, language });
  return response.data.id;
}

export async function createTaskFromUrl(url: string, language = "auto"): Promise<string> {
  await ensureBackendBase();
  const response = await apiClient.post<{ id: string }>("/tasks/url", { url, language });
  return response.data.id;
}

export async function pauseTask(id: string): Promise<void> {
  await ensureBackendBase();
  await apiClient.post(`/tasks/${id}/pause`);
}

export async function resumeTask(id: string): Promise<void> {
  await ensureBackendBase();
  await apiClient.post(`/tasks/${id}/resume`);
}

/** Stop a task; it stays in the library with its partial transcript. */
export async function cancelTask(id: string): Promise<void> {
  await ensureBackendBase();
  await apiClient.post(`/tasks/${id}/cancel`);
}

/** Stop (if running) and remove a task from the library. */
export async function deleteTask(id: string): Promise<void> {
  await ensureBackendBase();
  await apiClient.delete(`/tasks/${id}`);
}

/** Human-readable message from an API/network error (prefers the backend's `detail`). */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface DownloadProgress {
  type: "progress";
  ratio: number;
  message: string;
}

export interface DownloadDone {
  type: "done";
  filename: string;
  path: string;
}

export interface DownloadError {
  type: "error";
  detail: string;
}

export type DownloadEvent = DownloadProgress | DownloadDone | DownloadError;

export async function downloadMedia(
  url: string,
  saveDir: string,
  mode: "video" | "audio",
  onProgress?: (ratio: number, message: string) => void,
): Promise<{ filename: string; path: string }> {
  await ensureBackendBase();

  const base = apiClient.defaults.baseURL ?? baseURL;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (backendToken) {
    headers["Authorization"] = `Bearer ${backendToken}`;
  }

  const res = await fetch(`${base}/download`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, save_dir: saveDir, mode }),
  });

  if (!res.ok) {
    const detail = await res.json().then((body: { detail?: string }) => body.detail, () => undefined);
    throw new Error(detail || `${getMessages().downloadFailed} (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error(getMessages().downloadFailed);

  const decoder = new TextDecoder();
  let buffer = "";
  let result: { filename: string; path: string } | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    // Process complete NDJSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event: DownloadEvent = JSON.parse(line);
      if (event.type === "progress" && onProgress) {
        onProgress(event.ratio, event.message);
      } else if (event.type === "done") {
        result = { filename: event.filename, path: event.path };
      } else if (event.type === "error") {
        throw new Error(event.detail);
      }
    }

    if (done) break;
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const event: DownloadEvent = JSON.parse(buffer);
    if (event.type === "done") {
      result = { filename: event.filename, path: event.path };
    } else if (event.type === "error") {
      throw new Error(event.detail);
    }
  }

  if (!result) throw new Error(getMessages().downloadFailed);
  return result;
}

export async function exportTask(id: string, format: ExportFormat): Promise<Blob> {
  await ensureBackendBase();
  const response = await apiClient.get(`/tasks/${id}/export`, { params: { format }, responseType: "blob" });
  return response.data;
}

export function connectTaskStream(taskId: string): WebSocket {
  const base = apiClient.defaults.baseURL ?? baseURL;
  const match = /^(https?):\/\/(.+)$/.exec(base);
  let wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  let host = window.location.host;
  if (match) {
    const scheme = match[1];
    host = match[2].replace(/\/api$/, "");
    wsProtocol = scheme === "https" ? "wss" : "ws";
  }
  const tokenQuery = backendToken ? `?token=${backendToken}` : "";
  const url = `${wsProtocol}://${host}/ws/tasks/${taskId}${tokenQuery}`;
  return new WebSocket(url);
}

/** Write each format as "<dir>/<base>.<format>" (desktop only); returns the written paths. */
export async function saveTaskFiles(taskId: string, formats: ExportFormat[], dir: string, base: string): Promise<string[]> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const { join } = await import("@tauri-apps/api/path");
  const written: string[] = [];
  for (const format of formats) {
    const blob = await exportTask(taskId, format);
    const path = await join(dir, `${base}.${format}`);
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    written.push(path);
  }
  return written;
}

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Ask where to save (desktop) or trigger a browser download; returns false if the user cancelled. */
export async function saveExport(blob: Blob, fileName: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: fileName });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revoking synchronously can cancel the download
  return true;
}
