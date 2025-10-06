// Card component utilities.
import { cn } from "../../lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-5 shadow-lg shadow-indigo-500/5 dark:shadow-indigo-900/20 space-y-3 hover:shadow-2xl hover:shadow-indigo-500/20 dark:hover:shadow-indigo-900/40 transition-shadow duration-300",
        className
      )}
      {...props}
    />
  );
}
