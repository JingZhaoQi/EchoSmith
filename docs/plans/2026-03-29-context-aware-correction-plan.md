# Context-Aware Post-Correction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add LLM-based context-aware error correction to EchoSmith's transcription pipeline, running in parallel with ASR via a dual-thread producer-consumer architecture.

**Architecture:** SenseVoice transcribes VAD segments into a queue; a correction thread consumes batches of 5 segments, sends them to a local Qwen2.5-0.5B Q4 model via llama-cpp-python with preceding context and hotwords, and produces corrected text. Both threads run concurrently. A HotwordManager stores user-defined terms in a JSON file.

**Tech Stack:** Python 3.12, llama-cpp-python, FastAPI, React 18 + TypeScript, Tauri 2.x

**Design doc:** `docs/plans/2026-03-29-context-aware-correction-design.md`

---

### Task 1: Set Up Test Infrastructure

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `pyproject.toml` (add `[tool.pytest.ini_options]`)

**Step 1: Add pytest config to pyproject.toml**

Append to existing `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["backend/tests"]
asyncio_mode = "auto"
```

**Step 2: Create test boilerplate**

Create `backend/tests/__init__.py` (empty).

Create `backend/tests/conftest.py`:

```python
"""Shared fixtures for EchoSmith backend tests."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure backend modules are importable without package prefix
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

**Step 3: Verify pytest runs**

Run: `cd /Users/qijingzhao/Programs/EchoSmith && python -m pytest backend/tests/ -v --co`
Expected: "no tests ran" (collection succeeds, 0 items)

**Step 4: Install test deps if needed**

Run: `pip install pytest pytest-asyncio`

**Step 5: Commit**

```bash
git add pyproject.toml backend/tests/
git commit -m "test: set up pytest infrastructure for backend"
```

---

### Task 2: HotwordManager — Tests

**Files:**
- Create: `backend/tests/test_hotwords.py`

**Step 1: Write tests**

```python
"""Tests for HotwordManager."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from hotwords import HotwordManager


@pytest.fixture
def hw_path(tmp_path: Path) -> Path:
    return tmp_path / "hotwords.json"


@pytest.fixture
def manager(hw_path: Path) -> HotwordManager:
    return HotwordManager(hw_path)


def test_add_and_list(manager: HotwordManager) -> None:
    manager.add("暗能量")
    manager.add("哈勃常数")
    assert manager.list_all() == ["暗能量", "哈勃常数"]


def test_add_duplicate_ignored(manager: HotwordManager) -> None:
    manager.add("暗能量")
    manager.add("暗能量")
    assert manager.list_all() == ["暗能量"]


def test_remove(manager: HotwordManager) -> None:
    manager.add("暗能量")
    manager.add("哈勃常数")
    manager.remove("暗能量")
    assert manager.list_all() == ["哈勃常数"]


def test_remove_nonexistent_is_noop(manager: HotwordManager) -> None:
    manager.remove("不存在")
    assert manager.list_all() == []


def test_persistence(hw_path: Path) -> None:
    m1 = HotwordManager(hw_path)
    m1.add("ΛCDM")
    m1.add("宇宙学")

    m2 = HotwordManager(hw_path)
    m2.load()
    assert m2.list_all() == ["ΛCDM", "宇宙学"]


def test_load_missing_file(hw_path: Path) -> None:
    manager = HotwordManager(hw_path)
    manager.load()  # should not raise
    assert manager.list_all() == []


def test_storage_format(hw_path: Path) -> None:
    manager = HotwordManager(hw_path)
    manager.add("测试")
    data = json.loads(hw_path.read_text(encoding="utf-8"))
    assert data["version"] == 1
    assert data["words"] == ["测试"]
```

**Step 2: Run to verify they fail**

Run: `python -m pytest backend/tests/test_hotwords.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'hotwords'`

**Step 3: Commit**

```bash
git add backend/tests/test_hotwords.py
git commit -m "test: add HotwordManager tests"
```

---

### Task 3: HotwordManager — Implementation

**Files:**
- Create: `backend/hotwords.py`

**Step 1: Implement HotwordManager**

```python
"""User-managed hotword list for domain-specific ASR correction."""
from __future__ import annotations

import json
from pathlib import Path


class HotwordManager:
    """Thread-safe hotword storage backed by a JSON file."""

    def __init__(self, storage_path: Path) -> None:
        self._path = storage_path
        self._words: list[str] = []
        self.load()

    def load(self) -> None:
        if not self._path.exists():
            self._words = []
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            self._words = list(data.get("words", []))
        except (json.JSONDecodeError, KeyError):
            self._words = []

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": 1, "words": self._words}
        self._path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def add(self, word: str) -> None:
        word = word.strip()
        if word and word not in self._words:
            self._words.append(word)
            self.save()

    def remove(self, word: str) -> None:
        try:
            self._words.remove(word)
            self.save()
        except ValueError:
            pass

    def list_all(self) -> list[str]:
        return list(self._words)
```

**Step 2: Run tests**

Run: `python -m pytest backend/tests/test_hotwords.py -v`
Expected: All 7 tests PASS

**Step 3: Commit**

```bash
git add backend/hotwords.py
git commit -m "feat: add HotwordManager with JSON persistence"
```

---

### Task 4: CorrectionEngine — Tests

**Files:**
- Create: `backend/tests/test_correction_engine.py`

**Step 1: Write tests (mock llama_cpp to avoid needing the actual model)**

```python
"""Tests for CorrectionEngine."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

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

    @patch("correction_engine.Llama")
    def test_correct_calls_llm(self, mock_llama_cls: MagicMock) -> None:
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": "[1] 纠正后的文本。"}}]
        }
        mock_llama_cls.return_value = mock_llm

        engine = CorrectionEngine(
            model_path="/fake/model.gguf", num_threads=1
        )
        engine.load_model()
        result = engine.correct(["原始文本。"])
        assert result == ["纠正后的文本。"]
        mock_llm.create_chat_completion.assert_called_once()

    @patch("correction_engine.Llama")
    def test_correct_with_hotwords(self, mock_llama_cls: MagicMock) -> None:
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": "[1] 暗能量驱动宇宙加速膨胀。"}}]
        }
        mock_llama_cls.return_value = mock_llm

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
```

**Step 2: Run to verify they fail**

Run: `python -m pytest backend/tests/test_correction_engine.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'correction_engine'`

**Step 3: Commit**

```bash
git add backend/tests/test_correction_engine.py
git commit -m "test: add CorrectionEngine tests with mocked LLM"
```

---

### Task 5: CorrectionEngine — Implementation

**Files:**
- Create: `backend/correction_engine.py`

**Step 1: Implement CorrectionEngine**

```python
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
```

**Step 2: Run tests**

Run: `python -m pytest backend/tests/test_correction_engine.py -v`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add backend/correction_engine.py
git commit -m "feat: add CorrectionEngine with context-aware LLM correction"
```

