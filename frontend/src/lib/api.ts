// REST/WebSocket API helpers for EchoSmith frontend.
import axios, { AxiosHeaders } from "axios";
import { backendStatusStore } from "./backendStatus";

export interface HealthStatus {
  ffmpeg: boolean;
  models: boolean;
  status: string;
  model_cache_dir?: string;
  model_downloading?: boolean;
  download_progress?: number;
  download_message?: string;
}

export type TaskStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface TaskSnapshot {
  id: string;
  status: TaskStatus;
  progress: number;
  message: string;
  result_text?: string | null;
  segments: Array<{ index: number; start_ms: number; end_ms: number; text: string }>;
  source: Record<string, unknown>;
  error?: string | null;
  logs: Array<{ timestamp: number; type: string; message: string; progress?: number }>;
  created_at: number;
  updated_at: number;
}

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
  };
}

type ModelDownloadStatus = "started" | "already_downloading" | "already_exists";

export async function triggerModelDownload(): Promise<{ status: ModelDownloadStatus }> {
  await ensureBackendBase();
  const response = await apiClient.post<{ status: ModelDownloadStatus }>("/models/download");
  return response.data;
}

export async function listTasks(): Promise<TaskSnapshot[]> {
  await ensureBackendBase();
  const response = await apiClient.get<TaskSnapshot[]>("/tasks");
  return response.data;
}

export async function createTaskFromFile(file: File, language = "zh"): Promise<string> {
  await ensureBackendBase();
  const form = new FormData();
  form.append("file", file);
  form.append("language", language);
  const response = await apiClient.post<{ id: string }>("/tasks", form, {
    headers: { "Content-Type": "multipart/form-data" }
  });
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

export async function cancelTask(id: string): Promise<void> {
  await ensureBackendBase();
  await apiClient.delete(`/tasks/${id}`);
}

export async function exportTask(id: string, format: "txt" | "srt" | "json"): Promise<Blob> {
  await ensureBackendBase();
  const response = await apiClient.get(`/tasks/${id}/export`, {
    params: { format },
    responseType: format === "json" ? "blob" : "blob"
  });
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

/**
 * Auto-export completed task to the source file directory
 * NOTE: This function requires fs:scope permissions in Tauri capabilities
 */
export async function autoExportTask(
  taskId: string,
  formats: Array<"txt" | "srt" | "json">,
  sourceFilePath: string
): Promise<void> {
  console.log("[autoExportTask] Starting auto-export", { taskId, formats, sourceFilePath });

  try {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const { dirname, extname, basename } = await import("@tauri-apps/api/path");
    console.log("[autoExportTask] Tauri plugins imported successfully");

    // Get source file directory and base name
    const sourceDir = await dirname(sourceFilePath);
    const sourceExt = await extname(sourceFilePath);
    const sourceBase = await basename(sourceFilePath, sourceExt);
    console.log("[autoExportTask] Parsed file paths", { sourceDir, sourceExt, sourceBase });

    // Export each format
    for (const format of formats) {
      try {
        console.log(`[autoExportTask] Exporting ${format} for task ${taskId}`);
        const blob = await exportTask(taskId, format);
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Clean up format string (remove leading dots if any)
        const cleanFormat = format.startsWith('.') ? format.slice(1) : format;
        // Clean up base name (remove trailing dots if any)
        const cleanBase = sourceBase.replace(/\.+$/, '');

        const outputPath = `${sourceDir}/${cleanBase}.${cleanFormat}`;
        console.log(`[autoExportTask] Writing to ${outputPath}`, {
          sourceDir,
          cleanBase,
          cleanFormat,
          fullPath: outputPath
        });
        await writeFile(outputPath, uint8Array);
        console.log(`[autoExportTask] Successfully wrote ${format} file to ${outputPath}`);
      } catch (error) {
        console.error(`[autoExportTask] Failed to export ${format} for task ${taskId}:`, error);
        throw error;
      }
    }
    console.log("[autoExportTask] All exports completed successfully");
  } catch (error) {
    console.error("[autoExportTask] Auto-export failed:", error);
    throw error;
  }
}
