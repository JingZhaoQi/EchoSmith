"""Cloud API-based correction engine for ASR output."""

from __future__ import annotations

import json
import threading
from typing import Callable

MAX_PRECEDING_CHARS = 500
# Hotwords are capped by total length, not count: 2026-10-03 a 200-word cap silently dropped
# every word imported after the 200th (290-word list, 824 chars).
HOTWORD_PROMPT_CHARS = 4000

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

CORRECTION_MAX_TOKENS = 16384
CORRECTION_TEMPERATURE = 0.1
REQUEST_TIMEOUT_S = 180.0
PROVIDER_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "doubao": "https://ark.cn-beijing.volces.com/api/v3",
}
# Reasoning ("thinking") multiplies latency ~4x for no measured gain on transcript repair
# (DeepSeek, 2026-10-03: 14.3 s vs 3.6 s per 1000-char batch, same fixes).
THINKING_OFF_PROVIDERS = {"deepseek", "doubao"}
TRUNCATED_REASONS = {"length", "max_tokens"}


def hotwords_in_budget(words: list[str]) -> list[str]:
    """Hotwords that fit the prompt budget, in list order."""
    kept: list[str] = []
    used = 0
    for word in words:
        used += len(word) + 2  # ", " separator
        if used > HOTWORD_PROMPT_CHARS:
            break
        kept.append(word)
    return kept


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if hot_words:
        parts.append(
            f"以下是该领域的正确术语写法，遇到发音相近的错误时应替换为这些词：\n{', '.join(hotwords_in_budget(hot_words))}"
        )
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"前文（原始转写，仅供理解上下文，不要输出）：{truncated}")
    parts.append("纠正以下语音转写文本（每行是一个 ASR 片段，行边界不可靠）：")
    parts.extend(segments)
    return "\n".join(parts)


class _Stopped(Exception):
    pass


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
    ) -> None:
        self._mode = mode
        self._hot_words = hot_words or []
        self._api_provider = api_provider
        self._api_key = api_key
        self._api_model = api_model
        self._api_base_url = api_base_url.rstrip("/")
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
        on_delta: Callable[[str], None] | None = None,
        should_stop: Callable[[], bool] | None = None,
    ) -> str:
        """Stream a correction of ASR fragments into coherent prose.

        on_delta receives the accumulated text after each streamed chunk.
        Returns the corrected text, or "" on failure, truncation or stop
        (caller falls back to the raw fragments).
        """
        if not self.has_model():
            return ""
        prompt = build_correction_prompt(segments, preceding_text, self._hot_words)
        url, headers, body = self._request(prompt)
        try:
            text, reason = self._stream(url, headers, body, on_delta, should_stop)
        except _Stopped:
            return ""
        except (
            Exception
        ) as exc:  # noqa: BLE001 - network/API errors fall back to raw text
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            self._record(len(segments), failed=True)
            return ""
        failed = not text.strip() or reason in TRUNCATED_REASONS
        if failed:
            print(
                f"[CORRECTION] 输出为空或被截断，回退原文: reason={reason}", flush=True
            )
        self._record(len(segments), failed)
        return "" if failed else text.strip()

    def _record(self, num_segments: int, failed: bool) -> None:
        if self._on_api_call:
            with self._callback_lock:
                self._on_api_call(num_segments, failed)

    def _request(self, prompt: str) -> tuple[str, dict, dict]:
        if self._api_provider == "anthropic":
            base = self._api_base_url or "https://api.anthropic.com"
            headers = {
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": self._api_model,
                "max_tokens": CORRECTION_MAX_TOKENS,
                "temperature": CORRECTION_TEMPERATURE,
                "system": SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            }
            return f"{base}/v1/messages", headers, body
        base = self._api_base_url or PROVIDER_BASE_URLS.get(
            self._api_provider, PROVIDER_BASE_URLS["openai"]
        )
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
            "max_tokens": CORRECTION_MAX_TOKENS,
            "temperature": CORRECTION_TEMPERATURE,
            "stream": True,
        }
        if self._api_provider in THINKING_OFF_PROVIDERS:
            body["thinking"] = {"type": "disabled"}
        return f"{base}/chat/completions", headers, body

    def _stream(
        self,
        url: str,
        headers: dict,
        body: dict,
        on_delta: Callable[[str], None] | None,
        should_stop: Callable[[], bool] | None,
    ) -> tuple[str, str | None]:
        """POST a streaming request; returns (text, finish_reason). Retries once without `thinking` if rejected."""
        import httpx

        with httpx.Client(timeout=REQUEST_TIMEOUT_S) as client:
            with client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code == 400 and "thinking" in body:
                    resp.read()
                    print(
                        "[CORRECTION] 服务不支持 thinking 参数，去掉后重试", flush=True
                    )
                    retry = {k: v for k, v in body.items() if k != "thinking"}
                    return self._stream(url, headers, retry, on_delta, should_stop)
                resp.raise_for_status()
                text, reason = "", None
                for line in resp.iter_lines():
                    if should_stop and should_stop():
                        raise _Stopped
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    piece, reason = self._parse_event(json.loads(payload), reason)
                    if piece:
                        text += piece
                        if on_delta:
                            on_delta(text)
                return text, reason

    def _parse_event(self, event: dict, reason: str | None) -> tuple[str, str | None]:
        if self._api_provider == "anthropic":
            if event.get("type") == "content_block_delta":
                return event.get("delta", {}).get("text", ""), reason
            if event.get("type") == "message_delta":
                return "", event.get("delta", {}).get("stop_reason") or reason
            return "", reason
        choices = event.get("choices") or []
        if not choices:
            return "", reason
        choice = choices[0]
        # reasoning_content (if a model thinks anyway) is never part of the transcript
        return (choice.get("delta") or {}).get("content") or "", choice.get(
            "finish_reason"
        ) or reason
