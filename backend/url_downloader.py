"""Download audio from online video URLs via yt-dlp."""

from __future__ import annotations

import logging
import platform
import re
import tempfile
from pathlib import Path
from typing import Callable, Optional

import yt_dlp

log = logging.getLogger(__name__)

DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "echosmith_uploads"

# Browsers to try for cookie extraction, ordered by platform preference.
_BROWSER_ORDER = (
    ("chrome", "firefox", "brave", "edge")
    if platform.system() == "Darwin"
    else ("chrome", "firefox", "edge", "brave")
)

_AUTH_ERROR_RE = re.compile(
    r"Sign in to confirm|not a bot|cookies|login required", re.IGNORECASE
)


def extract_video_title(url: str) -> str:
    """Extract video title without downloading.  Never raises."""
    opts: dict = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return (info or {}).get("title", "") or ""
    except Exception:
        return ""


def download_audio(
    url: str,
    task_id: str,
    progress_cb: Optional[Callable[[float, str], None]] = None,
    cancelled_checker: Optional[Callable[[], bool]] = None,
) -> str:
    """Download audio track from *url* and return the local file path.

    Strategy:
      1. Try plain download (works for Bilibili, Twitter, etc.)
      2. If the error looks auth-related, retry with browser cookies.
    """
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    output_template = str(DOWNLOAD_DIR / f"{task_id}.%(ext)s")

    def _progress_hook(d: dict) -> None:
        if cancelled_checker and cancelled_checker():
            raise _DownloadCancelled()

        if d.get("status") == "downloading" and progress_cb:
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            ratio = downloaded / total if total > 0 else 0.0
            progress_cb(ratio, f"下载中 {ratio:.0%}")

        if d.get("status") == "finished" and progress_cb:
            progress_cb(1.0, "下载完成，提取音频中…")

    base_opts: dict = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
                "preferredquality": "0",
            }
        ],
        "progress_hooks": [_progress_hook],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }

    # --- Attempt 1: plain (no cookies) ---
    try:
        with yt_dlp.YoutubeDL(base_opts) as ydl:
            ydl.download([url])
        return _find_result(task_id)
    except _DownloadCancelled:
        raise
    except Exception as first_err:
        if not _AUTH_ERROR_RE.search(str(first_err)):
            raise  # Not auth-related → surface immediately

    # --- Attempt 2: retry with browser cookies ---
    log.info("Auth required, retrying with browser cookies…")
    if progress_cb:
        progress_cb(0.0, "需要认证，尝试读取浏览器登录状态…")

    # Clean partial files from first attempt
    for leftover in DOWNLOAD_DIR.glob(f"{task_id}.*"):
        leftover.unlink(missing_ok=True)

    last_err: Optional[Exception] = None
    for browser in _BROWSER_ORDER:
        try:
            cookie_opts = dict(base_opts)
            cookie_opts["cookiesfrombrowser"] = (browser,)
            with yt_dlp.YoutubeDL(cookie_opts) as ydl:
                ydl.download([url])
            return _find_result(task_id)
        except _DownloadCancelled:
            raise
        except Exception as e:
            last_err = e
            log.debug("Browser %s failed: %s", browser, e)
            # Clean partial files before next attempt
            for leftover in DOWNLOAD_DIR.glob(f"{task_id}.*"):
                leftover.unlink(missing_ok=True)
            continue

    raise RuntimeError(
        "该平台需要登录认证才能下载。"
        "请在浏览器中登录对应网站（如 YouTube），然后重试。\n"
        f"原始错误：{last_err}"
    )


def _find_result(task_id: str) -> str:
    """Locate the downloaded WAV (or fallback) and return its path."""
    result_path = DOWNLOAD_DIR / f"{task_id}.wav"
    if result_path.exists():
        return str(result_path)
    candidates = list(DOWNLOAD_DIR.glob(f"{task_id}.*"))
    if not candidates:
        raise FileNotFoundError(f"Downloaded audio not found for task {task_id}")
    return str(candidates[0])


class _DownloadCancelled(Exception):
    """Raised internally to abort a yt-dlp download."""
