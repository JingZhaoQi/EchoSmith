// Progress component.
import { cn } from "../../lib/utils";

type ProgressVariant = "default" | "success" | "error";

interface ProgressProps {
  value?: number;
  variant?: ProgressVariant;
  animated?: boolean;
  className?: string;
}

const barColors: Record<ProgressVariant, string> = {
  default: "bg-sky-500",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

export function Progress({ value = 0, variant = "default", animated = false, className }: ProgressProps): JSX.Element {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2 w-full rounded-full bg-black/[0.08] dark:bg-white/[0.08] overflow-hidden", className)}>
      <div
        className={cn(
          "h-2 rounded-full transition-all duration-500",
          barColors[variant],
          animated && "progress-striped"
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
