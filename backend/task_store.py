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


@dataclass
class TaskRecord:
    id: str
    status: TaskStatus = TaskStatus.QUEUED
    progress: float = 0.0
    message: str = ""
    result_text: str | None = None
    segments: list[dict[str, Any]] = field(default_factory=list)
    source: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    logs: list[dict[str, Any]] = field(default_factory=list)

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status.value,
            "progress": self.progress,
            "message": self.message,
            "result_text": self.result_text,
            "segments": self.segments,
            "source": self.source,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "logs": self.logs,
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
        self,
        task_id: str,
        *,
        status: TaskStatus | None = None,
        progress: float | None = None,
        message: str | None = None,
        result_text: str | None = None,
        segments: list[dict[str, Any]] | None = None,
        error: str | None = None,
        log: dict[str, Any] | None = None,
    ) -> TaskRecord:
        async with self._lock:
            record = self._tasks[task_id]
            if status is not None:
                record.status = status
            if progress is not None:
                record.progress = progress
            if message is not None:
                record.message = message
            if result_text is not None:
                record.result_text = result_text
            if segments is not None:
                record.segments = segments
            if error is not None:
                record.error = error
            if log is not None:
                record.logs.append(log)
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
