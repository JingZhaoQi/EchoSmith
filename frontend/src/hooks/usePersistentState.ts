// useState that survives restarts via localStorage (per-viewer layout preferences).
import { useEffect, useState } from "react";

export function usePersistentState<T>(key: string, initial: T, valid: (value: unknown) => value is T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as unknown;
      return valid(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: keep the in-memory value
    }
  }, [key, value]);
  return [value, setValue];
}

export const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