---

### Task 6: Pipeline Integration — Tests

**Files:**
- Create: `backend/tests/test_pipeline.py`

**Step 1: Write pipeline coordination tests**

```python
"""Tests for the dual-thread correction pipeline."""
from __future__ import annotations

import queue
import threading
from unittest.mock import MagicMock

import pytest

from correction_engine import CorrectionEngine
from asr_engine import Segment


def test_producer_consumer_flow() -> None:
    """Verify segments flow through queue and get corrected."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    # Mock correction engine
    mock_engine = MagicMock(spec=CorrectionEngine)
    mock_engine.has_model.return_value = True
    mock_engine.correct.side_effect = lambda segs, **kw: [
        s.replace("原文", "纠正") for s in segs
    ]

    # Feed segments
    input_segments = [
        Segment(index=i, start_ms=i * 1000, end_ms=(i + 1) * 1000, text=f"原文{i}。")
        for i in range(7)
    ]

    for seg in input_segments:
        seg_queue.put(seg)
    seg_queue.put(SENTINEL)

    # Run worker
    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=mock_engine,
        batch_size=5,
        progress_cb=None,
    )

    assert len(corrected_segments) == 7
    assert all("纠正" in s.text for s in corrected_segments)
    # Called twice: batch of 5 + flush of 2
    assert mock_engine.correct.call_count == 2


def test_pipeline_without_correction_engine() -> None:
    """When engine is None, segments pass through unchanged."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    input_segments = [
        Segment(index=0, start_ms=0, end_ms=1000, text="原文。")
    ]
    for seg in input_segments:
        seg_queue.put(seg)
    seg_queue.put(SENTINEL)

    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=None,
        batch_size=5,
        progress_cb=None,
    )

    assert len(corrected_segments) == 1
    assert corrected_segments[0].text == "原文。"


def test_pipeline_correction_failure_keeps_original() -> None:
    """If LLM raises, original text is preserved."""
    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_segments: list[Segment] = []
    lock = threading.Lock()

    mock_engine = MagicMock(spec=CorrectionEngine)
    mock_engine.has_model.return_value = True
    mock_engine.correct.side_effect = RuntimeError("LLM crashed")

    seg_queue.put(Segment(index=0, start_ms=0, end_ms=1000, text="保持原文。"))
    seg_queue.put(SENTINEL)

    correction_worker(
        seg_queue=seg_queue,
        output=corrected_segments,
        output_lock=lock,
        correction_engine=mock_engine,
        batch_size=5,
        progress_cb=None,
    )

    assert corrected_segments[0].text == "保持原文。"
```

