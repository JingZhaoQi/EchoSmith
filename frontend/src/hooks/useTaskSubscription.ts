// Live updates (texts included) for the task open in the main area; reconnects if the socket drops.
import { useEffect } from "react";

import { connectTaskStream, ensureBackendBase, type TaskSnapshot } from "../lib/api";
import { TERMINAL_STATUSES, useTasksStore } from "./useTasksStore";

const RECONNECT_MS = 1000;

export function useTaskSubscription(taskId: string | null): void {
  const upsertTask = useTasksStore((state) => state.upsertTask);

  useEffect(() => {
    if (!taskId) return;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let finished = false;

    const connect = () => {
      void ensureBackendBase().then(() => {
        if (closed) return;
        socket = connectTaskStream(taskId);
        socket.onmessage = (event) => {
          const data = JSON.parse(event.data) as TaskSnapshot;
          finished = TERMINAL_STATUSES.has(data.status);
          upsertTask(data);
        };
        socket.onclose = () => {
          // the server closes the stream when the task is deleted; a finished task needs no more updates
          if (!closed && !finished) retry = setTimeout(connect, RECONNECT_MS);
        };
      });
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [taskId, upsertTask]);
}
