"""Local ASR model catalog and download helpers."""
from __future__ import annotations

import os
import platform
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

DEFAULT_ASR_MODEL_ID = "sensevoice-sherpa-2024"
READY_MARKER = ".echosmith-model-ready"
INCOMPLETE_MARKER = ".echosmith-download-incomplete"
SIZE_IGNORED_FILES = {READY_MARKER, INCOMPLETE_MARKER}


@dataclass(frozen=True)
class ASRModelSpec:
    id: str
    label: str
    provider: str
    description: str
    size_hint: str
    estimated_size_bytes: int
    dependency: str
    source: str
    repo_id: str
    hub: str
    hf_repo_id: str | None = None
    recommended: bool = False
    experimental: bool = False


MODEL_SPECS: tuple[ASRModelSpec, ...] = (
    ASRModelSpec(
        id=DEFAULT_ASR_MODEL_ID,
        label="SenseVoice INT8",
        provider="sherpa",
        description="当前稳定默认模型，速度快，适合普通中文/英文媒体转写。",
        size_hint="~240 MB",
        estimated_size_bytes=240_000_000,
        dependency="内置 sherpa-onnx",
        source="sherpa-onnx",
        repo_id="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        hub="sherpa",
        recommended=True,
    ),
    ASRModelSpec(
        id="qwen3-asr-0.6b",
        label="Qwen3-ASR 0.6B",
        provider="qwen3",
        description="Qwen3-ASR 轻量高准确率路线，支持多语言和方言。",
        size_hint="0.6B 参数",
        estimated_size_bytes=1_880_000_000,
        dependency="需要 qwen-asr",
        source="ModelScope / Hugging Face",
        repo_id="Qwen/Qwen3-ASR-0.6B",
        hub="modelscope",
        hf_repo_id="Qwen/Qwen3-ASR-0.6B",
        recommended=True,
        experimental=True,
    ),
    ASRModelSpec(
        id="qwen3-asr-1.7b",
        label="Qwen3-ASR 1.7B",
        provider="qwen3",
        description="更高准确率的 Qwen3-ASR 模型，资源占用更高。",
        size_hint="1.7B 参数",
        estimated_size_bytes=4_700_000_000,
        dependency="需要 qwen-asr",
        source="ModelScope / Hugging Face",
        repo_id="Qwen/Qwen3-ASR-1.7B",
        hub="modelscope",
        hf_repo_id="Qwen/Qwen3-ASR-1.7B",
        experimental=True,
    ),
    ASRModelSpec(
        id="funasr-sensevoice-small",
        label="FunASR SenseVoiceSmall",
        provider="funasr",
        description="FunASR 集成的 SenseVoiceSmall，支持情绪/事件等扩展能力。",
        size_hint="~234M 参数",
        estimated_size_bytes=944_000_000,
        dependency="需要 funasr",
        source="ModelScope / Hugging Face",
        repo_id="iic/SenseVoiceSmall",
        hub="modelscope",
        hf_repo_id="FunAudioLLM/SenseVoiceSmall",
        experimental=True,
    ),
    ASRModelSpec(
        id="funasr-paraformer-zh",
        label="FunASR Paraformer zh",
        provider="funasr",
        description="中文 Paraformer 路线，适合中文长音频和热词增强。",
        size_hint="~890 MB",
        estimated_size_bytes=890_000_000,
        dependency="需要 funasr",
        source="ModelScope / Hugging Face",
        repo_id="iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        hub="modelscope",
        hf_repo_id="funasr/paraformer-zh",
        recommended=True,
        experimental=True,
    ),
    ASRModelSpec(
        id="funasr-nano",
        label="Fun-ASR-Nano",
        provider="funasr",
        description="FunASR 多语言路线，兼顾速度和结构化输出。",
        size_hint="~800M 参数",
        estimated_size_bytes=1_990_000_000,
        dependency="需要 funasr",
        source="Hugging Face / ModelScope",
        repo_id="FunAudioLLM/Fun-ASR-Nano-2512",
        hub="huggingface",
        hf_repo_id="FunAudioLLM/Fun-ASR-Nano-2512",
        experimental=True,
    ),
)


def format_bytes(size: int | None) -> str:
    if not size:
        return "未知"
    units = ("B", "KB", "MB", "GB", "TB")
    value = float(size)
    index = 0
    while value >= 1000 and index < len(units) - 1:
        value /= 1000
        index += 1
    if index == 0:
        return f"{int(value)} {units[index]}"
    return f"{value:.2f}".rstrip("0").rstrip(".") + f" {units[index]}"


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for item in path.rglob("*"):
        if item.is_file() and item.name not in SIZE_IGNORED_FILES:
            total += item.stat().st_size
    return total