**Step 2: Run to verify they fail**

Run: `python -m pytest backend/tests/test_pipeline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'pipeline'`

**Step 3: Commit**

```bash
git add backend/tests/test_pipeline.py
git commit -m "test: add dual-thread correction pipeline tests"
```

---

### Task 7: Pipeline Worker — Implementation

**Files:**
- Create: `backend/pipeline.py`

**Step 1: Implement correction_worker**

```python
"""Dual-thread producer-consumer pipeline for ASR + correction."""
from __future__ import annotations

import queue
import threading
from dataclasses import replace
from typing import TYPE_CHECKING, Callable

from asr_engine import Segment

if TYPE_CHECKING:
    from correction_engine import CorrectionEngine

SENTINEL = object()

MAX_PRECEDING_CHARS = 500


def correction_worker(
    seg_queue: queue.Queue,
    output: list[Segment],
    output_lock: threading.Lock,
    correction_engine: CorrectionEngine | None,
    batch_size: int = 5,
    progress_cb: Callable[[float, str], None] | None = None,
) -> None:
    """Consume segments from queue, correct in batches, append to output.

    If correction_engine is None or has no model, segments pass through
    unchanged. If correction raises, original text is preserved.
    """
    buffer: list[Segment] = []
    preceding_text = ""
    total_corrected = 0

    def flush(batch: list[Segment]) -> None:
        nonlocal preceding_text, total_corrected
        if not batch:
            return

        texts = [seg.text for seg in batch]

        if correction_engine and correction_engine.has_model():
            try:
                corrected_texts = correction_engine.correct(
                    texts, preceding_text=preceding_text
                )
            except Exception:
                corrected_texts = texts
        else:
            corrected_texts = texts

        with output_lock:
            for seg, corrected in zip(batch, corrected_texts):
                output.append(replace(seg, text=corrected))

        preceding_text += "".join(corrected_texts)
        if len(preceding_text) > MAX_PRECEDING_CHARS:
            preceding_text = preceding_text[-MAX_PRECEDING_CHARS:]

        total_corrected += len(batch)
        if progress_cb:
            progress_cb(total_corrected, f"智能纠错中")

    while True:
        item = seg_queue.get()
        if item is SENTINEL:
            flush(buffer)
            break
        buffer.append(item)
        if len(buffer) >= batch_size:
            flush(buffer)
            buffer = []
```

