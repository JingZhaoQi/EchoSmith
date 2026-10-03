// Card component utilities.
import { cn } from "../../lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className, ...props }: CardProps): JSX.Element {
  return (
    <div
      className={cn(
        "liquid-panel p-5 space-y-4 transition-shadow duration-200",
        className
      )}
      {...props}
    />
  );
}
