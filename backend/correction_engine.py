"""Cloud API-based correction engine for ASR output."""
from __future__ import annotations

import re
from typing import Callable

MAX_PRECEDING_CHARS = 500
SEGMENT_PATTERN = re.compile(r"\[(\d+)\]\s*(.*?)(?=\[\d+\]|\Z)", re.DOTALL)

SYSTEM_PROMPT = (
    "你是语音转写纠错专家。你的工作流程：\n"
    "1. 先通读全部文本，判断这段内容属于什么领域（如：基督教讲道、学术讲座、商务会议、日常对话等）\n"
    "2. 基于判断出的领域，运用该领域的专业知识来纠正语音识别错误\n"
    "3. 特别注意同音字/近音字替换错误，这是语音识别最常见的错误类型\n\n"
    "纠错规则：\n"
    "- 如果是基督教/圣经相关内容，要熟悉圣经经文、神学术语、人名地名的正确写法"
    "（如：祷告不是岛高尔，大祭司不是大集司/大细丝，施恩的宝座不是斯温的保座，"
    "属灵不是署名/蜀林，十字架不是实字家，基督不是基录，圣名不是生明，"
    "悔改不是毁改，恩典不是恩点，称义不是成一）\n"
    "- 如果是其他领域，运用对应领域的专业知识纠错\n"
    "- 不要改变原意，不要增删内容\n"
    "- 每段以 [N] 开头输出，保持段数不变\n"
    "- 直接输出纠正结果，不要输出领域判断过程"
)


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if hot_words:
        parts.append(f"专业术语（优先使用这些正确写法）：{', '.join(hot_words[:200])}")
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"已确认的前文：{truncated}")
    parts.append("请先判断以下文本的领域，然后基于该领域知识纠正语音识别中的同音字错误：")
    for i, seg in enumerate(segments, 1):
        parts.append(f"[{i}] {seg}")
    return "\n".join(parts)


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
        **_kwargs,
    ) -> None:
        self._mode = mode
        self._hot_words = hot_words or []
        self._api_provider = api_provider
        self._api_key = api_key
        self._api_model = api_model
        self._api_base_url = api_base_url
        self._on_api_call = on_api_call

    def has_model(self) -> bool:
        return self._mode == "cloud_api" and bool(self._api_key)

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]:
        if self._mode != "cloud_api" or not self._api_key:
            return list(segments)

        prompt = build_correction_prompt(segments, preceding_text, self._hot_words)

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
                "max_tokens": 2048,
                "system": SYSTEM_PROMPT,
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
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 2048,
                "temperature": 0.1,
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
                self._on_api_call(len(segments), False)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            if self._on_api_call:
                self._on_api_call(len(segments), True)
            return list(segments)
