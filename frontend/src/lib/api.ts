// REST/WebSocket API helpers for EchoSmith frontend.
import axios from "axios";

export interface HealthStatus {
  ffmpeg: boolean;
  models: boolean;
  status: string;
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

export const apiClient = axios.create({ baseURL });

async function resolveBackendBase(): Promise<string> {
  const tauriWindow = window as Window & { __TAURI__?: unknown };
  if (tauriWindow.__TAURI__) {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const config = await invoke<{ url: string; token: string }>("get_backend_config");
    backendToken = config.token;
    apiClient.defaults.baseURL = `${config.url}/api`;
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${config.token}`;
    return apiClient.defaults.baseURL;
  }
  return baseURL;
}

let backendBasePromise: Promise<string> | null = null;

export async function ensureBackendBase(): Promise<string> {
  if (!backendBasePromise) {
    backendBasePromise = resolveBackendBase();
  }
  return backendBasePromise;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await apiClient.get<HealthStatus>("/health");
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
