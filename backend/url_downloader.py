"""Download audio from online video URLs via yt-dlp (+ Douyin fallback)."""

from __future__ import annotations

import json
import logging
import platform
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Callable, Optional

import requests
import yt_dlp


def _subprocess_kwargs() -> dict:
    """Return extra kwargs for subprocess.run() on Windows GUI apps.

    Prevents console-window flash, stdin hangs, and encoding errors.
    """
    kwargs: dict = {
        "stdin": subprocess.DEVNULL,
        "capture_output": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    return kwargs

log = logging.getLogger(__name__)

DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "echosmith_uploads"

# Browsers to try for cookie extraction, ordered by platform preference.
_BROWSER_ORDER = (
    ("chrome", "firefox", "brave", "edge")
    if platform.system() == "Darwin"
    else ("chrome", "firefox", "edge", "brave")
)

_AUTH_ERROR_RE = re.compile(
    r"Sign in to confirm|not a bot|cookies|login required|Requested format is not available",
    re.IGNORECASE,
)

# Douyin / TikTok China short-link and canonical patterns
_DOUYIN_RE = re.compile(
    r"https?://(?:v\.douyin\.com|www\.douyin\.com|www\.iesdouyin\.com)/", re.IGNORECASE
)

_URL_RE = re.compile(r"https?://[^\s<>\"']+")


def extract_url_from_text(text: str) -> str:
    """Extract first HTTP(S) URL from arbitrary text (e.g. Douyin share text)."""
    m = _URL_RE.search(text)
    return m.group(0).rstrip(",.;:!?。，；：！？") if m else text


def extract_video_title(url: str) -> str:
    """Extract video title without downloading.  Never raises."""
    if _DOUYIN_RE.search(url):
        try:
            return _douyin_extract_title(url)
        except Exception:
            return ""
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
      0. If Douyin URL, use custom scraper (yt-dlp Douyin extractor needs cookies).
      1. Try plain download (works for Bilibili, Twitter, etc.)
      2. If the error looks auth-related, retry with browser cookies.
    """
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # --- Douyin fast path ---
    if _DOUYIN_RE.search(url):
        return _douyin_download(url, task_id, progress_cb, cancelled_checker)

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


# ── Douyin helpers ──────────────────────────────────────────────────

_DOUYIN_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.0 Mobile/15E148 Safari/604.1"
)
_DOUYIN_VIDEO_ID_RE = re.compile(r"/video/(\d+)")


def _douyin_resolve_video_id(url: str) -> str:
    """Follow redirects to extract the numeric video ID."""
    m = _DOUYIN_VIDEO_ID_RE.search(url)
    if m:
        return m.group(1)
    # Short link: follow redirect chain
    r = requests.get(
        url,
        allow_redirects=True,
        headers={"User-Agent": _DOUYIN_MOBILE_UA},
        timeout=10,
    )
    m = _DOUYIN_VIDEO_ID_RE.search(r.url)
    if m:
        return m.group(1)
    # Also check intermediate redirects
    for resp in r.history:
        m = _DOUYIN_VIDEO_ID_RE.search(resp.headers.get("Location", ""))
        if m:
            return m.group(1)
    raise RuntimeError(f"无法从抖音链接中提取视频 ID: {url}")


def _douyin_fetch_video_info(video_id: str) -> dict:
    """Fetch video metadata from Douyin mobile share page."""
    headers = {
        "User-Agent": _DOUYIN_MOBILE_UA,
        "Referer": "https://www.douyin.com/",
    }
    r = requests.get(
        f"https://www.iesdouyin.com/share/video/{video_id}/",
        headers=headers,
        timeout=15,
    )
    r.raise_for_status()

    m = re.search(
        r"window\._ROUTER_DATA\s*=\s*({.*?})\s*</script>", r.text, re.DOTALL
    )
    if not m:
        raise RuntimeError("无法解析抖音页面数据")

    data = json.loads(m.group(1).replace("\\u002F", "/"))
    page_data = data.get("loaderData", {}).get("video_(id)/page", {})
    s = json.dumps(page_data, ensure_ascii=False)

    # Extract play URL
    play_match = re.search(
        r'"play_addr".*?"url_list"\s*:\s*\[(.*?)\]', s, re.DOTALL
    )
    if not play_match:
        raise RuntimeError("无法获取抖音视频播放地址")
    urls = json.loads("[" + play_match.group(1) + "]")
    video_url = urls[0] if urls else ""
    if not video_url:
        raise RuntimeError("抖音视频播放地址为空")

    title_match = re.search(r'"desc"\s*:\s*"([^"]*)"', s)
    title = title_match.group(1) if title_match else ""

    return {"video_url": video_url, "title": title}


def _douyin_extract_title(url: str) -> str:
    """Extract title from Douyin URL without downloading."""
    video_id = _douyin_resolve_video_id(url)
    info = _douyin_fetch_video_info(video_id)
    return info.get("title", "")


def _douyin_download(
    url: str,
    task_id: str,
    progress_cb: Optional[Callable[[float, str], None]] = None,
    cancelled_checker: Optional[Callable[[], bool]] = None,
) -> str:
    """Download audio from Douyin by scraping the mobile share page."""
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    if progress_cb:
        progress_cb(0.0, "解析抖音链接…")

    video_id = _douyin_resolve_video_id(url)
    if cancelled_checker and cancelled_checker():
        raise _DownloadCancelled()

    info = _douyin_fetch_video_info(video_id)
    video_url = info["video_url"]

    if progress_cb:
        progress_cb(0.05, "下载抖音视频…")

    # Stream download the video
    mp4_path = DOWNLOAD_DIR / f"{task_id}.mp4"
    headers = {
        "User-Agent": _DOUYIN_MOBILE_UA,
        "Referer": "https://www.douyin.com/",
    }
    with requests.get(video_url, headers=headers, stream=True, timeout=30) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        with open(mp4_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                if cancelled_checker and cancelled_checker():
                    mp4_path.unlink(missing_ok=True)
                    raise _DownloadCancelled()
                f.write(chunk)
                downloaded += len(chunk)
                if progress_cb and total > 0:
                    ratio = downloaded / total
                    progress_cb(ratio * 0.9, f"下载中 {ratio:.0%}")

    if progress_cb:
        progress_cb(0.9, "提取音频…")

    # Convert to WAV using ffmpeg
    wav_path = DOWNLOAD_DIR / f"{task_id}.wav"
    cmd = [
        "ffmpeg", "-y", "-nostdin", "-i", str(mp4_path),
        "-ac", "1", "-ar", "16000", str(wav_path),
    ]
    result = subprocess.run(cmd, **_subprocess_kwargs())
    mp4_path.unlink(missing_ok=True)

    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg 转换失败: {result.stderr.strip()}")

    if progress_cb:
        progress_cb(1.0, "下载完成")

    return str(wav_path)


# ── Media download (save to user directory) ─────────────────────────


def _sanitize_filename(name: str) -> str:
    """Remove characters that are invalid in file names."""
    name = re.sub(r'[\\/:*?"<>|\n\r]', " ", name).strip()
    return name[:200] if name else "download"


ProgressCb = Optional[Callable[[float, str], None]]


def download_media(
    url: str, save_dir: str, mode: str = "video", progress_cb: ProgressCb = None,
) -> dict:
    """Download video or audio-only to *save_dir*. Returns {filename, path}."""
    save_path = Path(save_dir)
    save_path.mkdir(parents=True, exist_ok=True)

    if _DOUYIN_RE.search(url):
        return _douyin_download_media(url, save_path, mode, progress_cb)

    return _ytdlp_download_media(url, save_path, mode, progress_cb)


def _ytdlp_download_media(
    url: str, save_path: Path, mode: str, progress_cb: ProgressCb = None,
) -> dict:
    """Download via yt-dlp to save_path."""
    tmp_id = uuid.uuid4().hex[:8]
    outtmpl = str(save_path / f"_tmp_{tmp_id}.%(ext)s")

    def _hook(d: dict) -> None:
        if not progress_cb:
            return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            ratio = downloaded / total if total > 0 else 0.0
            progress_cb(ratio * 0.9, f"下载中 {ratio:.0%}")
        elif d.get("status") == "finished":
            progress_cb(0.9, "合并/转码中…")

    opts: dict = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "progress_hooks": [_hook],
    }

    if mode == "audio":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "0",
            }
        ]
    else:
        opts["format"] = "bv*+ba/b"
        opts["merge_output_format"] = "mp4"

    last_err: Exception | None = None
    for attempt_opts in _ytdlp_attempt_opts(opts):
        try:
            with yt_dlp.YoutubeDL(attempt_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = _sanitize_filename((info or {}).get("title", "") or tmp_id)
            break
        except Exception as e:
            last_err = e
            for f in save_path.glob(f"_tmp_{tmp_id}.*"):
                f.unlink(missing_ok=True)
            if not _AUTH_ERROR_RE.search(str(e)):
                raise
    else:
        err_str = str(last_err)
        if _AUTH_ERROR_RE.search(err_str) or "Sign in" in err_str:
            raise RuntimeError(
                "该视频需要登录认证才能下载。"
                "请在 Chrome 浏览器中登录 YouTube，然后重试。"
            )
        raise RuntimeError(f"下载失败: {last_err}")

    # Rename temp files to title-based name
    for f in save_path.glob(f"_tmp_{tmp_id}.*"):
        final_name = f"{title}.{f.suffix.lstrip('.')}"
        final_path = save_path / final_name
        counter = 1
        while final_path.exists():
            final_path = save_path / f"{title} ({counter}).{f.suffix.lstrip('.')}"
            counter += 1
        f.rename(final_path)
        if progress_cb:
            progress_cb(1.0, "完成")
        return {"filename": final_path.name, "path": str(final_path)}

    raise FileNotFoundError("下载完成但未找到输出文件")


def _ytdlp_attempt_opts(base_opts: dict):
    """Generate option dicts: plain first, then with browser cookies."""
    yield base_opts
    for browser in _BROWSER_ORDER:
        cookie_opts = dict(base_opts)
        cookie_opts["cookiesfrombrowser"] = (browser,)
        yield cookie_opts


def _douyin_download_media(
    url: str, save_path: Path, mode: str, progress_cb: ProgressCb = None,
) -> dict:
    """Download Douyin video or audio to save_path."""
    if progress_cb:
        progress_cb(0.0, "解析抖音链接…")

    video_id = _douyin_resolve_video_id(url)
    info = _douyin_fetch_video_info(video_id)
    video_url = info["video_url"]
    title = _sanitize_filename(info.get("title", "") or f"douyin_{video_id}")

    headers = {
        "User-Agent": _DOUYIN_MOBILE_UA,
        "Referer": "https://www.douyin.com/",
    }

    # Download the video
    mp4_path = save_path / f"{title}.mp4"
    counter = 1
    while mp4_path.exists():
        mp4_path = save_path / f"{title} ({counter}).mp4"
        counter += 1

    with requests.get(video_url, headers=headers, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        downloaded = 0
        with open(mp4_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                f.write(chunk)
                downloaded += len(chunk)
                if progress_cb and total > 0:
                    ratio = downloaded / total
                    progress_cb(ratio * 0.9, f"下载中 {ratio:.0%}")

    if mode == "audio":
        if progress_cb:
            progress_cb(0.9, "转码中…")
        # Extract audio to mp3
        mp3_path = mp4_path.with_suffix(".mp3")
        cmd = [
            "ffmpeg", "-y", "-nostdin", "-i", str(mp4_path),
            "-vn", "-acodec", "libmp3lame", "-q:a", "0", str(mp3_path),
        ]
        result = subprocess.run(cmd, **_subprocess_kwargs())
        mp4_path.unlink(missing_ok=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 音频提取失败: {result.stderr.strip()}")
        if progress_cb:
            progress_cb(1.0, "完成")
        return {"filename": mp3_path.name, "path": str(mp3_path)}

    if progress_cb:
        progress_cb(1.0, "完成")
    return {"filename": mp4_path.name, "path": str(mp4_path)}


# ── Shared helpers ──────────────────────────────────────────────────


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
