// Theme toggle buttons for EchoSmith.
import { SunIcon, MoonIcon, MonitorIcon } from "lucide-react";

import { Button } from "./ui/button";

interface Props {
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
}

export function ThemeToggle({ theme, onThemeChange }: Props): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant={theme === "light" ? "default" : "secondary"}
        size="sm"
        onClick={() => onThemeChange("light")}
        className="gap-1.5"
        title="浅色模式"
      >
        <SunIcon className="h-4 w-4" />
        浅色
      </Button>
      <Button
        variant={theme === "dark" ? "default" : "secondary"}
        size="sm"
        onClick={() => onThemeChange("dark")}
        className="gap-1.5"
        title="深色模式"
      >
        <MoonIcon className="h-4 w-4" />
        深色
      </Button>
      <Button
        variant={theme === "system" ? "default" : "secondary"}
        size="sm"
        onClick={() => onThemeChange("system")}
        className="gap-1.5"
        title="跟随系统"
      >
        <MonitorIcon className="h-4 w-4" />
        系统
      </Button>
    </div>
  );
}
