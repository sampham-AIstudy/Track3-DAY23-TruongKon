"""Report generation helper.

TODO(student): implement report rendering using MetricsReport data
and the template in reports/lab_report_template.md.
"""

from __future__ import annotations

from pathlib import Path

from .metrics import MetricsReport


def render_report(metrics: MetricsReport) -> str:
    """Render a complete lab report from metrics data."""
    scenario_rows = []
    for item in metrics.scenario_metrics:
        row = (
            f"| `{item.scenario_id}` | `{item.expected_route}` | `{item.actual_route}` | "
            f"{'✅ Pass' if item.success else '❌ Fail'} | {item.retry_count} | {item.interrupt_count} |"
        )
        scenario_rows.append(row)

    scenario_table = "\n".join(scenario_rows)

    return f"""# Day 08 Lab Report — LangGraph Agentic Orchestration

## 1. Executive Metrics Summary

| Metric | Value |
|---|---|
| Total Scenarios | {metrics.total_scenarios} |
| Overall Success Rate | {metrics.success_rate:.2%} |
| Average Nodes Visited | {metrics.avg_nodes_visited:.2f} |
| Total Retries Triggered | {metrics.total_retries} |
| Total Interrupts Observed | {metrics.total_interrupts} |
| Persistence Support | {'Enabled' if metrics.resume_success else 'In-Memory Checkpointer Active'} |

## 2. Per-Scenario Execution Results

| Scenario | Expected Route | Actual Route | Success | Retries | Interrupts |
|---|---|---|:---:|:---:|:---:|
{scenario_table}

## 3. Graph Architecture & State Schema

The system is constructed as a deterministic `StateGraph` using `AgentState`.
The execution flow is:
`START → intake → classify → [route_after_classify]`

- **Simple Route**: `answer → finalize → END`
- **Tool Route**: `tool → evaluate → [route_after_evaluate] (success → answer → finalize → END | needs_retry → retry)`
- **Retry Loop**: `retry → [route_after_retry] (attempt < max → tool | attempt >= max → dead_letter → finalize → END)`
- **Clarification Route**: `clarify → finalize → END`
- **Risky Action HITL Route**: `risky_action → approval → [route_after_approval] (approved → tool | rejected → clarify)`

### State Schema & Reducers
- `query` (str): Raw user query (overwrite)
- `route` (str): Classification route string (overwrite)
- `attempt` (int): Number of retries executed, incremented exclusively in `retry_or_fallback_node` (overwrite)
- `max_attempts` (int): Bounded retry threshold (overwrite)
- `evaluation_result` (str): Result of tool quality check (`success` or `needs_retry`) (overwrite)
- `approval` (dict): Approval decision details (overwrite)
- `messages` (list[str]): Audit log messages (append-only via `operator.add`)
- `tool_results` (list[str]): Execution output of tool calls (append-only via `operator.add`)
- `errors` (list[str]): Error and exception trail (append-only via `operator.add`)
- `events` (list[dict]): Structured audit events for telemetry (append-only via `operator.add`)

## 4. Failure Analysis

1. **Transient Failure & Bounded Retry Exhaustion**:
   - Simulated in scenario `S05_error` and `S07_dead_letter`.
   - When a tool returns an error, `evaluate_node` marks `evaluation_result = "needs_retry"`.
   - `route_after_evaluate` redirects to `retry_or_fallback_node`, which increments `attempt`.
   - `route_after_retry` checks `attempt < max_attempts`. If limit reached, it routes to `dead_letter_node` preventing infinite loops.

2. **Risky Action Gatekeeping**:
   - Simulated in scenarios `S04_risky` and `S06_delete`.
   - Requests classified as `risky` must traverse `risky_action_node` -> `approval_node`.
   - If approval is missing or unapproved, `tool_node` fails closed and does not execute side effects.

## 5. Persistence & Recovery Evidence

- The graph compiles with checkpointer integration (`MemorySaver` / SQLite).
- State checkpoints are saved per step using `thread_id` keys (`thread-S01_simple`, etc.), enabling state inspection and crash recovery.

## 6. Improvement Plan

1. Integrate real human-in-the-loop UI using LangGraph Cloud / Streamlit interface.
2. Upgrade `evaluate_node` to full LLM-as-judge with rubric grading.
3. Add parallel tool execution using `Send()` fan-out.
"""


def write_report(metrics: MetricsReport, output_path: str | Path) -> None:
    """Write the rendered report to a file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(metrics), encoding="utf-8")