**Step 2: Run tests**

Run: `python -m pytest backend/tests/test_pipeline.py -v`
Expected: All 3 tests PASS

**Step 3: Commit**

```bash
git add backend/pipeline.py
git commit -m "feat: add correction_worker for dual-thread pipeline"
```

---

### Task 8: Integrate Pipeline into ASREngine

**Files:**
- Modify: `backend/asr_engine.py` — `_transcribe_with_vad` method (lines 376-447)

**Step 1: Add correction support to ASREngine.__init__**

In `asr_engine.py`, add import at top and modify `__init__`:

```python
# At top of file, add:
import queue
import threading
from dataclasses import replace

# In __init__, add parameter:
def __init__(
    self,
    model_dir: str = DEFAULT_MODEL_DIR,
    download_callback: ModelDownloadCallback | None = None,
    num_threads: int = 0,
    use_int8: bool = True,
    language: str = "zh",
    correction_engine=None,  # CorrectionEngine | None
) -> None:
    # ... existing init ...
    self._correction_engine = correction_engine
```

**Step 2: Modify `_transcribe_with_vad` to use pipeline**

Replace the for-loop in `_transcribe_with_vad` (lines 398-446) with dual-thread logic:

```python
def _transcribe_with_vad(self, samples, sample_rate, duration_ms, progress_cb, pause_event, cancelled_checker):
    assert self._recognizer is not None

    if progress_cb:
        progress_cb(0.12, "语音检测中", "")

    speech_segments = self._detect_speech_segments(samples, sample_rate, progress_cb)

    if not speech_segments:
        if progress_cb:
            progress_cb(1.0, "完成", "")
        return TranscriptionResult(text="", segments=[], duration_ms=duration_ms)

    from pipeline import correction_worker, SENTINEL

    seg_queue: queue.Queue = queue.Queue()
    corrected_output: list[Segment] = []
    output_lock = threading.Lock()
    total = len(speech_segments)

    # Correction progress callback
    def correction_progress_cb(count: int, stage: str) -> None:
        if progress_cb:
            ratio = min(count / total, 1.0)
            progress_cb(0.70 + 0.25 * ratio, stage, "")

    # Start correction worker thread
    correction_thread = threading.Thread(
        target=correction_worker,
        kwargs=dict(
            seg_queue=seg_queue,
            output=corrected_output,
            output_lock=output_lock,
            correction_engine=self._correction_engine,
            batch_size=5,
            progress_cb=correction_progress_cb,
        ),
        daemon=True,
    )
    correction_thread.start()

    # Transcription producer loop (existing logic, now puts into queue)
    all_texts: list[str] = []

    for idx, seg in enumerate(speech_segments):
        if self._check_interrupted(pause_event, cancelled_checker):
            break

        progress = 0.15 + 0.55 * (idx / total)
        if progress_cb:
            progress_cb(progress, f"转写中 {idx + 1}/{total}", " ".join(all_texts))

        stream = self._recognizer.create_stream()
        stream.accept_waveform(sample_rate, seg.samples)
        self._recognizer.decode_stream(stream)

        text = stream.result.text.strip()
        if not text:
            continue

        all_texts.append(text)

        start_ms = int(seg.start_sample / sample_rate * 1000)
        end_ms = start_ms + int(len(seg.samples) / sample_rate * 1000)

        sentences = _split_sentences(text) or [text]
        seg_duration_ms = end_ms - start_ms
        total_chars = sum(len(s) for s in sentences)
        cursor_ms = start_ms

        for s_idx, sentence in enumerate(sentences):
            proportion = len(sentence) / total_chars if total_chars > 0 else 1.0
            s_end = cursor_ms + int(seg_duration_ms * proportion)
            if s_idx == len(sentences) - 1:
                s_end = end_ms
            segment = Segment(
                index=0,  # will be reassigned after correction
                start_ms=cursor_ms,
                end_ms=s_end,
                text=sentence,
            )
            seg_queue.put(segment)
            cursor_ms = s_end

    # Signal end to correction thread
    seg_queue.put(SENTINEL)
    correction_thread.join(timeout=120)

    # Reassign indices and build final result
    with output_lock:
        for i, seg in enumerate(corrected_output):
            corrected_output[i] = replace(seg, index=i)

    final_text = " ".join(seg.text for seg in corrected_output).strip()

    if progress_cb:
        progress_cb(1.0, "完成", final_text)

    return TranscriptionResult(
        text=final_text, segments=corrected_output, duration_ms=duration_ms
    )
```

