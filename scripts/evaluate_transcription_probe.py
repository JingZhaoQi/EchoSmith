#!/usr/bin/env python3
"""Evaluate EchoSmith transcription accuracy and throughput against a probe."""

from __future__ import annotations

import argparse
import asyncio
import json
import platform
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from asr_engine import ASREngine  # noqa: E402
from asr_models import DEFAULT_ASR_MODEL_ID  # noqa: E402
from correction_engine import CorrectionEngine  # noqa: E402
from hotwords import HotwordManager  # noqa: E402
from settings import SettingsManager  # noqa: E402
from transcription_metrics import (  # noqa: E402
    character_accuracy,
    chars_per_minute,
    normalize_transcript,
    passes_thresholds,
)

DEFAULT_CORRECTION_CHUNK_CHARS = 700
DEFAULT_MAX_PARALLEL_CORRECTIONS = 4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run or score an EchoSmith transcription probe."
    )
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--hypothesis", type=Path)
    parser.add_argument("--audio", type=Path)
    parser.add_argument("--output-transcript", type=Path)
    parser.add_argument(
        "--source-elapsed-seconds",
        type=float,
        help="Elapsed seconds already spent producing --hypothesis.",
    )
    parser.add_argument(
        "--correction-chunk-chars",
        type=int,
        default=DEFAULT_CORRECTION_CHUNK_CHARS,
    )
    parser.add_argument(
        "--max-parallel-corrections",
        type=int,
        default=DEFAULT_MAX_PARALLEL_CORRECTIONS,
    )
    parser.add_argument("--language", default="zh", choices=["zh", "en"])
    parser.add_argument(
        "--cloud-correction",
        action="store_true",
        help="Use the configured app correction API key and force cloud_api mode.",
    )
    parser.add_argument("--asr-model", default=DEFAULT_ASR_MODEL_ID)
    parser.add_argument("--min-accuracy", type=float, default=0.95)
    parser.add_argument("--min-chars-per-min", type=float, default=2000)
    return parser.parse_args()


def app_support_dir() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.echosmith.app"
    if platform.system() == "Windows":
        import os

        appdata = os.environ.get("APPDATA", "")
        if appdata:
            return Path(appdata) / "echosmith"
    return Path.home() / ".config" / "echosmith"


def build_cloud_correction_engine(args: argparse.Namespace) -> CorrectionEngine | None:
    if not args.cloud_correction:
        return None

    support_dir = app_support_dir()
    settings = SettingsManager(support_dir / "settings.json").get()
    cfg = settings.correction
    if not cfg.api_key:
        raise RuntimeError(
            "cloud correction requested, but app settings has no API key"
        )

    hotwords = HotwordManager(support_dir / "hotwords.json").list_all()
    return CorrectionEngine(
        mode="cloud_api",
        hot_words=hotwords,
        api_provider=cfg.api_provider,
        api_key=cfg.api_key,
        api_model=cfg.api_model,
        api_base_url=cfg.api_base_url,
    )


async def transcribe_audio(args: argparse.Namespace) -> tuple[str, float, int]:
    if not args.audio:
        raise ValueError("--audio is required when --hypothesis is omitted")

    engine = ASREngine(
        language=args.language,
        correction_engine=build_cloud_correction_engine(args),
        asr_model=args.asr_model,
    )

    def progress(_value: float, stage: str, _partial: str) -> None:
        print(stage, file=sys.stderr, flush=True)

    started = time.perf_counter()
    result = await engine.transcribe(args.audio, progress_cb=progress)
    elapsed = time.perf_counter() - started
    return result.text, elapsed, result.duration_ms


def read_existing_hypothesis(
    args: argparse.Namespace,
) -> tuple[str, float | None, None]:
    assert args.hypothesis is not None
    text = args.hypothesis.read_text(encoding="utf-8")
    correction_elapsed = None
    if args.cloud_correction:
        engine = build_cloud_correction_engine(args)
        assert engine is not None
        started = time.perf_counter()
        text = cloud_correct_text(text, engine, args)
        correction_elapsed = time.perf_counter() - started
    elapsed = args.source_elapsed_seconds
    if correction_elapsed is not None:
        elapsed = (elapsed or 0.0) + correction_elapsed
    return text, elapsed, None


