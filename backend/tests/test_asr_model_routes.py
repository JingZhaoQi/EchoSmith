"""Tests for ASR model API routes."""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

import app as app_module


class FakeASRModelManager:
    def __init__(self, tmp_path: Path, calls: list[str]) -> None:
        self.tmp_path = tmp_path
        self.calls = calls

    def model_dir(self, requested_model_id: str) -> Path:
        return self.tmp_path / requested_model_id

    def is_installed(self, requested_model_id: str) -> bool:
        return False

    def download_model(self, requested_model_id: str, progress_cb=None) -> Path:
        self.calls.append(requested_model_id)
        target = self.tmp_path / requested_model_id
        target.mkdir(parents=True, exist_ok=True)
        if progress_cb:
            progress_cb(0.25, "测试下载中")
        (target / "config.json").write_text("{}", encoding="utf-8")
        return target

    def delete_model(self, requested_model_id: str) -> Path:
        self.calls.append(requested_model_id)
        return self.tmp_path / requested_model_id

    def list_models(self, selected_model_id: str) -> list[dict]:
        return [
            {
                "id": "qwen3-asr-0.6b",
                "selected": selected_model_id == "qwen3-asr-0.6b",
            }
        ]


def test_download_route_returns_success_when_task_is_started(monkeypatch, tmp_path: Path) -> None:
    model_id = "qwen3-asr-0.6b"
    calls: list[str] = []

    app_module.ASR_DOWNLOADS.clear()
    monkeypatch.setattr(app_module, "asr_model_manager", FakeASRModelManager(tmp_path, calls))

    client = TestClient(app_module.app)
    try:
        response = client.post(f"/api/asr/models/{model_id}/download")

        assert response.status_code == 200
        assert response.json() == {
            "status": "started",
            "path": str(tmp_path / model_id),
        }
        assert calls == [model_id]
        assert app_module.ASR_DOWNLOADS[model_id]["status"] == "completed"
        assert app_module.ASR_DOWNLOADS[model_id]["progress"] == 1.0
    finally:
        app_module.ASR_DOWNLOADS.clear()


def test_download_route_supports_compatibility_paths(monkeypatch, tmp_path: Path) -> None:
    client = TestClient(app_module.app)

    for route in (
        "/api/asr-models/qwen3-asr-0.6b/download",
        "/api/models/asr/qwen3-asr-0.6b/download",
    ):
        calls: list[str] = []
        app_module.ASR_DOWNLOADS.clear()
        monkeypatch.setattr(app_module, "asr_model_manager", FakeASRModelManager(tmp_path, calls))
        try:
            response = client.post(route)

            assert response.status_code == 200
            assert response.json()["status"] == "started"
            assert calls == ["qwen3-asr-0.6b"]
        finally:
            app_module.ASR_DOWNLOADS.clear()


def test_model_list_route_supports_compatibility_paths(monkeypatch, tmp_path: Path) -> None:
    calls: list[str] = []
    monkeypatch.setattr(app_module, "asr_model_manager", FakeASRModelManager(tmp_path, calls))
    client = TestClient(app_module.app)

    for route in ("/api/asr/models", "/api/asr-models", "/api/models/asr"):
        response = client.get(route)

        assert response.status_code == 200
        assert response.json()["models"][0]["id"] == "qwen3-asr-0.6b"


def test_delete_route_removes_downloaded_model(monkeypatch, tmp_path: Path) -> None:
    model_id = "qwen3-asr-0.6b"
    calls: list[str] = []

    app_module.ASR_DOWNLOADS[model_id] = {
        "status": "failed",
        "progress": 0.0,
        "message": "下载失败",
        "error": "network",
    }
    monkeypatch.setattr(app_module, "asr_model_manager", FakeASRModelManager(tmp_path, calls))

    client = TestClient(app_module.app)
    try:
        response = client.delete(f"/api/asr/models/{model_id}")

        assert response.status_code == 200
        assert response.json() == {
            "status": "deleted",
            "path": str(tmp_path / model_id),
        }
        assert calls == [model_id]
        assert model_id not in app_module.ASR_DOWNLOADS
    finally:
        app_module.ASR_DOWNLOADS.clear()
