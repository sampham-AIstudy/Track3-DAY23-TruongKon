## Người 2 — Tool execution + Evaluate + Retry/Dead-letter + Routing + Metrics

Với cách chia **3 người**, Người 2 nên sở hữu toàn bộ nhánh **tool/error/retry** và phần **routing/metrics**. Đây là một workstream khá độc lập: nhận `AgentState` đã được Người 1 chuẩn hóa, xử lý execution loop, rồi cung cấp contract ổn định để Người 3 wiring graph.

README xác định `tool_node`, `evaluate_node`, `retry_or_fallback_node`, `dead_letter_node` là các TODO chính; đồng thời `routing.py` có 4 routing function phải implement và bounded retry là contract bắt buộc. 

---

# Scope của Người 2

### File chính

```text
src/langgraph_agent_lab/nodes.py
src/langgraph_agent_lab/routing.py
src/langgraph_agent_lab/metrics.py
tests/test_routing.py          # chỉ đọc / có thể thêm test riêng nếu được phép
```

### Trong `nodes.py` chỉ sở hữu

```text
tool_node
evaluate_node
retry_or_fallback_node
dead_letter_node
```

Không sửa:

```text
classify_node
answer_node
ask_clarification_node
```

vì thuộc Người 1.

Và chưa sửa:

```text
risky_action_node
approval_node
finalize_node
```

để dành cho Người 3.

---

# Task 1 — Audit contract trước khi code

Đọc:

```text
src/langgraph_agent_lab/nodes.py
src/langgraph_agent_lab/routing.py
src/langgraph_agent_lab/metrics.py
src/langgraph_agent_lab/state.py
tests/test_routing.py
tests/test_metrics.py
data/sample/scenarios.jsonl
```

Tìm TODO:

```powershell
rg -n "TODO\(student\)|NotImplementedError" src/langgraph_agent_lab tests
```

Người 2 phải xác định rõ:

```text
- attempt ban đầu là gì
- max_attempts nằm ở đâu
- tool_results dùng reducer nào
- errors dùng reducer nào
- evaluation_result có shape gì
- routing function phải trả tên node nào
- metric_from_state() đang tính retry như thế nào
```

---

# Task 2 — Implement `tool_node`

File:

```text
src/langgraph_agent_lab/nodes.py
```

## Input

Đọc:

```text
query
route
attempt
```

Có thể đọc:

```text
approval
proposed_action
```

nếu graph đang xử lý risky action đã được duyệt.

## Output

Phải append:

```text
tool_results
events
```

Nếu tool fail thật:

```text
errors
```

### Quan trọng

`tool_results` là append-only.

Không:

```python
results = state["tool_results"]
results.append(new_result)

return {"tool_results": results}
```

Đúng:

```python
return {
    "tool_results": [new_result],
    "events": [make_event(...)]
}
```

---

# Task 3 — Implement error simulation đúng starter contract

Theo lab, nhánh `error` dùng mock tool để tạo retry behavior.

Contract concept:

```text
route == "error"
AND attempt < 2
→ tool result chứa ERROR
```

Các trường hợp khác:

```text
→ mock success
```

Mục đích là để:

```text
tool
→ evaluate
→ retry
```

có failure thật để graph xử lý.

Không hard-code:

```python
if scenario_id == "S05_error":
```

hay:

```python
if scenario_id == "S07_dead_letter":
```

README cảnh báo hidden scenarios nên implementation không được lookup bằng scenario ID hoặc exact query. 

---

# Task 4 — Bảo vệ risky action trong `tool_node`

Người 2 không sở hữu approval node, nhưng `tool_node` vẫn phải tôn trọng contract.

Nếu:

```text
route == risky
```

thì tool chỉ được chạy **sau khi approval đã tồn tại và approved=True**.

Không được để:

```text
risky_action
→ tool
→ approval
```

Correct architecture:

```text
risky_action
→ approval
→ tool
```

Nếu tool nhận risky state mà chưa approved, nên fail closed hoặc ghi failure có audit thay vì thực thi side effect.

---

# Task 5 — Implement `evaluate_node`

## Input

Chỉ đánh giá **latest tool result**:

```python
state["tool_results"][-1]
```

Không lấy:

```python
state["tool_results"][0]
```

vì retry có thể tạo nhiều tool results.

