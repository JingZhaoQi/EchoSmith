// Window-wide file drop: desktop gives full paths (Tauri), the browser gives File objects.
import { useEffect, useState } from "react";

import { useBatchStore, type NewBatchFile } from "./useBatchStore";
import { useTasksStore } from "./useTasksStore";

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

export function useFileDrop(onRejected: () => void): boolean {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const accept = (files: NewBatchFile[]) => {
      setDragging(false);
      if (!files.length) return;
      if (useBatchStore.getState().addFiles(files) === 0) {
        onRejected();
        return;
      }
      useTasksStore.getState().setActiveTask(null); // show the intake view with the new files
    };

    let unlisten: (() => void) | undefined;
    let disposed = false;
    if ("__TAURI_INTERNALS__" in window) {
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        const stop = await getCurrentWindow().onDragDropEvent((event) => {
          const { type } = event.payload;
          if (type === "enter" || type === "over") setDragging(true);
          else if (type === "leave") setDragging(false);
          else if (type === "drop") accept(event.payload.paths.map((path) => ({ name: baseName(path), path })));
        });
        if (disposed) stop();
        else unlisten = stop;
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      accept(Array.from(e.dataTransfer?.files ?? []).map((file) => ({ name: file.name, file })));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onRejected]);

  return dragging;
}