def _has_core_model_files(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    config_exists = any((path / name).exists() for name in ("config.json", "configuration.json"))
    weight_exists = any(
        item.is_file()
        and (
            item.name.endswith((".safetensors", ".bin", ".pt", ".pth", ".onnx"))
            or item.name in {"model.pb", "am.mvn"}
        )
        for item in path.rglob("*")
    )
    return config_exists and weight_exists


def _looks_like_complete_legacy_download(path: Path, spec: ASRModelSpec) -> bool:
    if not _has_core_model_files(path):
        return False
    if not spec.estimated_size_bytes:
        return False
    return directory_size(path) >= int(spec.estimated_size_bytes * 0.85)


def get_model_spec(model_id: str) -> ASRModelSpec:
    for spec in MODEL_SPECS:
        if spec.id == model_id:
            return spec
    raise KeyError(f"未知 ASR 模型: {model_id}")


def is_valid_model_id(model_id: object) -> bool:
    return isinstance(model_id, str) and any(spec.id == model_id for spec in MODEL_SPECS)


def sanitize_model_id(model_id: object) -> str:
    return model_id if is_valid_model_id(model_id) else DEFAULT_ASR_MODEL_ID


def is_sherpa_model(model_id: str) -> bool:
    return get_model_spec(sanitize_model_id(model_id)).provider == "sherpa"


def default_model_cache_root() -> Path:
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local) / "echosmith" / "asr-models"
    return Path.home() / ".cache" / "echosmith" / "asr-models"


def default_sherpa_model_dir() -> Path:
    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local) / "sherpa-onnx" / "sense-voice"
    return Path.home() / ".cache" / "sherpa-onnx" / "sense-voice"


class ASRModelManager:
    def __init__(self, cache_root: Path | None = None) -> None:
        self.cache_root = cache_root or default_model_cache_root()

    def model_dir(self, model_id: str) -> Path:
        spec = get_model_spec(model_id)
        if spec.id == DEFAULT_ASR_MODEL_ID:
            return default_sherpa_model_dir()
        return self.cache_root / spec.id

    def is_installed(self, model_id: str) -> bool:
        spec = get_model_spec(model_id)
        path = self.model_dir(spec.id)
        if spec.id == DEFAULT_ASR_MODEL_ID:
            return (path / "model.int8.onnx").exists() and (path / "tokens.txt").exists()
        if (path / INCOMPLETE_MARKER).exists():
            return False
        return (path / READY_MARKER).exists() or _looks_like_complete_legacy_download(path, spec)

    def list_models(self, selected_model_id: str) -> list[dict]:
        selected = sanitize_model_id(selected_model_id)
        models = []
        for spec in MODEL_SPECS:
            path = self.model_dir(spec.id)
            installed = self.is_installed(spec.id)
            installed_size = directory_size(path)
            models.append(
                {
                    **asdict(spec),
                    "estimated_size_label": format_bytes(spec.estimated_size_bytes),
                    "installed": installed,
                    "installed_size_bytes": installed_size,
                    "installed_size_label": format_bytes(installed_size) if installed_size else "",
                    "selected": spec.id == selected,
                    "path": str(path),
                }
            )
        return models

    def download_model(
        self,
        model_id: str,
        progress_cb: Callable[[float, str], None] | None = None,
    ) -> Path:
        spec = get_model_spec(model_id)
        if spec.provider == "sherpa":
            raise RuntimeError("SenseVoice 默认模型请使用现有模型下载入口。")

        target = self.model_dir(spec.id)
        target.mkdir(parents=True, exist_ok=True)
        (target / READY_MARKER).unlink(missing_ok=True)
        (target / INCOMPLETE_MARKER).write_text("downloading\n", encoding="utf-8")
        if progress_cb:
            progress_cb(0.05, f"准备下载 {spec.label}")

        errors: list[str] = []
        if spec.hub == "modelscope":
            try:
                from modelscope import snapshot_download

                snapshot_download(spec.repo_id, local_dir=str(target))
                self._mark_download_ready(target)
                if progress_cb:
                    progress_cb(1.0, "下载完成")
                return target
            except Exception as exc:  # noqa: BLE001
                errors.append(f"ModelScope 下载失败: {exc}")

        hf_repo_id = spec.hf_repo_id or spec.repo_id
        try:
            from huggingface_hub import snapshot_download

            snapshot_download(repo_id=hf_repo_id, local_dir=str(target))
            self._mark_download_ready(target)
            if progress_cb:
                progress_cb(1.0, "下载完成")
            return target
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Hugging Face 下载失败: {exc}")

        raise RuntimeError(
            "无法下载模型。请安装 modelscope 或 huggingface_hub，"
            f"或手动下载 {spec.repo_id} 到 {target}。\n" + "\n".join(errors)
        )

    def _mark_download_ready(self, target: Path) -> None:
        (target / INCOMPLETE_MARKER).unlink(missing_ok=True)
        (target / READY_MARKER).write_text("ready\n", encoding="utf-8")

    def delete_model(self, model_id: str) -> Path:
        spec = get_model_spec(model_id)
        if spec.provider == "sherpa":
            raise RuntimeError("默认 SenseVoice 模型请使用现有模型入口管理。")

        target = self.model_dir(spec.id)
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        return target
