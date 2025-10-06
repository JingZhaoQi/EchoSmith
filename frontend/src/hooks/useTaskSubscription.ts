// WebSocket task subscription hook.
import { useEffect } from "react";

import { connectTaskStream, ensureBackendBase } from "../lib/api";
import { useTasksStore } from "./useTasksStore";

export function useTaskSubscription(taskId: string | null): void {
  const upsertTask = useTasksStore((state) => state.upsertTask);

  useEffect(() => {
    if (!taskId) return;

    let socket: WebSocket | null = null;
    let cancelled = false;

    ensureBackendBase().then(() => {
      if (cancelled) return;
      socket = connectTaskStream(taskId);
      socket.onopen = () => {
        console.log("✅ [WebSocket] 连接成功:", taskId);
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("📨 [WebSocket] 收到更新:", {
          taskId: data.id,
          status: data.status,
          progress: data.progress,
          message: data.message
        });
        upsertTask(data);
      };
      socket.onerror = (error) => {
        console.error("❌ [WebSocket] 连接错误:", error);
        socket?.close();
      };
      socket.onclose = () => {
        console.log("🔌 [WebSocket] 连接关闭:", taskId);
      };
    });

    return () => {
      cancelled = true;
      socket?.close();
    };
  }, [taskId, upsertTask]);
}
