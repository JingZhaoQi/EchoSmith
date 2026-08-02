"""Tests for URL download helper options."""

from __future__ import annotations

from pathlib import Path


def test_extract_video_title_uses_bilibili_safe_ytdlp_options(monkeypatch) -> None:
    from url_downloader import extract_video_title

    captured: list[dict] = []

    class FakeYoutubeDL:
        def __init__(self, opts: dict) -> None:
            captured.append(opts)

        def __enter__(self) -> "FakeYoutubeDL":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def extract_info(self, _url: str, download: bool = False) -> dict:
            assert download is False
            return {"title": "Bilibili title"}

    monkeypatch.setattr("yt_dlp.YoutubeDL", FakeYoutubeDL)

    assert (
        extract_video_title("https://www.bilibili.com/video/BV1rX4y1p7Nx")
        == "Bilibili title"
    )

    opts = captured[0]
    assert opts["socket_timeout"] == 15
    assert opts["extractor_retries"] == 2
    assert opts["http_headers"]["Referer"] == "https://www.bilibili.com/"
    assert "Mozilla/5.0" in opts["http_headers"]["User-Agent"]


def test_ytdlp_download_media_uses_bilibili_safe_options(
    monkeypatch, tmp_path: Path
) -> None:
    from url_downloader import _ytdlp_download_media

    captured: list[dict] = []

    class FakeYoutubeDL:
        def __init__(self, opts: dict) -> None:
            captured.append(opts)

        def __enter__(self) -> "FakeYoutubeDL":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def extract_info(self, _url: str, download: bool = False) -> dict:
            assert download is True
            outtmpl = captured[-1]["outtmpl"]
            Path(outtmpl.replace("%(ext)s", "mp3")).write_bytes(b"audio")
            return {"title": "Bilibili: test/video"}

    monkeypatch.setattr("yt_dlp.YoutubeDL", FakeYoutubeDL)

    result = _ytdlp_download_media(
        "https://b23.tv/example",
        tmp_path,
        "audio",
    )

    opts = captured[0]
    assert opts["socket_timeout"] == 15
    assert opts["retries"] == 3
    assert opts["fragment_retries"] == 3
    assert opts["http_headers"]["Referer"] == "https://www.bilibili.com/"
    assert result["filename"] == "Bilibili  test video.mp3"
