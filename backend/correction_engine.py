"""LLM-based context-aware post-correction for ASR output."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from llama_cpp import Llama

MAX_PRECEDING_CHARS = 500
SEGMENT_PATTERN = re.compile(r"\[(\d+)\]\s*(.*?)(?=\[\d+\]|\Z)", re.DOTALL)

SYSTEM_PROMPT = (
    "你是语音转写纠错助手。你的任务是根据上下文修正语音识别中的错误，"
    "包括同音字、专有名词、标点符号。\n"
    "规则：\n"
    "- 不要改变原意\n"
    "- 不要增加或删除内容\n"
    "- 只修正明显的识别错误\n"
    "- 保持原文的编号格式，每段以 [N] 开头输出"
)


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []

    if hot_words:
        parts.append(f"专业术语（优先使用）：{', '.join(hot_words)}")

    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"已确认的前文：{truncated}")

    parts.append("请纠正以下语音转写文本：")
    for i, seg in enumerate(segments, 1):
        parts.append(f"[{i}] {seg}")

    return "\n".join(parts)


def parse_correction_response(
    response: str,
    num_segments: int,
    originals: list[str] | None = None,
) -> list[str]:
    if not response.strip():
        return list(originals) if originals else [""] * num_segments

    matches = SEGMENT_PATTERN.findall(response)
    parsed = [text.strip() for _, text in matches]

    if len(parsed) != num_segments:
        return list(originals) if originals else [""] * num_segments

    return parsed


class CorrectionEngine:
    def __init__(
        self,
        model_path: str,
        hot_words: list[str] | None = None,
        num_threads: int = 1,
    ) -> None:
        self._model_path = model_path
        self._hot_words = hot_words or []
        self._num_threads = num_threads
        self._llm: Llama | None = None

    def has_model(self) -> bool:
        return self._llm is not None

    def load_model(self) -> None:
        from llama_cpp import Llama

        self._llm = Llama(
            model_path=self._model_path,
            n_ctx=2048,
            n_threads=self._num_threads,
            verbose=False,
        )

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]:
        if not self._llm:
            return list(segments)

        prompt = build_correction_prompt(
            segments=segments,
            preceding_text=preceding_text,
            hot_words=self._hot_words,
        )

        try:
            response = self._llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=1024,
                temperature=0.1,
            )
            content = response["choices"][0]["message"]["content"] or ""
            return parse_correction_response(
                content, num_segments=len(segments), originals=segments
            )
        except Exception:
            return list(segments)
