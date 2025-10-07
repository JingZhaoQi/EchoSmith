"""Entrypoint to run EchoSmith backend with uvicorn."""

from __future__ import annotations

import os

import uvicorn

from .app import app

if __name__ == "__main__":
    port = int(os.environ.get("ECHOSMITH_PORT", "5179"))
    host = os.environ.get("ECHOSMITH_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port, log_level="info")