**Step 3: Verify existing behavior unchanged (no correction engine)**

Run: `python -m pytest backend/tests/ -v`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add backend/asr_engine.py
git commit -m "feat: integrate dual-thread correction pipeline into ASREngine"
```

---

### Task 9: Thread Allocation Logic

**Files:**
- Modify: `backend/asr_engine.py` — add `_allocate_threads` static method

**Step 1: Add thread allocation method**

```python
@staticmethod
def _allocate_threads(total: int, correction_active: bool) -> tuple[int, int]:
    """Return (transcribe_threads, correction_threads).

    When correction is active, split physical cores 2:1.
    When inactive, all cores go to transcription.
    """
    if not correction_active:
        return total, 0
    transcribe = max(2, total * 2 // 3)
    correction = max(1, total - transcribe)
    return transcribe, correction
```

**Step 2: Wire into transcribe call**

In `_transcribe_with_vad`, before starting threads, dynamically set thread counts:

```python
total_threads = self._default_num_threads()
has_correction = self._correction_engine is not None and self._correction_engine.has_model()
t_threads, c_threads = self._allocate_threads(total_threads, has_correction)

# Apply transcription thread count (update recognizer if needed)
# Correction thread count is passed to CorrectionEngine at init time
```

**Step 3: Commit**

```bash
git add backend/asr_engine.py
git commit -m "feat: dynamic thread allocation for transcribe/correction"
```

---

### Task 10: Hotword API Endpoints

**Files:**
- Modify: `backend/app.py` — add hotword endpoints and wire HotwordManager

**Step 1: Add hotword endpoints to app.py**

At top of `app.py`, add imports and init:

```python
from hotwords import HotwordManager
from pathlib import Path
import platform

def _get_hotwords_path() -> Path:
    if platform.system() == "Darwin":
        return Path.home() / "Library" / "Application Support" / "com.echosmith.app" / "hotwords.json"
    elif platform.system() == "Windows":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            return Path(appdata) / "echosmith" / "hotwords.json"
    return Path.home() / ".config" / "echosmith" / "hotwords.json"

hotword_manager = HotwordManager(_get_hotwords_path())
```

Add three endpoints:

```python
@app.get("/api/hotwords")
async def list_hotwords(_: None = Depends(verify_token)) -> JSONResponse:
    return JSONResponse({"words": hotword_manager.list_all()})


@app.post("/api/hotwords")
async def add_hotword(request: Request, _: None = Depends(verify_token)) -> JSONResponse:
    body = await request.json()
    word = body.get("word", "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="热词不能为空")
    hotword_manager.add(word)
    return JSONResponse({"words": hotword_manager.list_all()})


@app.delete("/api/hotwords/{word}")
async def remove_hotword(word: str, _: None = Depends(verify_token)) -> JSONResponse:
    hotword_manager.remove(word)
    return JSONResponse({"words": hotword_manager.list_all()})
```

**Step 2: Wire HotwordManager into CorrectionEngine at task start**

In `_run_task`, before calling `engine.transcribe`, set hot words:

```python
if engine._correction_engine:
    engine._correction_engine.set_hot_words(hotword_manager.list_all())
```

**Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add hotword REST API and wire into correction engine"
```

---

### Task 11: CorrectionEngine Initialization in App

**Files:**
- Modify: `backend/app.py` — initialize CorrectionEngine alongside ASREngine

**Step 1: Add correction engine setup**

```python
from correction_engine import CorrectionEngine

def _get_correction_model_path() -> str:
    """Locate correction model: bundled first, then cache."""
    import sys
    if getattr(sys, "frozen", False):
        bundled = Path(sys._MEIPASS) / "models_cache" / "correction" / "qwen2.5-0.5b-q4.gguf"
        if bundled.exists():
            return str(bundled)

    if platform.system() == "Windows":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            return os.path.join(local, "sherpa-onnx", "correction", "qwen2.5-0.5b-q4.gguf")
    return os.path.expanduser("~/.cache/sherpa-onnx/correction/qwen2.5-0.5b-q4.gguf")

# After engine = ASREngine(), add:
_correction_model_path = _get_correction_model_path()
correction_engine: CorrectionEngine | None = None
if Path(_correction_model_path).exists():
    total_threads = ASREngine._default_num_threads()
    _, c_threads = ASREngine._allocate_threads(total_threads, correction_active=True)
    correction_engine = CorrectionEngine(
        model_path=_correction_model_path,
        hot_words=hotword_manager.list_all(),
        num_threads=c_threads,
    )
    t_threads, _ = ASREngine._allocate_threads(total_threads, correction_active=True)
    engine = ASREngine(num_threads=t_threads, correction_engine=correction_engine)
else:
    engine = ASREngine()
```

**Step 2: Add correction model health check fields**

In `/api/health` endpoint, add:

```python
"correction_model": Path(_correction_model_path).exists(),
"correction_model_loaded": correction_engine is not None and correction_engine.has_model(),
"correction_model_path": _correction_model_path,
```

**Step 3: Add correction model download endpoint**

```python
@app.post("/api/models/correction/download")
async def trigger_correction_download(_: None = Depends(verify_token)) -> JSONResponse:
    if Path(_correction_model_path).exists():
        return JSONResponse({"status": "already_exists"})
    # Trigger download in background
    asyncio.create_task(_download_correction_model())
    return JSONResponse({"status": "started"})
```

**Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat: initialize CorrectionEngine and add health check fields"
```

---

### Task 12: Model Download Script Extension

**Files:**
- Modify: `scripts/download_models.py`

**Step 1: Add correction model download function**

```python
# Qwen2.5-0.5B Q4 GGUF for correction
CORRECTION_MODEL_URL = "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
CORRECTION_MODEL_NAME = "qwen2.5-0.5b-q4.gguf"


def download_correction_model(cache_dir: Path) -> None:
    """Download Qwen2.5-0.5B Q4 GGUF model for post-correction."""
    correction_dir = cache_dir / "correction"
    model_path = correction_dir / CORRECTION_MODEL_NAME
    if model_path.exists():
        print(f"Correction model already exists: {model_path} ({model_path.stat().st_size / 1024 / 1024:.1f} MB)")
        return

    correction_dir.mkdir(parents=True, exist_ok=True)
    download_file(CORRECTION_MODEL_URL, model_path, "Downloading correction model (Qwen2.5-0.5B Q4)")
    print(f"Correction model downloaded: {model_path} ({model_path.stat().st_size / 1024 / 1024:.1f} MB)")
```

**Step 2: Add to main block**

```python
if __name__ == "__main__":
    # ... existing code ...
    try:
        download_models(cache_dir)
        download_silero_vad(cache_dir.parent)
        download_correction_model(cache_dir.parent)  # ADD THIS
    except Exception as e:
        ...
```

**Step 3: Commit**

```bash
git add scripts/download_models.py
git commit -m "feat: add correction model download to download_models.py"
```

---

### Task 13: PyInstaller Packaging Updates

**Files:**
- Modify: `backend/backend.spec`
- Modify: `backend/__main__.py`

**Step 1: Update backend.spec**

Add `llama_cpp` to hidden imports and collect:

```python
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

datas = []
datas += collect_data_files('funasr')

binaries = collect_dynamic_libs('llama_cpp')

a = Analysis(
    ['__main__.py'],
    ...
    binaries=binaries,
    datas=datas,
    hiddenimports=[
        'backend.app', 'backend.asr_engine', 'backend.task_store',
        'backend.url_downloader', 'backend.correction_engine',
        'backend.hotwords', 'backend.pipeline',
    ],
    ...
)
```

**Step 2: Update __main__.py for bundled correction model**

Add after the SenseVoice model cache setup:

```python
# Also set up correction model path
bundled_correction = bundle_dir / "models_cache" / "correction"
if bundled_correction.exists():
    print(f"[INIT] Found bundled correction model at: {bundled_correction}")
```

**Step 3: Commit**

```bash
git add backend/backend.spec backend/__main__.py
git commit -m "build: update PyInstaller config for correction engine"
```

---

### Task 14: Frontend — Hotword API Client

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Step 1: Add hotword API functions and update HealthStatus**

```typescript
// Update HealthStatus interface:
export interface HealthStatus {
  // ... existing fields ...
  correction_model?: boolean;
  correction_model_loaded?: boolean;
  correction_model_path?: string;
}

// Add hotword API functions:
export async function fetchHotwords(): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.get<{ words: string[] }>("/hotwords");
  return response.data.words;
}

export async function addHotword(word: string): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.post<{ words: string[] }>("/hotwords", { word });
  return response.data.words;
}

