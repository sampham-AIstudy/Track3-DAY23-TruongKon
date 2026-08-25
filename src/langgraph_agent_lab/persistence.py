"""Checkpointer adapter."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from langgraph.types import Checkpointer


def build_checkpointer(
    kind: str = "memory", database_url: str | None = None
) -> Checkpointer:
    """Return a LangGraph checkpointer.

    SQLite support is included for the persistence extension track.
    The starter provides MemorySaver only — SQLite/Postgres are extension tasks.

    For SQLite:
    - pip install langgraph-checkpoint-sqlite
    - Use SqliteSaver with sqlite3.connect() and WAL mode
    - See: https://langchain-ai.github.io/langgraph/how-tos/persistence/
    """
    if kind == "none":
        return None
    if kind == "memory":
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver()
    if kind == "sqlite":
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver  # type: ignore[import-not-found]
        except ImportError as exc:
            raise RuntimeError(
                "SQLite persistence requires langgraph-checkpoint-sqlite. "
                "Install the project with the [sqlite] extra."
            ) from exc

        database_path = database_url or "checkpoints.db"
        if database_path.startswith("sqlite:///"):
            database_path = database_path.removeprefix("sqlite:///")
        path = Path(database_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        return SqliteSaver(conn=conn)
    if kind == "postgres":
        raise ValueError("Postgres checkpointer is an optional extension and is not implemented")
    raise ValueError(f"Unknown checkpointer kind: {kind}")
