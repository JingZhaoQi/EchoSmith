"""Cloud API-based correction engine for ASR output."""

from __future__ import annotations

import re
import threading
from typing import Callable

try:
    from transcript_enhancer import get_accuracy_label, get_domain_profile
except ImportError:
    from .transcript_enhancer import get_accuracy_label, get_domain_profile

MAX_PRECEDING_CHARS = 500
SEGMENT_PATTERN = re.compile(r"\[(\d+)\]\s*(.*?)(?=\[\d+\]|\Z)", re.DOTALL)

SYSTEM_PROMPT = (
    "你是一个保守的语音识别纠错器。只修正明确的、明显的语音转写错误。"
    "拿不准的地方，保持原文不动。\n\n"
    "工作流程：\n"
    "1. 先通读全文，判断内容所属领域（基督教讲道、学术讲座、商务会议、日常对话等）\n"
    "2. 基于领域知识，只修正明显的同音字/近音字错误\n\n"
    "应该修正的：\n"
    "- 中文同音字/近音字被语音识别错误替换（如：祷告→岛高尔、大祭司→大细丝、"
    "施恩的宝座→斯温的保座、属灵→署名/蜀林、十字架→实字家、基督→基录、"
    "圣名→生明、称义→成一、恩典→恩点、悔改→毁改）\n"
    "- 英文单词/缩写被错误识别为中文字符（如：配森→Python、杰森→JSON、阿皮爱→API）\n"
    "- 被语音识别拆散或合并的词语\n\n"
    "绝对不要做的：\n"
    "- 不要改写、润色或「改进」任何文本\n"
    "- 不要增加或删除原文中没有的词\n"
    "- 不要修改可能正确的文本\n"
    "- 不要改变标点符号（除非明显错误）\n"
    "- 不要输出任何解释，只输出纠正后的文本\n\n"
    "如果输入看起来已经正确，原样返回。\n"
    "每段以 [N] 开头输出，保持段数不变。"
)

ACCURATE_SYSTEM_PROMPT = (
    "你是一个高准确率语音识别逐字稿校对器。你的目标是把 ASR 结果校正为"
    "忠实、可读的逐字稿，而不是改写文章。\n\n"
    "可以做的事：\n"
    "- 修正明确的中文同音字、近音字、领域术语和专名错误\n"
    "- 修正英文单词、缩写、数字、经文章节等明显误识别\n"
    "- 补全中文标点和自然断句，使文本可读\n"
    "- 清理独立的语气填充词，但不要删除有实际语义的口语表达\n\n"
    "绝对不要做的事：\n"
    "- 不得改写观点、语气、论证顺序或神学含义\n"
    "- 不得总结、扩写、重组段落或加入音频里没有的信息\n"
    "- 不得把逐字稿改成讲章、文章或摘要\n"
    "- 拿不准的词保持原文，不要凭空猜测\n\n"
    "每段以 [N] 开头输出，保持段数不变。只输出校正后的文本。"
)


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
    accuracy_mode: str = "balanced",
    domain_profile: str = "general",
) -> str:
    parts: list[str] = []
    parts.append(f"转写模式：{get_accuracy_label(accuracy_mode)}")
    parts.append(f"内容领域：{get_domain_profile(domain_profile).label}")
    if hot_words:
        parts.append(
            f"以下是该领域的正确术语写法，遇到发音相近的错误时应替换为这些词：\n{', '.join(hot_words[:200])}"
        )
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"前文（已纠正）：{truncated}")
    parts.append("纠正以下语音转写文本：")
    for i, seg in enumerate(segments, 1):
        parts.append(f"[{i}] {seg}")
    return "\n".join(parts)


def build_system_prompt(accuracy_mode: str = "balanced") -> str:
    if accuracy_mode == "accurate":
        return ACCURATE_SYSTEM_PROMPT
    return SYSTEM_PROMPT


def _max_tokens_for_segments(segments: list[str], accuracy_mode: str) -> int:
    if accuracy_mode == "accurate":
        return 4096
    source_chars = sum(len(segment) for segment in segments)
    return max(2048, min(4096, int(source_chars * 1.2) + 512))


def _temperature_for_accuracy_mode(accuracy_mode: str) -> float:
    if accuracy_mode == "accurate":
        return 0.1
    return 0.2


def parse_correction_response(
    response: str,
    num_segments: int,
    originals: list[str] | None = None,
) -> list[str]:
    if not response or not response.strip():
        return list(originals) if originals else [""] * num_segments
    matches = SEGMENT_PATTERN.findall(response)
    parsed = [text.strip() for _, text in matches]
    if len(parsed) != num_segments:
        return list(originals) if originals else [""] * num_segments
    return parsed


class CorrectionEngine:
    def __init__(
        self,
        mode: str = "none",
        hot_words: list[str] | None = None,
        api_provider: str = "openai",
        api_key: str = "",
        api_model: str = "gpt-4o-mini",
        api_base_url: str = "",
        on_api_call: Callable[[int, bool], None] | None = None,
        accuracy_mode: str = "balanced",
        domain_profile: str = "general",
        **_kwargs,
    ) -> None:
        self._mode = mode
        self._hot_words = hot_words or []
        self._api_provider = api_provider
        self._api_key = api_key
        self._api_model = api_model
        self._api_base_url = api_base_url
        self._on_api_call = on_api_call
        self._accuracy_mode = accuracy_mode
        self._domain_profile = domain_profile
        self._callback_lock = threading.Lock()

    def has_model(self) -> bool:
        return self._mode == "cloud_api" and bool(self._api_key)

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def set_transcription_context(
        self,
        accuracy_mode: str = "balanced",
        domain_profile: str = "general",
    ) -> None:
        self._accuracy_mode = accuracy_mode
        self._domain_profile = domain_profile

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]:
        if self._mode != "cloud_api" or not self._api_key:
            return list(segments)

        prompt = build_correction_prompt(
            segments,
            preceding_text,
            self._hot_words,
            accuracy_mode=self._accuracy_mode,
            domain_profile=self._domain_profile,
        )

        try:
            import httpx
        except ImportError:
            print("[CORRECTION] httpx not installed", flush=True)
            return list(segments)

        if self._api_provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": self._api_model,
                "max_tokens": _max_tokens_for_segments(segments, self._accuracy_mode),
                "system": build_system_prompt(self._accuracy_mode),
                "messages": [{"role": "user", "content": prompt}],
            }
        else:
            base = self._api_base_url or {
                "openai": "https://api.openai.com/v1",
                "deepseek": "https://api.deepseek.com/v1",
                "doubao": "https://ark.cn-beijing.volces.com/api/v3",
            }.get(self._api_provider, "https://api.openai.com/v1")
            url = f"{base}/chat/completions"
            headers = {
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            }
            body = {
                "model": self._api_model,
                "messages": [
                    {
                        "role": "system",
                        "content": build_system_prompt(self._accuracy_mode),
                    },
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": _max_tokens_for_segments(segments, self._accuracy_mode),
                "temperature": _temperature_for_accuracy_mode(self._accuracy_mode),
            }

        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            if self._api_provider == "anthropic":
                content = data["content"][0]["text"]
            else:
                content = data["choices"][0]["message"]["content"]

            print(f"[CORRECTION] Cloud response: {content[:200]}", flush=True)
            if self._on_api_call:
                with self._callback_lock:
                    self._on_api_call(len(segments), False)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            if self._on_api_call:
                with self._callback_lock:
                    self._on_api_call(len(segments), True)
            return list(segments)
