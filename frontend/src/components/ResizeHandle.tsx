// Vertical drag handle between two columns: drag (mouse) or arrow keys to resize, double-click to reset.
import { useRef } from "react";

interface ResizeHandleProps {
  /** pointer x in client coordinates while dragging */
  onDrag(clientX: number): void;
  /** keyboard nudge: -1 (left) or +1 (right) */
  onStep(direction: -1 | 1): void;
  onReset(): void;
  label: string;
  value: number;
}

export function ResizeHandle({ onDrag, onStep, onReset, label, value }: ResizeHandleProps): JSX.Element {
  const dragging = useRef(false);

  const start = (event: React.MouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    const move = (e: MouseEvent) => dragging.current && onDrag(e.clientX);
    const stop = () => {
      dragging.current = false;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
    document.body.style.cursor = "col-resize"; // keep the cursor while the mouse leaves the thin handle
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      title={label}
      onMouseDown={start}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onStep(e.key === "ArrowLeft" ? -1 : 1);
        }
      }}
      className="group relative w-2 flex-shrink-0 cursor-col-resize self-stretch outline-none"
    >
      <span className="absolute inset-y-6 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-slate-400/0 transition-colors group-hover:bg-sky-500/60 group-focus-visible:bg-sky-500/80 dark:group-hover:bg-sky-400/60" />
    </div>
  );
}
