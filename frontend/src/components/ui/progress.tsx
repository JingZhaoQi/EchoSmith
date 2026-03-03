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
  default: "bg-primary",
  success: "bg-emerald-500",
  error: "bg-red-500",
};

export function Progress({ value = 0, variant = "default", animated = false, className }: ProgressProps): JSX.Element {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className={cn("h-2.5 w-full rounded-full bg-muted overflow-hidden", className)}>
      <div
        className={cn(
          "h-2.5 rounded-full transition-all duration-500",
          barColors[variant],
          animated && "progress-striped"
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
