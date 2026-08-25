"""Small local HTTP API for the cinematic frontend demo.

Run with ``python -m langgraph_agent_lab.demo_api`` and let Vite proxy ``/api``
requests to this process. The endpoint invokes the real LangGraph workflow; mock
tools and mock approval preserve the lab's no-side-effect contract.
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from uuid import uuid4

from .graph import build_graph
from .persistence import build_checkpointer
from .state import Route, Scenario, initial_state

# A demo must be reliable without an API key.  Operators can explicitly set this
# to ``false`` before startup when they want to demonstrate a live LLM instead.
os.environ.setdefault("LANGGRAPH_OFFLINE_DEMO", "true")

CHECKPOINTER = build_checkpointer("memory")
GRAPH = build_graph(checkpointer=CHECKPOINTER)


def run_workflow(query: str) -> dict[str, Any]:
    """Invoke a fresh, isolated workflow thread and return audit-safe fields."""
    scenario = Scenario(
        id=f"browser-demo-{uuid4().hex}",
        query=query,
        expected_route=Route.SIMPLE,
    )
    state = initial_state(scenario)
    result = GRAPH.invoke(state, config={"configurable": {"thread_id": state["thread_id"]}})
    return {
        "thread_id": result["thread_id"],
        "route": result["route"],
        "final_answer": result.get("final_answer"),
        "pending_question": result.get("pending_question"),
        "proposed_action": result.get("proposed_action"),
        "approval": result.get("approval"),
        "tool_results": result.get("tool_results", []),
        "errors": result.get("errors", []),
        "events": result.get("events", []),
    }


class DemoHandler(BaseHTTPRequestHandler):
    """Serve only the health and workflow demo endpoints."""

    def _write_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._write_json(HTTPStatus.OK, {"status": "ok"})
            return
        self._write_json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/run":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(min(length, 16_384)).decode("utf-8"))
            query = str(payload.get("query", "")).strip()
            if not query:
                raise ValueError("query is required")
            self._write_json(HTTPStatus.OK, run_workflow(query))
        except (ValueError, json.JSONDecodeError) as exc:
            self._write_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception:
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "workflow execution failed"}
            )

    def log_message(self, _format: str, *_args: object) -> None:
        """Avoid noisy request logs during a presentation."""


def main() -> None:
    """Start the local-only demo API."""
    server = ThreadingHTTPServer(("127.0.0.1", 8000), DemoHandler)
    print("LangGraph demo API listening on http://127.0.0.1:8000")
    server.serve_forever()


if __name__ == "__main__":
    main()
