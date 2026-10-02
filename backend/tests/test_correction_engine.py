"""Tests for CorrectionEngine."""

from __future__ import annotations

from unittest.mock import MagicMock

from correction_engine import (
    SYSTEM_PROMPT,
    CorrectionEngine,
    build_correction_prompt,
)


class TestBuildPrompt:
    def test_basic_prompt(self) -> None:
        prompt = build_correction_prompt(
            segments=["今天天气很好。"],
            preceding_text="",
            hot_words=[],
        )
        assert "今天天气很好。" in prompt

    def test_with_hotwords(self) -> None:
        prompt = build_correction_prompt(
            segments=["暗能量是宇宙的主要成分。"],
            preceding_text="",
            hot_words=["暗能量", "ΛCDM"],
        )
        assert "暗能量" in prompt
        assert "ΛCDM" in prompt

    def test_with_preceding_context(self) -> None:
        prompt = build_correction_prompt(
            segments=["它的值约为70。"],
            preceding_text="哈勃常数是一个重要的参数。",
            hot_words=[],
        )
        assert "哈勃常数是一个重要的参数。" in prompt

    def test_multiple_segments_one_per_line(self) -> None:
        segments = ["第一句", "第二句", "第三句"]
        prompt = build_correction_prompt(
            segments=segments,
            preceding_text="",
            hot_words=[],
        )
        assert "第一句\n第二句\n第三句" in prompt

    def test_preceding_text_truncation(self) -> None:
        long_text = "测试" * 500  # 1000 chars
        prompt = build_correction_prompt(
            segments=["短句。"],
            preceding_text=long_text,
            hot_words=[],
        )
        # Should truncate to last 500 chars
        assert len(prompt) < len(long_text) + 500

    def test_system_prompt_demands_coherent_repair(self) -> None:
        assert "跨行重新断句" in SYSTEM_PROMPT
        assert "不得改写观点" in SYSTEM_PROMPT
        assert "逐字稿" in SYSTEM_PROMPT


class _FakeClientFactory:
    """Build an httpx.Client replacement returning a fixed payload."""

    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.calls: list[dict] = []

    def __call__(self, timeout: float):
        factory = self

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return factory.payload

        class FakeClient:
            def __enter__(self) -> "FakeClient":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def post(self, url: str, json: dict, headers: dict) -> FakeResponse:
                factory.calls.append({"url": url, "json": json, "headers": headers})
                return FakeResponse()

        return FakeClient()


class TestCorrectionEngine:
    def test_has_model_false_initially(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        assert engine.has_model() is False

    def test_has_model_true_for_cloud_api_with_key(self) -> None:
        engine = CorrectionEngine(mode="cloud_api", api_key="test-key")
        assert engine.has_model() is True

    def test_correct_calls_cloud_api(self, monkeypatch) -> None:
        import httpx

        factory = _FakeClientFactory(
            {"choices": [{"message": {"content": "校正后的连贯正文。"}}]}
        )
        monkeypatch.setattr(httpx, "Client", factory)

        on_api_call = MagicMock()
        engine = CorrectionEngine(
            mode="cloud_api",
            api_provider="openai",
            api_key="test-key",
            api_model="gpt-test",
            on_api_call=on_api_call,
        )
        result = engine.correct(["原文片段一", "原文片段二"])

        assert result == "校正后的连贯正文。"
        call = factory.calls[0]
        assert call["url"] == "https://api.openai.com/v1/chat/completions"
        assert call["headers"]["Authorization"] == "Bearer test-key"
        assert call["json"]["model"] == "gpt-test"
        assert call["json"]["temperature"] <= 0.1
        assert call["json"]["max_tokens"] >= 8192
        # Reasoning knobs are deepseek-only; openai gets a plain request
        assert "thinking" not in call["json"]
        assert "reasoning_effort" not in call["json"]
        assert "跨行重新断句" in call["json"]["messages"][0]["content"]
        on_api_call.assert_called_once_with(2, False)

    def test_correct_with_hotwords(self, monkeypatch) -> None:
        import httpx

        factory = _FakeClientFactory(
            {"choices": [{"message": {"content": "暗能量驱动宇宙加速膨胀。"}}]}
        )
        monkeypatch.setattr(httpx, "Client", factory)

        engine = CorrectionEngine(
            mode="cloud_api",
            api_key="test-key",
            hot_words=["暗能量"],
        )
        result = engine.correct(["暗能量驱动宇宙加速膨胀。"])

        assert result == "暗能量驱动宇宙加速膨胀。"
        assert "暗能量" in factory.calls[0]["json"]["messages"][1]["content"]

    def test_correct_without_model_returns_empty(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        assert engine.correct(["保持原文。"]) == ""

    def test_deepseek_uses_low_reasoning_effort(self, monkeypatch) -> None:
        import httpx

        factory = _FakeClientFactory(
            {"choices": [{"message": {"content": "校正后。"}}]}
        )
        monkeypatch.setattr(httpx, "Client", factory)

        engine = CorrectionEngine(
            mode="cloud_api", api_provider="deepseek", api_key="k", api_model="m"
        )
        engine.correct(["原文。"])
        assert factory.calls[0]["json"]["reasoning_effort"] == "low"

    def test_empty_response_counts_as_failed_call(self, monkeypatch) -> None:
        import httpx

        factory = _FakeClientFactory(
            {"choices": [{"message": {"content": ""}, "finish_reason": "length"}]}
        )
        monkeypatch.setattr(httpx, "Client", factory)

        on_api_call = MagicMock()
        engine = CorrectionEngine(
            mode="cloud_api", api_key="k", api_model="m", on_api_call=on_api_call
        )
        result = engine.correct(["原文一。", "原文二。"])

        assert result == ""
        on_api_call.assert_called_once_with(2, True)
