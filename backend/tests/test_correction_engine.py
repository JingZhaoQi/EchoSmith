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
        # context is raw ASR text, not corrected text — the label must not claim otherwise
        assert "已纠正" not in prompt and "原始转写" in prompt

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


class _SSEServer:
    """Local OpenAI-/Anthropic-compatible streaming endpoint; scenario per instance."""

    def __init__(
        self,
        chunks: list[str],
        *,
        finish: str = "stop",
        reject_thinking: bool = False,
        delay: float = 0.0,
        anthropic: bool = False,
    ) -> None:
        import json
        import threading
        import time
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        server = self
        self.requests: list[dict] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                server.requests.append(
                    {"path": self.path, "body": body, "headers": dict(self.headers)}
                )
                if reject_thinking and "thinking" in body:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'{"error": "unknown parameter thinking"}')
                    return
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for k, piece in enumerate(chunks):
                    if anthropic:
                        event = {
                            "type": "content_block_delta",
                            "delta": {"type": "text_delta", "text": piece},
                        }
                    else:
                        event = {
                            "choices": [
                                {"delta": {"content": piece}, "finish_reason": None}
                            ]
                        }
                    try:
                        self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                        self.wfile.flush()
                    except BrokenPipeError:
                        return
                    time.sleep(delay)
                if anthropic:
                    tail = {
                        "type": "message_delta",
                        "delta": {
                            "stop_reason": (
                                "max_tokens" if finish == "length" else "end_turn"
                            )
                        },
                    }
                    self.wfile.write(
                        f"event: message_delta\ndata: {json.dumps(tail)}\n\n".encode()
                    )
                else:
                    tail = {"choices": [{"delta": {}, "finish_reason": finish}]}
                    self.wfile.write(
                        f"data: {json.dumps(tail)}\n\ndata: [DONE]\n\n".encode()
                    )

            def log_message(self, *_args: object) -> None:
                return None

        self._httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._httpd.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self._httpd.server_address[1]}"

    def close(self) -> None:
        self._httpd.shutdown()


def _engine(server: _SSEServer, provider: str = "custom", **kwargs) -> CorrectionEngine:
    return CorrectionEngine(
        mode="cloud_api",
        api_provider=provider,
        api_key="test-key",
        api_model="m",
        api_base_url=server.url + ("" if provider == "anthropic" else "/v1"),
        **kwargs,
    )


class TestCorrectionEngine:
    def test_has_model_false_without_cloud_key(self) -> None:
        assert CorrectionEngine().has_model() is False
        assert CorrectionEngine(mode="cloud_api").has_model() is False

    def test_has_model_true_for_cloud_api_with_key(self) -> None:
        assert (
            CorrectionEngine(mode="cloud_api", api_key="test-key").has_model() is True
        )

    def test_streams_deltas_and_returns_full_text(self) -> None:
        server = _SSEServer(["校正后", "的连贯", "正文。"])
        on_api_call = MagicMock()
        seen: list[str] = []
        try:
            result = _engine(server, on_api_call=on_api_call).correct(
                ["原文一", "原文二"], on_delta=seen.append
            )
        finally:
            server.close()
        assert result == "校正后的连贯正文。"
        assert seen == ["校正后", "校正后的连贯", "校正后的连贯正文。"]
        req = server.requests[0]
        assert req["path"] == "/v1/chat/completions"
        assert req["headers"]["Authorization"] == "Bearer test-key"
        assert req["body"]["stream"] is True and req["body"]["temperature"] <= 0.1
        assert "thinking" not in req["body"]
        on_api_call.assert_called_once_with(2, False)

    def test_hotwords_reach_prompt(self) -> None:
        server = _SSEServer(["暗能量。"])
        try:
            _engine(server, hot_words=["暗能量"]).correct(["按能量。"])
        finally:
            server.close()
        assert "暗能量" in server.requests[0]["body"]["messages"][1]["content"]

    def test_deepseek_disables_thinking(self) -> None:
        server = _SSEServer(["好。"])
        try:
            _engine(server, provider="deepseek").correct(["好"])
        finally:
            server.close()
        assert server.requests[0]["body"]["thinking"] == {"type": "disabled"}

    def test_retries_without_thinking_when_rejected(self) -> None:
        server = _SSEServer(["好。"], reject_thinking=True)
        try:
            result = _engine(server, provider="doubao").correct(["好"])
        finally:
            server.close()
        assert result == "好。"
        assert (
            "thinking" in server.requests[0]["body"]
            and "thinking" not in server.requests[1]["body"]
        )

    def test_truncated_output_counts_as_failure(self) -> None:
        server = _SSEServer(["半截"], finish="length")
        on_api_call = MagicMock()
        try:
            result = _engine(server, on_api_call=on_api_call).correct(
                ["原文一。", "原文二。"]
            )
        finally:
            server.close()
        assert result == ""
        on_api_call.assert_called_once_with(2, True)

    def test_anthropic_stream(self) -> None:
        server = _SSEServer(["Hello ", "world."], anthropic=True)
        try:
            result = _engine(server, provider="anthropic").correct(["hello world"])
        finally:
            server.close()
        assert result == "Hello world."
        assert server.requests[0]["path"] == "/v1/messages"
        assert server.requests[0]["headers"]["x-api-key"] == "test-key"

    def test_should_stop_aborts_stream(self) -> None:
        import time

        server = _SSEServer(["一"] * 50, delay=0.05)
        t0 = time.time()
        try:
            result = _engine(server).correct(
                ["原文"], should_stop=lambda: time.time() - t0 > 0.2
            )
        finally:
            server.close()
        assert result == ""
        assert time.time() - t0 < 1.5

    def test_without_cloud_key_returns_empty(self) -> None:
        assert CorrectionEngine().correct(["保持原文。"]) == ""


class TestHotwordBudget:
    def test_long_lists_keep_words_added_last(self) -> None:
        words = [f"词{i:03d}" for i in range(290)] + ["柏溪团契"]
        prompt = build_correction_prompt(["百溪团契"], hot_words=words)
        assert (
            "柏溪团契" in prompt
        )  # a 200-word cap used to drop everything added later

    def test_budget_is_by_characters_and_keeps_order(self) -> None:
        from correction_engine import HOTWORD_PROMPT_CHARS, hotwords_in_budget

        words = ["长" * 100] * (HOTWORD_PROMPT_CHARS // 100 + 5)
        kept = hotwords_in_budget(words)
        assert sum(len(w) for w in kept) <= HOTWORD_PROMPT_CHARS
        assert len(kept) < len(words)
        assert hotwords_in_budget(["甲", "乙"]) == ["甲", "乙"]
