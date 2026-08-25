# Day 08 Lab Report

## 1. Team / student

- **Thành viên nhóm**:
  1. Phạm Văn Sâm - 2A202601837
  2. Mai Quốc Hiếu - 2A202601141
  3. Nguyễn Minh Thái - 2A202601619
- Repo/commit: Track3-DAY23-TruongKon
- Date: 2026-08-25

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
| Total scenarios | 7 |
| Success rate | 100.00% |
| Average nodes visited | 6.43 |
| Total retries | 3 |
| Approval-node visits | 2 |
| Resume success | False |

Latency is currently `0` because core instrumentation does not measure wall-clock time.

| Scenario | Expected route | Actual route | Success | Retries | Approval visits |
|---|---|---|---:|---:|---:|
| S01_simple | simple | simple | yes | 0 | 0 |
| S02_tool | tool | tool | yes | 0 | 0 |
| S03_missing | missing_info | missing_info | yes | 0 | 0 |
| S04_risky | risky | risky | yes | 0 | 1 |
| S05_error | error | error | yes | 2 | 0 |
| S06_delete | risky | risky | yes | 0 | 1 |
| S07_dead_letter | error | error | yes | 1 | 0 |

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
- `S05_error`: retry attempt 1 recorded after transient tool failure; ERROR: simulated transient failure at attempt 1 for: Timeout failure while processing request; retry attempt 2 recorded after transient tool failure
- `S07_dead_letter`: retry attempt 1 recorded after transient tool failure

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
