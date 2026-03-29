"""Tests for CorrectionEngine."""
from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch

import pytest

# Mock llama_cpp module so tests run without the native dependency
_mock_llama_cpp = types.ModuleType("llama_cpp")
_mock_llama_cpp.Llama = MagicMock  # type: ignore[attr-defined]
sys.modules.setdefault("llama_cpp", _mock_llama_cpp)

from correction_engine import CorrectionEngine, build_correction_prompt


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

    def test_preceding_text_truncation(self) -> None:
        long_text = "测试" * 500  # 1000 chars
        prompt = build_correction_prompt(
            segments=["短句。"],
            preceding_text=long_text,
            hot_words=[],
        )
        # Should truncate to last 500 chars
        assert len(prompt) < len(long_text) + 500


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
        result = parse_correction_response(
            "", num_segments=2, originals=["a。", "b。"]
        )
        assert result == ["a。", "b。"]


class TestCorrectionEngine:
    def test_has_model_false_initially(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        assert engine.has_model() is False

    def test_correct_calls_llm(self) -> None:
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": "[1] corrected text."}}]
        }
        with patch.object(_mock_llama_cpp, "Llama", return_value=mock_llm):
            engine = CorrectionEngine(
                model_path="/fake/model.gguf", num_threads=1
            )
            engine.load_model()
            result = engine.correct(["original text."])
        assert result == ["corrected text."]
        mock_llm.create_chat_completion.assert_called_once()

    def test_correct_with_hotwords(self) -> None:
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": "[1] 暗能量驱动宇宙加速膨胀。"}}]
        }
        with patch.object(_mock_llama_cpp, "Llama", return_value=mock_llm):
            engine = CorrectionEngine(
                model_path="/fake/model.gguf",
                hot_words=["暗能量"],
                num_threads=1,
            )
            engine.load_model()
            result = engine.correct(["暗能量驱动宇宙加速膨胀。"])
        assert result == ["暗能量驱动宇宙加速膨胀。"]

    def test_correct_without_model_returns_original(self) -> None:
        engine = CorrectionEngine(model_path="/nonexistent/model.gguf")
        result = engine.correct(["保持原文。"])
        assert result == ["保持原文。"]