export async function removeHotword(word: string): Promise<string[]> {
  await ensureBackendBase();
  const response = await apiClient.delete<{ words: string[] }>(
    `/hotwords/${encodeURIComponent(word)}`
  );
  return response.data.words;
}

export async function triggerCorrectionModelDownload(): Promise<{ status: string }> {
  await ensureBackendBase();
  const response = await apiClient.post<{ status: string }>("/models/correction/download");
  return response.data;
}
```

**Step 2: Update fetchHealth to include correction fields**

In `fetchHealth`, add to return object:

```typescript
correction_model: data.correction_model ?? false,
correction_model_loaded: data.correction_model_loaded ?? false,
correction_model_path: data.correction_model_path,
```

**Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add hotword and correction model API client functions"
```

---

### Task 15: Frontend — Hotword Settings Component

**Files:**
- Create: `frontend/src/components/HotwordSettings.tsx`

**Step 1: Create the component**

```tsx
import { useEffect, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { fetchHotwords, addHotword, removeHotword } from "../lib/api";

export function HotwordSettings(): JSX.Element {
  const [words, setWords] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchHotwords().then(setWords).catch(console.error);
  }, []);

  const handleAdd = async () => {
    const word = input.trim();
    if (!word) return;
    setLoading(true);
    try {
      const updated = await addHotword(word);
      setWords(updated);
      setInput("");
    } catch (error) {
      console.error("添加热词失败:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (word: string) => {
    try {
      const updated = await removeHotword(word);
      setWords(updated);
    } catch (error) {
      console.error("删除热词失败:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Card className="space-y-3">
      <h3 className="text-sm font-semibold">热词表</h3>
      <p className="text-xs text-muted-foreground">
        添加专业术语、人名等，纠错时优先使用这些词汇
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          placeholder="输入热词…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <Button
          variant="secondary"
          size="sm"
          className="gap-1"
          disabled={!input.trim() || loading}
          onClick={handleAdd}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {words.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
          >
            {word}
            <button
              className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20 transition-colors"
              onClick={() => handleRemove(word)}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        {words.length === 0 && (
          <span className="text-xs text-muted-foreground">暂无热词</span>
        )}
      </div>
    </Card>
  );
}
```

