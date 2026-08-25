# Day 08 Lab Report

## 1. Team / student

- **Thành viên nhóm**:
  1. Phạm Văn Sâm - 2A202601837
  2. Mai Quốc Hiếu - 2A202601141
  3. Nguyễn Minh Thái - 2A202601619
- Repo/commit: Track3-DAY23-TruongKon
- Date: 2026-08-25

## 2. Architecture

Describe your graph nodes, edges, state fields, and reducers.

## 3. State schema

List important fields and whether they are overwrite or append-only.

| Field | Reducer | Why |
|---|---|---|
| messages | append | audit conversation/events |
| route | overwrite | current route only |

## 4. Scenario results

Paste the key metrics from `outputs/metrics.json`.

| Scenario | Expected route | Actual route | Success | Retries | Interrupts |
|---|---|---|---:|---:|---:|

## 5. Failure analysis

Describe at least two failure modes you considered:

1. Retry or tool failure:
2. Risky action without approval:

## 6. Persistence / recovery evidence

Explain how you used checkpointer, thread id, state history, or crash-resume.

## 7. Extension work

Describe any extension you completed: SQLite/Postgres, time travel, fan-out/fan-in, graph diagram, tracing.

## 8. Improvement plan

If you had one more day, what would you productionize first?
