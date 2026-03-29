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
