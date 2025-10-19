// Transcription result viewer.
import { useEffect, useRef, useState } from "react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import type { TaskSnapshot, TaskStatus } from "../lib/api";
import { exportTask } from "../lib/api";
import { useTasksStore } from "../hooks/useTasksStore";

const FORMAT_LABELS: Array<{ format: "txt" | "srt" | "json"; label: string }> = [
  { format: "txt", label: "导出 TXT" },
  { format: "srt", label: "导出 SRT" },
  { format: "json", label: "导出 JSON" }
];

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  paused: "暂停中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已清空"
};

const EXPORTABLE_STATUSES: TaskStatus[] = ["paused", "completed", "failed", "cancelled"];
const SENTENCE_REGEX = /[^。！？!?…\n]+[。！？!?…]?/gu;

function msToTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")},${millis.toString().padStart(3, "0")}`;
}

function buildFallbackSegments(text: string | null | undefined): Array<{ start_ms: number; end_ms: number; text: string }>
{
  if (!text) return [];
  const sentences = Array.from(text.matchAll(SENTENCE_REGEX))
    .map((match) => match[0].trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    const duration = Math.max(2_000, text.length * 120);
    return [
      {
        start_ms: 0,
        end_ms: duration,
        text: text.trim()
      }
    ];
  }
  let cursor = 0;
  return sentences.map((sentence) => {
    const duration = Math.max(1_500, sentence.length * 120);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return {
      start_ms: start,
      end_ms: end,
      text: sentence
    };
  });
}

function currentSegments(task: TaskSnapshot): Array<{ start_ms: number; end_ms: number; text: string }>
{
  if (task.segments && task.segments.length > 0) {
    return task.segments.map((segment) => ({
      start_ms: segment.start_ms ?? 0,
      end_ms:
        segment.end_ms ??
        Math.max((segment.start_ms ?? 0) + 2_000, (segment.start_ms ?? 0) + Math.max(segment.text?.length ?? 1, 1) * 120),
      text: segment.text ?? ""
    }));
  }
  return buildFallbackSegments(task.result_text);
}

