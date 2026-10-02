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
