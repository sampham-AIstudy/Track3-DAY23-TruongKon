"""Report generation helper.

Render Markdown reports from MetricsReport data.
"""

from __future__ import annotations

from pathlib import Path

from .metrics import MetricsReport


def render_report(metrics: MetricsReport) -> str:
    """Render a complete lab report from metrics data.

    Generate a report that includes:
    1. Metrics summary table (total scenarios, success rate, retries, interrupts)
    2. Per-scenario results table
    3. Architecture explanation (your graph design, state schema, reducers)
    4. Failure analysis (at least two failure modes you considered)
    5. Improvement plan

    Use reports/lab_report_template.md as your guide.

    Return: formatted markdown string
    """
    scenario_rows = "\n".join(
        f"| {item.scenario_id} | {item.expected_route} | "
        f"{item.actual_route or '(missing)'} | {'yes' if item.success else 'no'} | "
        f"{item.retry_count} | {item.interrupt_count} |"
        for item in metrics.scenario_metrics
    )
    error_rows = "\n".join(
        f"- `{item.scenario_id}`: {'; '.join(item.errors)}"
        for item in metrics.scenario_metrics
        if item.errors
    ) or "- No errors were recorded."
    return f'''# Day 08 Lab Report

## 1. Team / student

- Student: Track3-DAY23-TruongKon team
- Date: generated from the scenario metrics run

## 2. Architecture

The LangGraph `StateGraph` has 11 nodes: intake, classify, tool, evaluate, answer,
clarify, risky_action, approval, retry, dead_letter, and finalize. It uses 8 fixed
edges and 4 conditional routing functions. Retries are bounded by `attempt <
max_attempts`; every branch passes through `finalize` before `END`. Risky requests
create a proposal and pass approval before any tool call.

## 3. State schema

| Field | Reducer | Why |
|---|---|---|
| messages, tool_results, errors, events | append | preserve audit and execution history |
| route, risk_level, attempt, max_attempts | overwrite | represent current control state |
| final_answer, evaluation_result, pending_question | overwrite | retain terminal result |
| proposed_action, approval | overwrite | retain current risky-action proposal and decision |

Nodes return partial updates rather than mutating input state. Each invocation
supplies a distinct `thread_id` through LangGraph configurable data.

## 4. Scenario results

| Metric | Value |
|---|---:|
| Total scenarios | {metrics.total_scenarios} |
| Success rate | {metrics.success_rate:.2%} |
| Average nodes visited | {metrics.avg_nodes_visited:.2f} |
| Total retries | {metrics.total_retries} |
| Approval-node visits | {metrics.total_interrupts} |
| Resume success | {metrics.resume_success} |

Latency is currently `0` because core instrumentation does not measure wall-clock time.

| Scenario | Expected route | Actual route | Success | Retries | Approval visits |
|---|---|---|---:|---:|---:|
{scenario_rows}

## 5. Failure analysis

### Retry and dead-letter

**Failure:** a tool result contains `ERROR`. **Detection:** `evaluate_node` returns
`needs_retry`. **Containment:** the retry counter is bounded. **Termination:**
exhausted work goes to `dead_letter`, then `finalize`. **Residual risk:** the core
evaluator uses an `ERROR` heuristic rather than an LLM-as-judge.

### Risky action

**Risk:** a side effect such as a refund, deletion, or email. **Detection:** the
classifier selects `risky`. **Containment:** `risky_action` prepares a proposal only.
**Gate:** approval occurs before the tool; rejection goes to clarify then finalize.
**Residual risk:** core approval is a mock decision, not real human interrupt/resume.

Recorded runtime errors:
{error_rows}

## 6. Persistence / recovery evidence

The core uses `MemorySaver`, compiled from the caller-supplied checkpointer. State
and history can be read with the same `thread_id` during the process, but
`MemorySaver` does not survive process restart. The optional SQLite adapter uses
`SqliteSaver(conn=sqlite3.connect(...))` with WAL mode for durable checkpoint
recovery when its extra is installed.

## 7. Extension work

SQLite checkpointer support is available as an opt-in extension; the default
configuration remains in-memory.

## 8. Improvement plan

Productionize real HITL interrupt/resume first: persist an approval request and
resume only with an authenticated reviewer decision, while preserving the
approval-before-tool boundary.
'''


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    """Write the rendered report to a file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(metrics), encoding="utf-8")