---

## Core verdict

Base implementation đủ:

```text
latest result contains ERROR
→ evaluation_result = "needs_retry"

otherwise
→ evaluation_result = "success"
```

Output:

```text
evaluation_result
events
```

Có thể thêm reason vào event metadata.

---

## Không cần LLM-as-judge ngay

README coi LLM evaluation là bonus/SHOULD, không phải MUST. Classifier và answer mới là hai node bắt buộc dùng LLM. 

Do đó core trước:

```text
ERROR heuristic
```

Sau khi toàn lab xanh mới cân nhắc:

```text
structured LLM judge
```

---

# Task 6 — Implement `retry_or_fallback_node`

Đây là node quan trọng nhất của Người 2.

## Quy tắc tuyệt đối

**Chỉ retry node tăng `attempt`.**

Không:

```text
tool tăng attempt
evaluate tăng attempt
routing tăng attempt
```

Chỉ:

```text
retry_node:
attempt_old
→ attempt_new = attempt_old + 1
```

Output:

```text
attempt
errors
events
```

---

## Example

Initial:

```text
attempt = 0
max_attempts = 3
```

Retry lần 1:

```text
attempt = 1
```

Retry lần 2:

```text
attempt = 2
```

Retry lần 3:

```text
attempt = 3
```

Routing mới quyết định còn được tool lại hay không.

---

# Task 7 — Không mutate `errors`

Sai:

```python
errors = state["errors"]
errors.append("retry...")
return {"errors": errors}
```

Đúng:

```python
return {
    "errors": ["retry recorded ..."],
    "events": [make_event(...)]
}
```

Reducer của state sẽ append.

---

# Task 8 — Implement `dead_letter_node`

Node này xử lý retry exhaustion.

## Input

```text
attempt
max_attempts
errors
tool_results
```

## Output

```text
final_answer
events
```

Ví dụ nội dung:

```text
The request could not be completed after the configured retry limit and has been escalated for manual review.
```

Không cần đúng wording này, nhưng phải:

* có thông tin thất bại;
* có escalation/fallback;
* không trả rỗng.

---

## Cực kỳ quan trọng

Không:

```python
return {
    "route": "dead_letter"
}
```

`route` phải giữ classification ban đầu:

```text
error
```

vì metrics dùng actual route để so với expected route.

---

# Task 9 — Implement `route_after_classify`

File:

```text
src/langgraph_agent_lab/routing.py
```

Decision table:

```text
simple       -> answer
tool         -> tool
missing_info -> clarify
risky        -> risky_action
error        -> retry
unknown      -> answer
```

Unknown route phải fail-safe về:

```text
answer
```

theo public contract.

---

# Task 10 — Implement `route_after_evaluate`

Logic:

```text
evaluation_result == "needs_retry"
→ retry
```

Mọi giá trị khác:

```text
→ answer
```

Không gọi LLM trong routing.

Không mutate state.

---

# Task 11 — Implement `route_after_retry`

Logic bắt buộc:

```text
attempt < max_attempts
→ tool

attempt >= max_attempts
→ dead_letter
```

README nêu trực tiếp rằng nếu không kiểm tra `attempt < max_attempts`, error scenarios có thể loop vô hạn. 

### Phải test đủ 3 boundary

```text
attempt < max_attempts
attempt == max_attempts
attempt > max_attempts
```

Expected:

```text
<   -> tool
==  -> dead_letter
>   -> dead_letter
```

`>` phải fail closed.

---

# Task 12 — Implement `route_after_approval`

Người 3 sẽ viết `approval_node`, nhưng Người 2 sở hữu routing function.

Input expected:

```python
state["approval"]
```

Approval là mapping:

```python
{
    "approved": True/False,
    ...
}
```

Logic:

```text
approved is True
→ tool

false / missing / rejected
→ clarify
```

Không:

```text
rejected -> answer
```

Rejected phải hỏi/clarify trước khi finalize.

---

# Task 13 — Routing function phải pure

Bốn function này:

```text
route_after_classify
route_after_evaluate
route_after_retry
route_after_approval
```

chỉ được:

```text
read state
→ return node name
```

Không:

```python
state["attempt"] += 1
```

Không:

```python
get_llm().invoke(...)
```

Không:

```python
tool(...)
```

