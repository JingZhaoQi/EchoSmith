// Card component utilities.
import { cn } from "../../lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        // macOS Sequoia style card
        "rounded-[20px] border border-black/[0.08] dark:border-white/[0.08]",
        "bg-white/90 dark:bg-zinc-900/90",
        "backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_24px_rgba(0,0,0,0.4)]",
        "p-6 space-y-4",
        "hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_24px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_12px_32px_rgba(0,0,0,0.5)]",
        "transition-all duration-300 ease-out",
        className
      )}
      {...props}
    />
  );
}
