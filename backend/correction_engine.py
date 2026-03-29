"""Correction engine with local LLM and cloud API backends."""
from __future__ import annotations

import re

MAX_PRECEDING_CHARS = 500
SEGMENT_PATTERN = re.compile(r"\[(\d+)\]\s*(.*?)(?=\[\d+\]|\Z)", re.DOTALL)

SYSTEM_PROMPT = (
    "你是语音转写纠错助手。根据上下文和专业术语表修正语音识别错误，"
    "包括同音字、近音字、专有名词。\n"
    "规则：\n"
    "- 只修正明显的语音识别错误（同音/近音替换）\n"
    "- 不要改变原意，不要增删内容\n"
    "- 每段以 [N] 开头输出，保持段数不变\n"
    "- 直接输出纠正结果，不要解释"
)


def build_correction_prompt(
    segments: list[str],
    preceding_text: str = "",
    hot_words: list[str] | None = None,
) -> str:
    parts: list[str] = []
    if hot_words:
        parts.append(f"专业术语（优先使用这些正确写法）：{', '.join(hot_words[:100])}")
    if preceding_text:
        truncated = preceding_text[-MAX_PRECEDING_CHARS:]
        parts.append(f"已确认的前文：{truncated}")
    parts.append("请纠正以下语音转写文本中的同音字错误：")
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
        model_path: str = "",
        hot_words: list[str] | None = None,
        num_threads: int = 1,
        api_provider: str = "openai",
        api_key: str = "",
        api_model: str = "gpt-4o-mini",
        api_base_url: str = "",
    ) -> None:
        self._mode = mode
        self._model_path = model_path
        self._hot_words = hot_words or []
        self._num_threads = num_threads
        self._api_provider = api_provider
        self._api_key = api_key
        self._api_model = api_model
        self._api_base_url = api_base_url
        self._llm = None  # lazy loaded

    def has_model(self) -> bool:
        if self._mode == "local_3b":
            return self._llm is not None
        if self._mode == "cloud_api":
            return bool(self._api_key)
        return False

    def set_hot_words(self, words: list[str]) -> None:
        self._hot_words = list(words)

    def correct(
        self,
        segments: list[str],
        preceding_text: str = "",
    ) -> list[str]:
        if self._mode == "none":
            return list(segments)
        if self._mode == "local_3b":
            return self._correct_local(segments, preceding_text)
        if self._mode == "cloud_api":
            return self._correct_cloud(segments, preceding_text)
        return list(segments)

    def _correct_local(self, segments: list[str], preceding_text: str) -> list[str]:
        if self._llm is None:
            try:
                from llama_cpp import Llama
                self._llm = Llama(
                    model_path=self._model_path,
                    n_ctx=4096,
                    n_threads=self._num_threads,
                    verbose=False,
                )
            except Exception as exc:
                print(f"[CORRECTION] Local model load failed: {exc}", flush=True)
                return list(segments)

        prompt = build_correction_prompt(segments, preceding_text, self._hot_words)
        try:
            response = self._llm.create_chat_completion(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=2048,
                temperature=0.1,
            )
            content = response["choices"][0]["message"]["content"] or ""
            print(f"[CORRECTION] Local response: {content[:200]}", flush=True)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Local inference error: {exc}", flush=True)
            return list(segments)

    def _correct_cloud(self, segments: list[str], preceding_text: str) -> list[str]:
        if not self._api_key:
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
            # OpenAI-compatible (openai, deepseek, custom)
            base = self._api_base_url or {
                "openai": "https://api.openai.com/v1",
                "deepseek": "https://api.deepseek.com/v1",
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
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()

            if self._api_provider == "anthropic":
                content = data["content"][0]["text"]
            else:
                content = data["choices"][0]["message"]["content"]

            print(f"[CORRECTION] Cloud response: {content[:200]}", flush=True)
            return parse_correction_response(content, len(segments), segments)
        except Exception as exc:
            print(f"[CORRECTION] Cloud API error: {exc}", flush=True)
            return list(segments)
