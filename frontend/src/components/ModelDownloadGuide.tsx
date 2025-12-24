import { useState } from "react";
import { fetchHealth, triggerModelDownload } from "../lib/api";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";

interface ModelDownloadGuideProps {
  onComplete: () => void;
}

export function ModelDownloadGuide({ onComplete }: ModelDownloadGuideProps) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const startDownload = async () => {
    setDownloading(true);
    setError("");
    setMessage("正在连接后端...");
    setProgress(0);

    try {
      console.log("[ModelDownload] Triggering download...");

      // Trigger download with backend base resolved by helper
      const { status } = await triggerModelDownload();
      console.log("[ModelDownload] Response status:", status);

      if (status === "already_exists") {
        setMessage("模型已存在");
        setTimeout(() => onComplete(), 1000);
        return;
      }

      if (status === "already_downloading") {
        setMessage("模型正在下载中…");
      } else if (status !== "started") {
        setError(`下载未启动: ${status ?? "无响应"}`);
        setDownloading(false);
        return;
      }

      setMessage("已启动下载，正在获取进度...");
      let pollCount = 0;
      const maxPolls = 600; // 10 minutes with 1s interval

      // Poll for download progress
      const pollInterval = setInterval(async () => {
        pollCount++;

        if (pollCount > maxPolls) {
          clearInterval(pollInterval);
          setError("下载超时（10分钟），请重试");
          setDownloading(false);
          return;
        }

        try {
          const { model_downloading, models, download_progress, download_message } = await fetchHealth();

          console.log(`[ModelDownload] Poll ${pollCount}: downloading=${model_downloading}, models=${models}, progress=${download_progress}`);

          if (models) {
            setProgress(100);
            setMessage("模型下载完成！");
            clearInterval(pollInterval);
            setTimeout(() => onComplete(), 1500);
          } else if (model_downloading) {
            // Use real progress from backend
            const realProgress = Math.round((download_progress || 0) * 100);
            setProgress(realProgress);
            setMessage(download_message || "正在下载模型...");
          } else if (!model_downloading && pollCount > 5 && !models) {
            // Download stopped but models don't exist - likely failed
            setError(download_message || "下载失败");
            setDownloading(false);
            clearInterval(pollInterval);
          }
        } catch (err) {
          console.error("[ModelDownload] Poll error:", err);
          // Don't stop polling on single error
        }
      }, 1000);

    } catch (err: unknown) {
      console.error("[ModelDownload] Start error:", err);
      const withDetail = err as { response?: { data?: { detail?: string } }; message?: string };
      const errorMsg =
        withDetail.response?.data?.detail ||
        withDetail.message ||
        "下载失败，请检查网络连接";
      setError(errorMsg);
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-indigo-50/20 dark:to-indigo-950/20 p-6">
      <Card className="max-w-2xl w-full p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-2">欢迎使用闻见 · EchoSmith</h1>
          <p className="text-muted-foreground">
            首次使用需要下载语音识别模型（约 1.5GB）
          </p>
        </div>

        {!downloading && !error && (
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm">
                <strong>下载说明：</strong>
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>模型将保存在：~/.cache/modelscope/hub/</li>
                <li>包含语音识别、VAD 和标点模型</li>
                <li>下载时间取决于您的网络速度</li>
                <li>下载完成后即可开始使用</li>
              </ul>
            </div>

            <Button
              onClick={startDownload}
              className="w-full"
              size="lg"
            >
              开始下载模型
            </Button>
          </div>
        )}

        {downloading && (
          <div className="space-y-4">
            <Progress value={progress} className="h-2" />
            <p className="text-center text-sm text-muted-foreground">
              {message} {progress > 0 && `(${progress}%)`}
            </p>
            <p className="text-xs text-center text-muted-foreground">
              请耐心等待，下载可能需要几分钟...
            </p>
          </div>
        )}

        {error && (
        <div className="space-y-4">
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
          <Button
            onClick={startDownload}
            className="w-full"
            variant="secondary"
          >
            重新下载
          </Button>
        </div>
      )}
      </Card>
    </div>
  );
}
