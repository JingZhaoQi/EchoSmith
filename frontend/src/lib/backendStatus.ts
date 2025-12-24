import { createStore } from "zustand/vanilla";
import { create } from "zustand";

export type BackendStatus = "idle" | "initializing" | "ready" | "error";

interface BackendState {
  status: BackendStatus;
  message?: string;
  baseURL: string;
  token: string | null;
  setInitializing: (message?: string) => void;
  setReady: (config: { baseURL: string; token: string }) => void;
  setError: (message: string) => void;
}

export const backendStatusStore = createStore<BackendState>((set) => ({
  status: "idle",
  message: undefined,
  baseURL: "/api",
  token: null,
  setInitializing: (message) =>
    set((state) => ({
      ...state,
      status: "initializing",
      message,
    })),
  setReady: ({ baseURL, token }) =>
    set({
      status: "ready",
      message: undefined,
      baseURL,
      token,
    }),
  setError: (message) =>
    set((state) => ({
      ...state,
      status: "error",
      message,
      token: null,
    })),
}));

export const useBackendStatus = create(backendStatusStore);
