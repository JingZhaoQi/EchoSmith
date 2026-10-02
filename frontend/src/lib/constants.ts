// Shared constants and utility functions.

export function getSourceLabel(source?: Record<string, unknown>, maxLen = 50): string {
  if (!source) return "";
  const truncate = (s: string) => (s.length > maxLen ? s.slice(0, maxLen) + "…" : s);
  const name = (source as { name?: unknown }).name;
  if (typeof name === "string" && name.length > 0) {
    return truncate(name);
  }
  const value = (source as { value?: unknown }).value;
  if (typeof value === "string" && value.length > 0) {
    return truncate(value);
  }
  const url = (source as { url?: unknown }).url;
  if (typeof url === "string" && url.length > 0) {
    return truncate(url);
  }
  return "";
}