**Step 2: Integrate into existing settings/layout**

Find where settings are rendered and add `<HotwordSettings />`. The exact location depends on whether there's an existing settings panel — check `App.tsx` or equivalent layout file to determine placement.

**Step 3: Commit**

```bash
git add frontend/src/components/HotwordSettings.tsx
git commit -m "feat: add HotwordSettings component with tag-based UI"
```

---

### Task 16: Frontend — Integrate HotwordSettings into Layout

**Files:**
- Modify: The main layout file (check `App.tsx` or equivalent)

**Step 1: Import and place HotwordSettings**

Add `<HotwordSettings />` in the settings area or below the task stream panel. Exact placement depends on the current layout structure.

**Step 2: Verify the UI renders**

Run: `cd frontend && pnpm dev`
Open browser, confirm hotword panel appears and add/remove works.

**Step 3: Commit**

```bash
git add frontend/src/
git commit -m "feat: integrate HotwordSettings into main layout"
```

---

### Task 17: Install llama-cpp-python Dependency

**Files:**
- Modify: `requirements.txt` (if exists) or document in README

**Step 1: Install dependency**

Run: `pip install llama-cpp-python>=0.3.0`

On Apple Silicon, this auto-enables Metal acceleration.

**Step 2: Add to requirements**

```bash
echo "llama-cpp-python>=0.3.0" >> requirements.txt
```

