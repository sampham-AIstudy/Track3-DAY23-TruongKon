"""CLI for the lab."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Annotated, cast

import typer
import yaml  # type: ignore[import-untyped]
from langchain_core.runnables import RunnableConfig

from .graph import build_graph
from .metrics import MetricsReport, metric_from_state, summarize_metrics, write_metrics
from .persistence import build_checkpointer
from .report import write_report
from .scenarios import load_scenarios
from .state import initial_state

app = typer.Typer(no_args_is_help=True)


@app.command("run-scenarios")
def run_scenarios(
    config: Annotated[Path, typer.Option("--config")],
    output: Annotated[Path, typer.Option("--output")],
) -> None:
    """Run all grading scenarios and write metrics JSON."""
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    scenarios = load_scenarios(cfg["scenarios_path"])
    checkpointer = build_checkpointer(cfg.get("checkpointer", "memory"), cfg.get("database_url"))
    graph = build_graph(checkpointer=checkpointer)
    metrics = []
    for scenario in scenarios:
        state = initial_state(scenario)
        run_config = cast(
            RunnableConfig, {"configurable": {"thread_id": state["thread_id"]}}
        )
        final_state = graph.invoke(state, config=run_config)
        metrics.append(
            metric_from_state(
                final_state, scenario.expected_route.value, scenario.requires_approval
            )
        )
    report = summarize_metrics(metrics)
    write_metrics(report, output)
    if cfg.get("report_path"):
        write_report(report, cfg["report_path"])
    typer.echo(f"Wrote metrics to {output}")


@app.command("demo")
def demo(
    config: Annotated[Path, typer.Option("--config")],
    offline: Annotated[bool, typer.Option("--offline/--live")] = True,
) -> None:
    """Run every sample scenario and print its complete LangGraph audit trail."""
    cfg = yaml.safe_load(config.read_text(encoding="utf-8"))
    previous_offline = os.environ.get("LANGGRAPH_OFFLINE_DEMO")
    if offline:
        os.environ["LANGGRAPH_OFFLINE_DEMO"] = "true"
    scenarios = load_scenarios(cfg["scenarios_path"])
    graph = build_graph(
        checkpointer=build_checkpointer(
            cfg.get("checkpointer", "memory"), cfg.get("database_url")
        )
    )
    try:
        for scenario in scenarios:
            state = initial_state(scenario)
            run_config = cast(
                RunnableConfig, {"configurable": {"thread_id": state["thread_id"]}}
            )
            result = graph.invoke(state, config=run_config)
            trace = " -> ".join(
                event.get("node", "unknown") for event in result.get("events", [])
            )
            terminal = (
                result.get("final_answer")
                or result.get("pending_question")
                or "(no terminal response)"
            )
            typer.echo(
                f"\n{scenario.id}: expected={scenario.expected_route.value} "
                f"actual={result.get('route')}"
            )
            typer.echo(f"  trace: {trace}")
            typer.echo(f"  terminal: {terminal}")
            if result.get("tool_results"):
                typer.echo(f"  tool_results: {result['tool_results']}")
            if result.get("errors"):
                typer.echo(f"  audit_errors: {result['errors']}")
    finally:
        if previous_offline is None:
            os.environ.pop("LANGGRAPH_OFFLINE_DEMO", None)
        else:
            os.environ["LANGGRAPH_OFFLINE_DEMO"] = previous_offline


@app.command("validate-metrics")
def validate_metrics(metrics: Annotated[Path, typer.Option("--metrics")]) -> None:
    """Validate metrics JSON schema for grading."""
    payload = json.loads(metrics.read_text(encoding="utf-8"))
    report = MetricsReport.model_validate(payload)
    if report.total_scenarios < 6:
        raise typer.BadParameter("Expected at least 6 scenarios")
    typer.echo(f"Metrics valid. success_rate={report.success_rate:.2%}")


if __name__ == "__main__":
    app()
