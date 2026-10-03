"""In-memory task registry and progress broadcasting for EchoSmith."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


MAX_SNAPSHOT_LOGS = 30
MAX_STORED_LOGS = 200


@dataclass
class TaskRecord:
    id: str
    status: TaskStatus = TaskStatus.QUEUED
    progress: float = 0.0  # overall, never decreases
    message: str = ""
    phase: str = "queued"  # queued | downloading | transcribing | correcting | done
    asr_progress: float = 0.0
    correction_enabled: bool = False
    correction_progress: float = 0.0
    correction_failed_batches: int = 0
    result_text: str | None = (
        None  # corrected text when correction is enabled, else the raw transcript
    )
    raw_text: str | None = None
    segments: list[dict[str, Any]] = field(default_factory=list)  # raw cues
    corrected_segments: list[dict[str, Any]] = field(default_factory=list)
    source: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    logs: list[dict[str, Any]] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        """Lightweight state for the task list (no text)."""
        return {
            "id": self.id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "phase": self.phase,
            "asr_progress": self.asr_progress,
            "correction_enabled": self.correction_enabled,
            "correction_progress": self.correction_progress,
            "correction_failed_batches": self.correction_failed_batches,
            "source": self.source,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def snapshot(self) -> dict[str, Any]:
        """Live state for the open task: texts and recent logs, but not the cue lists (export reads those)."""
        return {
            **self.summary(),
            "result_text": self.result_text,
            "raw_text": self.raw_text,
            "logs": self.logs[-MAX_SNAPSHOT_LOGS:],
        }


_UPDATABLE = {
    "status",
    "progress",
    "message",
    "phase",
    "asr_progress",
    "correction_enabled",
    "correction_progress",
    "correction_failed_batches",
    "result_text",
    "raw_text",
    "segments",
    "corrected_segments",
    "error",
}


class TaskStore:
    def __init__(self) -> None:
        self._tasks: dict[str, TaskRecord] = {}
        self._queues: dict[str, list[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def create_task(self, task: TaskRecord) -> TaskRecord:
        async with self._lock:
            self._tasks[task.id] = task
            self._queues.setdefault(task.id, [])
        await self._broadcast(task)
        return task

    async def update_task(
        self, task_id: str, *, log: dict[str, Any] | None = None, **changes: Any
    ) -> TaskRecord | None:
        """Apply field changes (None values are ignored) and broadcast; returns None if the task was deleted."""
        unknown = set(changes) - _UPDATABLE
        if unknown:
            raise TypeError(f"unknown task fields: {sorted(unknown)}")
        async with self._lock:
            record = self._tasks.get(task_id)
            if record is None:
                return None
            for key, value in changes.items():
                if value is not None:
                    setattr(record, key, value)
            if log is not None:
                record.logs.append(log)
                del record.logs[:-MAX_STORED_LOGS]
            record.updated_at = time.time()
        await self._broadcast(record)
        return record

    async def get_task(self, task_id: str) -> TaskRecord:
        return self._tasks[task_id]

    async def list_tasks(self) -> list[TaskRecord]:
        return list(self._tasks.values())

    async def delete_task(self, task_id: str) -> None:
        async with self._lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
            if task_id in self._queues:
                # Close all WebSocket connections for this task
                for queue in self._queues[task_id]:
                    queue.put_nowait(None)  # Signal to close
                del self._queues[task_id]

    async def subscribe(self, task_id: str) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue = asyncio.Queue()
        async with self._lock:
            self._queues.setdefault(task_id, []).append(queue)
            if task_id in self._tasks:
                await queue.put(self._tasks[task_id].snapshot())

        try:
            while True:
                item = await queue.get()
                if item is None:  # task deleted, close the stream
                    break
                yield item
        finally:
            async with self._lock:
                watchers = self._queues.get(task_id, [])
                if queue in watchers:
                    watchers.remove(queue)

    async def _broadcast(self, task: TaskRecord) -> None:
        snapshot = task.snapshot()
        async with self._lock:
            queues = list(self._queues.get(task.id, []))
        for queue in queues:
            await queue.put(snapshot)


task_store = TaskStore()