(Or add to existing dependency file.)

**Step 3: Download correction model for testing**

Run: `python scripts/download_models.py`

This should now also download the correction model.

**Step 4: Commit**

```bash
git add requirements.txt
git commit -m "deps: add llama-cpp-python for LLM correction"
```

---

### Task 18: End-to-End Smoke Test

**Step 1: Start backend**

Run: `cd backend && python __main__.py`

**Step 2: Verify health check includes correction fields**

Run: `curl http://127.0.0.1:5179/api/health | python -m json.tool`

Expected: response includes `correction_model`, `correction_model_loaded`, `correction_model_path`

**Step 3: Test hotword API**

```bash
curl -X POST http://127.0.0.1:5179/api/hotwords -H 'Content-Type: application/json' -d '{"word":"暗能量"}'
curl http://127.0.0.1:5179/api/hotwords
curl -X DELETE http://127.0.0.1:5179/api/hotwords/暗能量
```

**Step 4: Test transcription with correction**

Upload a short audio file and verify:
- Progress shows "转写中" then "智能纠错中"
- Final result_text is corrected
- When correction model is absent, transcription works normally (degraded mode)

**Step 5: Commit final integration**

```bash
git add -A
git commit -m "feat: context-aware correction pipeline complete"
```

---

## Task Dependency Graph

```
Task 1 (test infra)
  ├── Task 2 (hotword tests) → Task 3 (hotword impl)
  ├── Task 4 (correction tests) → Task 5 (correction impl)
  └── Task 6 (pipeline tests) → Task 7 (pipeline impl)
                                       ↓
                                 Task 8 (ASR integration)
                                       ↓
                                 Task 9 (thread allocation)
                                       ↓
                                 Task 10 (hotword API)
                                       ↓
                                 Task 11 (app init)
                                       ↓
                                 Task 12 (model download)
                                       ↓
                                 Task 13 (PyInstaller)
                                       ↓
                                 Task 14 (frontend API)
                                       ↓
                                 Task 15 (hotword UI)
                                       ↓
                                 Task 16 (layout integration)
                                       ↓
                                 Task 17 (deps)
                                       ↓
                                 Task 18 (smoke test)
```

Tasks 2-3, 4-5, 6-7 can run in parallel after Task 1.