def cloud_correct_text(
    text: str, engine: CorrectionEngine, args: argparse.Namespace
) -> str:
    chunks = split_text_for_correction(text, args.correction_chunk_chars)
    if not chunks:
        return text

    contexts: list[str] = []
    preceding = ""
    for chunk in chunks:
        contexts.append(preceding[-500:])
        preceding = (preceding + chunk)[-500:]

    corrected_chunks: list[str | None] = [None] * len(chunks)

    def correct_chunk(index: int) -> tuple[int, str]:
        corrected = engine.correct([chunks[index]], preceding_text=contexts[index])
        return index, corrected[0] if corrected else chunks[index]

    max_workers = max(1, min(args.max_parallel_corrections, len(chunks)))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(correct_chunk, index) for index in range(len(chunks))]
        for future in as_completed(futures):
            index, corrected = future.result()
            corrected_chunks[index] = corrected

    return "".join(
        corrected if corrected is not None else original
        for original, corrected in zip(chunks, corrected_chunks)
    )


def split_text_for_correction(text: str, chunk_chars: int) -> list[str]:
    chunks: list[str] = []
    chunk_chars = max(200, chunk_chars)
    start = 0
    while start < len(text):
        end = min(start + chunk_chars, len(text))
        if end < len(text):
            sentence_end = max(
                text.rfind(mark, start, end)
                for mark in ("。", "！", "？", "!", "?", "\n")
            )
            if sentence_end > start + chunk_chars // 2:
                end = sentence_end + 1
        chunks.append(text[start:end])
        start = end
    return [chunk for chunk in chunks if chunk]


def main() -> None:
    args = parse_args()
    reference = args.reference.read_text(encoding="utf-8")

    if args.hypothesis:
        hypothesis, elapsed_seconds, duration_ms = read_existing_hypothesis(args)
    else:
        hypothesis, elapsed_seconds, duration_ms = asyncio.run(transcribe_audio(args))

    if args.output_transcript:
        args.output_transcript.parent.mkdir(parents=True, exist_ok=True)
        args.output_transcript.write_text(hypothesis, encoding="utf-8")

    accuracy = character_accuracy(reference, hypothesis)
    recognized_chars = len(normalize_transcript(hypothesis))
    speed = (
        chars_per_minute(recognized_chars, elapsed_seconds)
        if elapsed_seconds is not None
        else None
    )
    passes_accuracy = accuracy.accuracy >= args.min_accuracy
    passes_speed = speed >= args.min_chars_per_min if speed is not None else None
    passes_all = (
        passes_thresholds(
            accuracy=accuracy.accuracy,
            chars_per_min=speed,
            min_accuracy=args.min_accuracy,
            min_chars_per_min=args.min_chars_per_min,
        )
        if speed is not None
        else None
    )

    payload: dict[str, Any] = {
        "reference": str(args.reference),
        "hypothesis": str(args.hypothesis) if args.hypothesis else None,
        "audio": str(args.audio) if args.audio else None,
        "output_transcript": (
            str(args.output_transcript) if args.output_transcript else None
        ),
        "accuracy": round(accuracy.accuracy, 6),
        "cer": round(accuracy.cer, 6),
        "edit_distance": accuracy.edit_distance,
        "reference_chars": accuracy.reference_chars,
        "hypothesis_chars": accuracy.hypothesis_chars,
        "recognized_chars": recognized_chars,
        "elapsed_seconds": (
            round(elapsed_seconds, 3) if elapsed_seconds is not None else None
        ),
        "chars_per_minute": round(speed, 2) if speed is not None else None,
        "audio_duration_ms": duration_ms,
        "passes_accuracy": passes_accuracy,
        "passes_speed": passes_speed,
        "passes_all": passes_all,
        "cloud_correction": cloud_correction_snapshot(args),
        "thresholds": {
            "min_accuracy": args.min_accuracy,
            "min_chars_per_minute": args.min_chars_per_min,
        },
        "preview": hypothesis[:500],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def cloud_correction_snapshot(args: argparse.Namespace) -> dict[str, Any]:
    if not args.cloud_correction:
        return {"enabled": False}
    support_dir = app_support_dir()
    settings = SettingsManager(support_dir / "settings.json").get()
    cfg = settings.correction
    return {
        "enabled": True,
        "source": str(support_dir / "settings.json"),
        "provider": cfg.api_provider,
        "model": cfg.api_model,
        "base_url_set": bool(cfg.api_base_url),
        "api_key_set": bool(cfg.api_key),
    }


if __name__ == "__main__":
    main()
