import asyncio

from task_store import TaskRecord, TaskStore


def test_subscribe_closes_cleanly_when_task_deleted() -> None:
    asyncio.run(_subscribe_then_delete())


async def _subscribe_then_delete() -> None:
    store = TaskStore()
    record = await store.create_task(TaskRecord(id="t1", source={"name": "a.m4a"}))

    received: list[dict] = []

    async def consume() -> None:
        async for event in store.subscribe("t1"):
            received.append(event)

    consumer = asyncio.ensure_future(consume())
    await asyncio.sleep(0)  # let the subscriber attach and receive the snapshot
    await store.delete_task("t1")
    await asyncio.wait_for(consumer, timeout=1)  # must exit, never yield None

    assert received == [record.snapshot()]


def test_live_snapshot_is_light_and_summary_has_no_text() -> None:
    import asyncio

    from task_store import MAX_SNAPSHOT_LOGS, TaskRecord, TaskStore

    async def scenario() -> None:
        store = TaskStore()
        await store.create_task(TaskRecord(id="t1"))
        for i in range(MAX_SNAPSHOT_LOGS + 20):
            await store.update_task(
                "t1",
                log={"i": i},
                raw_text="原文",
                segments=[{"text": "x"}],
                phase="transcribing",
                asr_progress=0.5,
            )
        record = await store.get_task("t1")
        snap = record.snapshot()
        assert (
            len(snap["logs"]) == MAX_SNAPSHOT_LOGS
            and snap["logs"][-1]["i"] == MAX_SNAPSHOT_LOGS + 19
        )
        assert "segments" not in snap and snap["raw_text"] == "原文"
        assert snap["phase"] == "transcribing" and snap["asr_progress"] == 0.5
        summary = record.summary()
        assert (
            "raw_text" not in summary
            and "logs" not in summary
            and summary["phase"] == "transcribing"
        )

    asyncio.run(scenario())


def test_update_rejects_unknown_fields() -> None:
    import asyncio

    import pytest

    from task_store import TaskRecord, TaskStore

    async def scenario() -> None:
        store = TaskStore()
        await store.create_task(TaskRecord(id="t1"))
        with pytest.raises(TypeError):
            await store.update_task("t1", bogus=1)

    asyncio.run(scenario())
