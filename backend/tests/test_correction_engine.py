"""Tests for CorrectionEngine."""

from __future__ import annotations

from unittest.mock import MagicMock

from correction_engine import (
    CorrectionEngine,
    build_correction_prompt,
    build_system_prompt,
)


class TestBuildPrompt:
    def test_basic_prompt(self) -> None:
        prompt = build_correction_prompt(
            segments=["今天天气很好。"],
            preceding_text="",
            hot_words=[],
        )
        assert "今天天气很好。" in prompt
        assert "[1]" in prompt

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

    def test_multiple_segments(self) -> None:
        segments = ["第一句。", "第二句。", "第三句。"]
        prompt = build_correction_prompt(
            segments=segments,
            preceding_text="",
            hot_words=[],
        )
        assert "[1]" in prompt
        assert "[2]" in prompt
        assert "[3]" in prompt

    def test_with_transcription_context(self) -> None:
        prompt = build_correction_prompt(
            segments=["我们来到斯温的保座。"],
            preceding_text="",
            hot_words=[],
            accuracy_mode="accurate",
            domain_profile="sermon",
        )
        assert "高准确率" in prompt
        assert "讲道/神学" in prompt

    def test_preceding_text_truncation(self) -> None:
        long_text = "测试" * 500  # 1000 chars
        prompt = build_correction_prompt(
            segments=["短句。"],
            preceding_text=long_text,
            hot_words=[],
        )
        # Should truncate to last 500 chars
        assert len(prompt) < len(long_text) + 500

    def test_accurate_system_prompt_allows_conservative_polishing(self) -> None:
        prompt = build_system_prompt("accurate")

        assert "补全中文标点" in prompt
        assert "不得改写观点" in prompt
        assert "逐字稿" in prompt


class TestParseResponse:
    def test_parse_numbered_segments(self) -> None:
        from correction_engine import parse_correction_response

        response = "[1] 纠正后第一句。\n[2] 纠正后第二句。"
        result = parse_correction_response(response, num_segments=2)
        assert result == ["纠正后第一句。", "纠正后第二句。"]

    def test_parse_mismatch_returns_original(self) -> None:
        from correction_engine import parse_correction_response

        response = "[1] 只有一句。"
        result = parse_correction_response(
            response, num_segments=3, originals=["原文1。", "原文2。", "原文3。"]
        )
        assert result == ["原文1。", "原文2。", "原文3。"]

    def test_parse_empty_response_returns_original(self) -> None:
        from correction_engine import parse_correction_response

        result = parse_correction_response("", num_segments=2, originals=["a。", "b。"])
        assert result == ["a。", "b。"]


class TestCorrectionEngine:
    def test_has_model_false_initially(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        assert engine.has_model() is False

    def test_has_model_true_for_cloud_api_with_key(self) -> None:
        engine = CorrectionEngine(mode="cloud_api", api_key="test-key")
        assert engine.has_model() is True

    def test_correct_calls_cloud_api(self, monkeypatch) -> None:
        import httpx

        calls: list[dict] = []

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"choices": [{"message": {"content": "[1] corrected text."}}]}

        class FakeClient:
            def __init__(self, timeout: float) -> None:
                self.timeout = timeout

            def __enter__(self) -> "FakeClient":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def post(self, url: str, json: dict, headers: dict) -> FakeResponse:
                calls.append({"url": url, "json": json, "headers": headers})
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)

        on_api_call = MagicMock()
        engine = CorrectionEngine(
            mode="cloud_api",
            api_provider="openai",
            api_key="test-key",
            api_model="gpt-test",
            on_api_call=on_api_call,
        )
        result = engine.correct(["original text."])

        assert result == ["corrected text."]
        assert calls[0]["url"] == "https://api.openai.com/v1/chat/completions"
        assert calls[0]["headers"]["Authorization"] == "Bearer test-key"
        assert calls[0]["json"]["model"] == "gpt-test"
        on_api_call.assert_called_once_with(1, False)

    def test_accurate_cloud_api_uses_polishing_prompt_and_stable_sampling(
        self, monkeypatch
    ) -> None:
        import httpx

        calls: list[dict] = []

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {"choices": [{"message": {"content": "[1] corrected text."}}]}

        class FakeClient:
            def __init__(self, timeout: float) -> None:
                self.timeout = timeout

            def __enter__(self) -> "FakeClient":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def post(self, url: str, json: dict, headers: dict) -> FakeResponse:
                calls.append({"url": url, "json": json, "headers": headers})
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)

        engine = CorrectionEngine(
            mode="cloud_api",
            api_provider="openai",
            api_key="test-key",
            api_model="gpt-test",
            accuracy_mode="accurate",
            domain_profile="sermon",
        )
        result = engine.correct(["original text."])

        assert result == ["corrected text."]
        body = calls[0]["json"]
        assert "补全中文标点" in body["messages"][0]["content"]
        assert body["temperature"] <= 0.1
        assert body["max_tokens"] >= 4096

    def test_correct_with_hotwords(self, monkeypatch) -> None:
        import httpx

        prompts: list[str] = []

        class FakeResponse:
            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict:
                return {
                    "choices": [
                        {"message": {"content": "[1] 暗能量驱动宇宙加速膨胀。"}}
                    ]
                }

        class FakeClient:
            def __init__(self, timeout: float) -> None:
                self.timeout = timeout

            def __enter__(self) -> "FakeClient":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def post(self, _url: str, json: dict, headers: dict) -> FakeResponse:
                prompts.append(json["messages"][1]["content"])
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)

        engine = CorrectionEngine(
            mode="cloud_api",
            api_key="test-key",
            hot_words=["暗能量"],
        )
        result = engine.correct(["暗能量驱动宇宙加速膨胀。"])

        assert result == ["暗能量驱动宇宙加速膨胀。"]
        assert "暗能量" in prompts[0]

    def test_correct_without_model_returns_original(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        result = engine.correct(["保持原文。"])
        assert result == ["保持原文。"]