Không append event.

---

# Task 14 — Test routing trước graph

Chạy:

```powershell
python -m pytest tests/test_routing.py -q
```

Sau đó riêng retry:

```powershell
python -m pytest tests/test_routing.py -k retry -q
```

Approval:

```powershell
python -m pytest tests/test_routing.py -k approval -q
```

### Definition

Routing tests phải pass **trước khi Người 3 wiring graph**.

---

# Task 15 — Verify S07 dead-letter

Scenario:

```text
S07_dead_letter
```

README xác nhận scenario này có:

```text
expected_route = error
max_attempts = 1
```

và phải exhaust ngay khi chạm retry limit. 

Initial:

```text
attempt = 0
max_attempts = 1
```

Trace đúng:

```text
classify(error)
      ↓
retry
attempt = 1
      ↓
route_after_retry
1 >= 1
      ↓
dead_letter
      ↓
finalize
      ↓
END
```

### Không được có

```text
tool
```

sau retry đầu tiên của S07.

Nếu S07 chạy:

```text
retry -> tool
```

thì boundary đang sai.

---

# Task 16 — Verify S05 normal error retry

Scenario:

```text
S05_error
```

Expected:

```text
route = error
```

Conceptual trace:

```text
classify(error)
→ retry
→ tool
→ evaluate
→ retry nếu ERROR
→ tool hoặc dead_letter
→ answer/dead_letter
→ finalize
```

Người 2 cần quan sát:

```text
attempt
tool_results
errors
events
```

qua từng step.

---

# Task 17 — Verify `S02_tool`

Scenario:

```text
S02_tool
```

Expected:

```text
classify(tool)
→ tool
→ evaluate
→ answer
→ finalize
```

README liệt kê `S02_tool` là lookup route và expected route `tool`. 

Không nên có:

```text
retry
dead_letter
approval
```

trong success path này.

---

# Task 18 — Audit `metrics.py`

File:

```text
src/langgraph_agent_lab/metrics.py
```

Người 2 chịu trách nhiệm hiểu và kiểm tra:

```text
actual_route
success
nodes_visited
retry_count
interrupt_count
approval_observed
latency_ms
errors
```

---

# Task 19 — Không phá `actual_route`

`metric_from_state()` cần:

```text
state["route"]
```

để tính:

```text
actual_route
```

Do đó Người 2 phải review toàn branch mình viết để không ai làm:

```python
state["route"] = "done"
```

hay:

```python
state["route"] = "dead_letter"
```

sau classifier.

---

# Task 20 — Audit retry metrics

`total_retries` phải phản ánh số lần node:

```text
retry
```

được visit/log event.

Một retry event tương ứng:

```text
attempt tăng đúng 1
```

Nếu:

```text
3 retry events
attempt tăng 6
```

→ implementation sai.

Nếu:

```text
attempt tăng
nhưng không có retry event
```

→ metrics/audit sai.

---

# Task 21 — Audit nodes visited

Hiện scaffold có thể coi số:

```text
events
```

là số node visits.

Do đó mỗi node của Người 2 nên có **một primary event**:

```text
tool
evaluate
retry
dead_letter
```

Tránh một node tạo 3-4 completion events không cần thiết nếu metrics đang dùng event count.

---

# Task 22 — Audit latency

Nếu current implementation:

```text
latency_ms = 0
```

vì chưa đo wall clock, không được báo cáo rằng latency đã instrument đầy đủ.

Nếu team muốn metric tốt hơn, Người 2 có thể đề xuất đo:

```python
time.perf_counter()
```

quanh:

```python
graph.invoke(...)
```

Nhưng chỉ làm sau core.

---

# Task 23 — Test metrics

Chạy:

```powershell
python -m pytest tests/test_metrics.py -q
```

Sau integration full scenario:

```powershell
python -m langgraph_agent_lab.cli validate-metrics --metrics outputs/metrics.json
```

README yêu cầu final output phải sinh được `outputs/metrics.json` hợp lệ. 

---

# Task 24 — Tự tạo boundary probes

Người 2 nên test routing bằng state nhỏ.

Ví dụ:

```python
{"attempt": 0, "max_attempts": 3}
```

Expected:

```text
tool
```

---

```python
{"attempt": 2, "max_attempts": 3}
```

