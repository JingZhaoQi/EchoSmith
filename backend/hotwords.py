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
