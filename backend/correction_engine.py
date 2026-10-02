"""Cloud API-based correction engine for ASR output."""

from __future__ import annotations

import threading
from typing import Callable

MAX_PRECEDING_CHARS = 500

SYSTEM_PROMPT = (
    "你是一个高准确率语音识别逐字稿校对器。输入是 ASR 逐行输出的原始转写片段，"
    "断句可能破碎、缺标点、含同音字错误。你的目标是把它们校正为忠实、连贯、"
    "可读的逐字稿正文，而不是改写文章。\n\n"
    "可以做的事：\n"
    "- 修正中文同音字、近音字、领域术语和专名错误，结合上下文修复明显破碎的语句\n"
    "- 修正英文单词、缩写、数字、经文章节等明显误识别\n"
    "- 跨行重新断句、补全标点，把破碎的片段合并成通顺的句子\n"
    "- 清理独立的语气填充词，但不要删除有实际语义的口语表达\n\n"
    "绝对不要做的事：\n"
    "- 不得改写观点、语气、论证顺序或神学含义\n"
    "- 不得总结、扩写、重组段落或加入音频里没有的信息\n"
    "- 不得把逐字稿改成讲章、文章或摘要\n"
    "- 完全无法判断的词保持原文，不要凭空猜测\n\n"
    "只输出校正后的正文，不要任何解释、标号或前后缀。"
)

# Budget must cover both the corrected text and (for reasoning models such as
# DeepSeek) the hidden thinking tokens, which can exceed the visible output.
CORRECTION_MAX_TOKENS = 16384
CORRECTION_TEMPERATURE = 0.1


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if hot_words:
        parts.append(
            f"以下是该领域的正确术语写法，遇到发音相近的错误时应替换为这些词：\n{', '.join(hot_words[:200])}"
        )
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"前文（已纠正）：{truncated}")
    parts.append("纠正以下语音转写文本（每行是一个 ASR 片段，行边界不可靠）：")
    parts.extend(segments)
    return "\n".join(parts)


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
        self._callback_lock = threading.Lock()

    def has_model(self) -> bool:
        return self._mode == "cloud_api" and bool(self._api_key)

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> str:
        """Correct a batch of ASR fragments into coherent prose.

        Returns the corrected text, or "" on failure (caller falls back to
        the raw fragments).
        """
        if self._mode != "cloud_api" or not self._api_key:
            return ""

        prompt = build_correction_prompt(
            segments,
            preceding_text,
            self._hot_words,
        )

        try:
            import httpx
        except ImportError:
            print("[CORRECTION] httpx not installed", flush=True)
            return ""

        if self._api_provider == "anthropic":
            url = "https://api.anthropic.com/v1/messages"
            headers = {
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": self._api_model,
                "max_tokens": CORRECTION_MAX_TOKENS,
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
                    {
                        "role": "system",
                        "content": SYSTEM_PROMPT,
                    },
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": CORRECTION_MAX_TOKENS,
                "temperature": CORRECTION_TEMPERATURE,
            }
            if self._api_provider == "deepseek":
                # Low reasoning keeps cross-fragment repairs (measured on par
                # with the default effort) while running ~8x faster; default
                # and medium effort can burn the whole token budget thinking.
                body["reasoning_effort"] = "low"

        try:
            with httpx.Client(timeout=180.0) as client:
                resp = client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            if self._api_provider == "anthropic":
                content = data["content"][0]["text"]
            else:
                content = data["choices"][0]["message"]["content"]

            content = (content or "").strip()
            failed = not content
            if failed:
                finish_reason = (
                    data["choices"][0].get("finish_reason")
                    if "choices" in data
                    else None
                )
                print(
                    f"[CORRECTION] 空响应，回退原文: finish_reason={finish_reason}",
                    flush=True,
                )
            else:
                print(f"[CORRECTION] Cloud response: {content[:120]}", flush=True)
            if self._on_api_call:
                with self._callback_lock:
                    self._on_api_call(len(segments), failed)
            return content
        except Exception as exc:
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            if self._on_api_call:
                with self._callback_lock:
                    self._on_api_call(len(segments), True)
            return ""