Expected:

```text
tool
```

---

```python
{"attempt": 3, "max_attempts": 3}
```

Expected:

```text
dead_letter
```

---

```python
{"attempt": 4, "max_attempts": 3}
```

Expected:

```text
dead_letter
```

---

# Task 25 — Scenario ownership của Người 2

Người 2 primary validate:

```text
S02_tool
S05_error
S07_dead_letter
```

### S02

```text
tool success path
```

### S05

```text
error → bounded retry
```

### S07

```text
error → retry → immediate dead-letter
```

Ba scenario này tập trung đúng workstream tool/retry.

---

# Task 26 — Deliverable cho Người 3 tích hợp

Người 2 cần bàn giao:

```text
1. tool_node
2. evaluate_node
3. retry_or_fallback_node
4. dead_letter_node
5. route_after_classify
6. route_after_evaluate
7. route_after_retry
8. route_after_approval
9. routing tests pass
10. metrics tests pass
11. S02/S05/S07 behavior đã kiểm tra
```

---

# Ownership chính xác

## File riêng Người 2

```text
src/langgraph_agent_lab/routing.py
src/langgraph_agent_lab/metrics.py
```

## File shared `nodes.py`

Người 2 **chỉ sửa**:

```text
tool_node
evaluate_node
retry_or_fallback_node
dead_letter_node
```

Không sửa vùng Người 1:

```text
classify_node
answer_node
ask_clarification_node
```

Không sửa vùng Người 3:

```text
risky_action_node
approval_node
finalize_node
```

---

# Không được làm

Người 2 đặc biệt tránh:

```text
❌ hard-code S02/S05/S07
❌ route theo scenario_id
❌ increment attempt trong tool
❌ increment attempt trong routing
❌ retry khi attempt == max_attempts
❌ retry bằng recursion_limit
❌ mutate errors/tool_results trực tiếp
❌ overwrite route thành dead_letter
❌ thực thi risky tool khi chưa approval
❌ sửa public tests để pass
```

---

# Definition of Done — Người 2

Người 2 hoàn thành khi:

* `tool_node` append result đúng.
* `evaluate_node` luôn set `evaluation_result`.
* Latest tool result được evaluate.
* Chỉ retry node tăng `attempt`.
* Mỗi retry tăng đúng 1.
* `attempt < max_attempts → tool`.
* `attempt >= max_attempts → dead_letter`.
* Dead-letter tạo `final_answer`.
* Dead-letter không overwrite classified route.
* 4 routing functions là pure.
* Approval routing xử lý mapping đúng.
* Routing tests pass.
* Metrics tests pass.
* S02 success không retry.
* S05 retry hữu hạn.
* S07 chạm max là dead-letter ngay.
* Không hard-code sample scenarios.
* Event trail đủ để audit.

### Tóm tắt task giao thẳng cho Người 2

```text
PERSON 2 — TOOL / RETRY / ROUTING / METRICS

Files:
- nodes.py
- routing.py
- metrics.py

nodes.py ownership:
- tool_node
- evaluate_node
- retry_or_fallback_node
- dead_letter_node

Tasks:
1. Implement mock tool execution.
2. Preserve append-only tool_results.
3. Implement error simulation generically.
4. Prevent risky side effects before approval.
5. Evaluate latest tool result.
6. Set success / needs_retry.
7. Increment attempt ONLY in retry node.
8. Append retry error/event.
9. Implement dead-letter final response.
10. Never overwrite classified route.
11. Implement all 4 routing functions.
12. Verify <, ==, > max_attempts boundaries.
13. Run routing + metrics tests.
14. Validate S02_tool.
15. Validate S05_error.
16. Validate S07_dead_letter.
17. Audit retry/node/event metrics.
18. Hand off clean contract to graph integrator.

Required tests:
python -m pytest tests/test_routing.py -q
python -m pytest tests/test_routing.py -k retry -q
python -m pytest tests/test_routing.py -k approval -q
python -m pytest tests/test_metrics.py -q
```

Sau Người 1 và Người 2 như vậy thì **Người 3 sẽ nhận phần còn lại: Risky/HITL + `finalize` + toàn `graph.py` + persistence + report + final integration**, tức là người chịu trách nhiệm ráp toàn bộ hệ thống thành submission chạy được.
