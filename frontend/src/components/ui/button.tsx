// Shadcn-inspired button component.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex transform-gpu select-none items-center justify-center rounded-xl text-sm font-medium transition-all duration-200 will-change-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50 disabled:pointer-events-none disabled:opacity-50 data-[pressing=true]:translate-y-[1px] data-[pressing=true]:scale-[0.97] data-[pressing=true]:brightness-95 data-[pressing=true]:shadow-inner",
  {
    variants: {
      variant: {
        default: "bg-slate-950 text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)] hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200",
        secondary: "glass-field text-secondary-foreground shadow-[0_7px_18px_rgba(15,23,42,0.10),inset_0_1px_0_rgba(255,255,255,0.80)] hover:bg-white/[0.82] hover:shadow-[0_10px_24px_rgba(15,23,42,0.13),inset_0_1px_0_rgba(255,255,255,0.88)] dark:shadow-[0_10px_24px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] dark:hover:bg-white/[0.12]",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        ghost: "text-slate-700 hover:bg-black/[0.07] hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)] dark:text-slate-200 dark:hover:bg-white/[0.09] dark:hover:shadow-[0_8px_18px_rgba(0,0,0,0.22)]",
        link: "text-sky-700 dark:text-sky-300 underline-offset-4 hover:underline"
      },
      size: {
        default: "px-4 py-2.5",
        sm: "h-8 px-3",
        lg: "h-11 px-5 rounded-2xl",
        icon: "h-8 w-8 p-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      disabled,
      onPointerDown,
      onPointerUp,
      onPointerLeave,
      onPointerCancel,
      onBlur,
      ...props
    },
    ref
  ) => {
    const [pressing, setPressing] = React.useState(false);
    const releaseTimerRef = React.useRef<number | null>(null);
    const Comp = asChild ? Slot : "button";

    const clearReleaseTimer = () => {
      if (releaseTimerRef.current !== null) {
        window.clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };

    const releaseWithMinimumFeedback = () => {
      clearReleaseTimer();
      releaseTimerRef.current = window.setTimeout(() => {
        setPressing(false);
        releaseTimerRef.current = null;
      }, 140);
    };

    React.useEffect(() => clearReleaseTimer, []);

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        data-pressing={pressing ? "true" : undefined}
        disabled={disabled}
        onPointerDown={(event) => {
          if (!disabled) {
            clearReleaseTimer();
            setPressing(true);
          }
          onPointerDown?.(event);
        }}
        onPointerUp={(event) => {
          releaseWithMinimumFeedback();
          onPointerUp?.(event);
        }}
        onPointerLeave={(event) => {
          releaseWithMinimumFeedback();
          onPointerLeave?.(event);
        }}
        onPointerCancel={(event) => {
          releaseWithMinimumFeedback();
          onPointerCancel?.(event);
        }}
        onBlur={(event) => {
          setPressing(false);
          onBlur?.(event);
        }}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
