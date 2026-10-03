// Theme management hook for EchoSmith frontend.
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "echosmith-theme";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    return stored ?? "system";
  });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow OS theme changes so "system" stays correct while the app runs.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

    // Update dark class for Tailwind
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    // Keep data-theme for other purposes
    root.dataset.theme = resolved;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, systemDark]);

  return [theme, setTheme];
}