function buildSrt(task: TaskSnapshot): string {
  const segments = currentSegments(task);
  if (segments.length === 0) return "";
  return segments
    .map((segment, index) => {
      const start = msToTimestamp(segment.start_ms);
      const end = msToTimestamp(segment.end_ms);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
}

function getSourceBaseName(task: TaskSnapshot): string {
  const source = task.source ?? {};
  const candidate = ["name", "value"]
    .map((key) => {
      const raw = (source as Record<string, unknown>)[key];
      return typeof raw === "string" && raw.length > 0 ? raw : null;
    })
    .filter(Boolean)[0];
  const fallback = candidate ?? task.id;
  const parts = fallback.split(/[\\/]/);
  const last = parts[parts.length - 1] ?? task.id;
  return last;
}

function toDownloadName(task: TaskSnapshot, format: "txt" | "srt" | "json"): string {
  const base = getSourceBaseName(task);
  const withoutExt = base.includes(".") ? base.replace(/\.[^.]+$/, "") : base;
  return `${withoutExt || task.id}.${format}`;
}

export function ResultPanel(): JSX.Element {
  const { tasks, activeTaskId } = useTasksStore((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId
  }));
  const task = activeTaskId ? tasks[activeTaskId] : undefined;
  const [saving, setSaving] = useState<"txt" | "srt" | "json" | null>(null);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!resultRef.current) return;
    resultRef.current.scrollTop = resultRef.current.scrollHeight;
  }, [task?.result_text, task?.segments?.length, activeTaskId]);

  const handleCopy = async () => {
    if (!task) return;
    const textToCopy = task.result_text ?? "";
    try {
      setCopying(true);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } finally {
      setCopying(false);
    }
  };

  const handleExport = async (format: "txt" | "srt" | "json") => {
    console.log("🚀 导出函数被调用，格式:", format, "任务:", task?.id);
    if (!task) {
      console.error("❌ 没有任务，退出导出");
      return;
    }
    try {
      console.log("⏳ 开始导出流程...");
      setSaving(format);

      // 准备导出内容
      let content = "";
      let blob: Blob | null = null;

      try {
        console.log("📡 调用后端导出 API...");
        const responseBlob = await exportTask(task.id, format);
        console.log("📦 收到后端响应:", responseBlob);
        if (responseBlob instanceof Blob) {
          blob = responseBlob;
          content = await responseBlob.text();
          console.log("✅ 后端导出成功，内容长度:", content.length);
        }
      } catch (error) {
        console.warn("⚠️  后端导出失败，使用本地内容", error);
      }

      console.log("📝 当前内容长度:", content.length, "准备生成本地内容");

      if (!content) {
        if (format === "txt") {
          content = task.result_text ?? "";
          console.log("📄 使用本地 TXT 内容，长度:", content.length);
        } else if (format === "json") {
          const payload = {
            id: task.id,
            text: task.result_text ?? "",
            segments: currentSegments(task)
          };
          content = JSON.stringify(payload, null, 2);
          console.log("📄 生成 JSON 内容，长度:", content.length);
        } else {
          content = buildSrt(task);
          console.log("📄 生成 SRT 内容，长度:", content.length);
        }
      }

      console.log("🔢 最终内容长度:", content.length);

      if (!content) {
        console.error("❌ 内容为空！");
        throw new Error("未生成导出内容");
      }

      // 检测是否在 Tauri 环境中
      // Tauri 2.x 推荐使用 @tauri-apps/api/core 检测
      let isTauri = false;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        // 如果能导入 invoke，说明是 Tauri 环境
        isTauri = true;
      } catch {
        isTauri = false;
      }
      console.log("🌐 环境检测: isTauri =", isTauri);

      if (isTauri) {
        // 使用 Tauri 文件保存对话框
        console.log("🔍 检测到 Tauri 环境，准备打开文件保存对话框");
        try {
          console.log("📦 导入 @tauri-apps/plugin-dialog...");
          const { save } = await import("@tauri-apps/plugin-dialog");
          console.log("📦 导入 @tauri-apps/plugin-fs...");
          const { writeTextFile } = await import("@tauri-apps/plugin-fs");
          console.log("✅ Tauri 插件加载成功");

          const defaultFilename = toDownloadName(task, format);
          console.log("📁 默认文件名:", defaultFilename);

          const formatNames: Record<string, string> = {
            txt: "文本文件",
            srt: "字幕文件",
            json: "JSON 文件"
          };

          const filePath = await save({
            title: `保存${formatNames[format] || "文件"}`,
            defaultPath: defaultFilename,
            filters: [
              {
                name: formatNames[format] || format.toUpperCase(),
                extensions: [format]
              }
            ]
          });

          console.log("💾 用户选择的路径:", filePath);

          if (filePath) {
            await writeTextFile(filePath, content);
            console.log(`✅ 文件已保存到: ${filePath}`);
          } else {
            console.log("ℹ️  用户取消了保存");
          }
        } catch (tauriError) {
          console.error("❌ Tauri 文件保存失败:", tauriError);
          throw tauriError;
        }
      } else {
        // 浏览器环境：使用 Blob 下载
        if (!blob) {
          const mimeTypes = {
            txt: "text/plain;charset=utf-8",
            json: "application/json;charset=utf-8",
            srt: "application/x-subrip;charset=utf-8"
          };
          blob = new Blob([content], { type: mimeTypes[format] });
        }

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = toDownloadName(task, format);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("导出失败", error);
      window.alert("导出失败，请稍后再试");
    } finally {
      setSaving(null);
    }
  };

  const isPaused = Boolean(task && (task.status === "paused" || task.message?.includes("暂停")));
  const canExport = Boolean(task && (isPaused || EXPORTABLE_STATUSES.includes(task.status)));

  useEffect(() => {
    console.log("🎯 [ResultPanel] 状态:", {
      任务ID: task?.id,
      任务状态: task?.status,
      isPaused,
      canExport,
      saving,
      导出按钮禁用: !canExport || saving !== null
    });
  }, [task?.id, task?.status, isPaused, canExport, saving]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">转写结果</h2>
        <span className="text-xs text-muted-foreground">
          {task
            ? `${(task.progress * 100).toFixed(0)}% · ${STATUS_LABELS[task.status] ?? task.status}`
            : "等待任务"}
        </span>
      </div>
      <div
        ref={resultRef}
        className="h-60 rounded-lg border border-border bg-muted/40 p-4 text-sm overflow-y-auto whitespace-pre-wrap"
      >
        {task?.result_text ? task.result_text : "正在等待任务..."}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button
          variant="secondary"
          disabled={!task || copying}
          onClick={handleCopy}
        >
          {copied ? "已复制" : copying ? "复制中..." : "复制结果"}
        </Button>
        {FORMAT_LABELS.map(({ format, label }) => (
          <Button
            key={format}
            variant="secondary"
            disabled={!canExport || saving !== null}
            onClick={() => handleExport(format)}
            className="w-24"
          >
            {saving === format ? (
              <span className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                导出中
              </span>
            ) : (
              label
            )}
          </Button>
        ))}
      </div>
    </Card>
  );
}
