"""Node functions for the LangGraph workflow.

Each function receives AgentState and returns a partial state update dict.
Do NOT mutate input state — return new values only.

LLM REQUIREMENT:
- classify_node MUST use a real LLM call (structured output for intent classification)
- answer_node MUST use a real LLM call (grounded response generation)
- evaluate_node SHOULD use LLM-as-judge (bonus points; heuristic acceptable for base score)
"""

from __future__ import annotations

import os
from typing import Literal
from pydantic import BaseModel, Field

from .llm import get_llm
from .state import AgentState, make_event


# ─── EXAMPLE: working node (provided for reference) ──────────────────
def intake_node(state: AgentState) -> dict:
    """Normalize raw query. This node is provided as a working example."""
    query = state.get("query", "").strip()
    return {
        "query": query,
        "messages": [f"intake:{query[:40]}"],
        "events": [make_event("intake", "completed", "query normalized")],
    }


class ClassificationResult(BaseModel):
    """Schema for LLM structured output classification."""

    route: Literal["simple", "tool", "missing_info", "risky", "error"] = Field(
        description="The target route for processing the query"
    )
    reasoning: str = Field(description="Explanation for why this route was selected")


import time

def invoke_with_retry(runnable, input_data, max_retries: int = 5, initial_delay: float = 3.0):
    """Invoke runnable with exponential backoff on rate limits / transient errors."""
    delay = initial_delay
    for attempt in range(max_retries):
        try:
            return runnable.invoke(input_data)
        except Exception as exc:
            err_str = str(exc)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str or "rate_limit" in err_str.lower():
                if attempt == max_retries - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 30.0)
            else:
                raise


def classify_node(state: AgentState) -> dict:
    """Classify the query into a route using an LLM.

    MUST use a real LLM call with structured output.
    Priority guide: risky > tool > missing_info > error > simple
    """
    query = state.get("query", "").strip()
    llm = get_llm(temperature=0.0)
    structured_llm = llm.with_structured_output(ClassificationResult)

    system_prompt = (
        "You are an intent classification system for a customer support agent. "
        "Classify the user's query into EXACTLY ONE of the following categories:\n"
        "- 'risky': Actions that have high-risk side effects or mutations, such as refunding a customer, deleting an account, cancelling a subscription, modifying sensitive settings, or sending external emails.\n"
        "- 'tool': Information lookups or status checks that require querying external data (e.g. order status, tracking number, user account details).\n"
        "- 'missing_info': Vague, ambiguous, or incomplete queries lacking necessary details to take action (e.g. 'Can you fix it?', 'Help me').\n"
        "- 'error': Queries describing explicit system/service errors, timeouts, or crash failures (e.g. 'Timeout failure while processing request', 'System 500 error').\n"
        "- 'simple': General informational questions answerable directly without tools, lookup, or side effects (e.g. 'How do I reset my password?').\n\n"
        "Follow priority rule when ambiguous: risky > tool > missing_info > error > simple."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": query},
    ]

    res: ClassificationResult = invoke_with_retry(structured_llm, messages)
    route = res.route
    risk_level = "high" if route == "risky" else "low"

    return {
        "route": route,
        "risk_level": risk_level,
        "events": [make_event("classify", "completed", f"classified as {route}", route=route, risk_level=risk_level)],
    }


def tool_node(state: AgentState) -> dict:
    """Execute a mock tool call with error simulation and risky action protection."""
    attempt = state.get("attempt", 0)
    route = state.get("route", "")
    query = state.get("query", "")
    approval = state.get("approval", {}) or {}

    # Task 4: Protect risky action in tool_node
    if route == "risky" and not approval.get("approved"):
        err_msg = "ERROR: Risky tool execution rejected or missing approval"
        return {
            "tool_results": [err_msg],
            "errors": [err_msg],
            "events": [make_event("tool", "failed", "risky tool executed without approval")],
        }

    # Task 3: Error simulation contract
    if route == "error" and attempt < 2:
        result_str = f"ERROR: Simulated transient failure for query: '{query}' (attempt {attempt})"
    else:
        result_str = f"Mock tool execution success for query: '{query}'"

    return {
        "tool_results": [result_str],
        "events": [make_event("tool", "completed", f"tool executed (attempt {attempt})")],
    }


def evaluate_node(state: AgentState) -> dict:
    """Evaluate tool results — the retry-loop gate."""
    tool_results = state.get("tool_results", [])
    latest_result = tool_results[-1] if tool_results else ""

    if "ERROR" in latest_result:
        evaluation_result = "needs_retry"
    else:
        evaluation_result = "success"

    return {
        "evaluation_result": evaluation_result,
        "events": [make_event("evaluate", "completed", f"evaluated result: {evaluation_result}")],
    }


def answer_node(state: AgentState) -> dict:
    """Generate a final response using an LLM."""
    query = state.get("query", "")
    tool_results = state.get("tool_results", [])
    approval = state.get("approval", {})

    context_parts = [f"User Query: {query}"]
    if tool_results:
        context_parts.append(f"Tool Execution Results: {tool_results[-1]}")
    if approval:
        context_parts.append(f"Approval Decision: {approval}")

    prompt = (
        "You are a helpful support assistant. Provide a concise, accurate, and professional response "
        "to the user based on the context provided below.\n\n"
        + "\n".join(context_parts)
    )

    llm = get_llm(temperature=0.2)
    response = invoke_with_retry(llm, prompt)

    content = response.content if hasattr(response, "content") else str(response)
    if isinstance(content, list):
        text_pieces = []
        for item in content:
            if isinstance(item, dict):
                text_pieces.append(item.get("text", ""))
            else:
                text_pieces.append(str(item))
        answer_str = " ".join(text_pieces).strip()
    else:
        answer_str = str(content).strip()

    return {
        "final_answer": answer_str,
        "events": [make_event("answer", "completed", "answer generated")],
    }


def ask_clarification_node(state: AgentState) -> dict:
    """Ask for missing information instead of hallucinating."""
    query = state.get("query", "")
    question = f"Could you please provide more details or context regarding your request: '{query}'?"

    return {
        "pending_question": question,
        "final_answer": question,
        "events": [make_event("clarify", "completed", "clarification requested")],
    }


def risky_action_node(state: AgentState) -> dict:
    """Prepare a risky action for human approval."""
    query = state.get("query", "")
    action_desc = f"Proposed action: Execute risky operation for query '{query}'"

    return {
        "proposed_action": action_desc,
        "events": [make_event("risky_action", "completed", "prepared risky action")],
    }


def approval_node(state: AgentState) -> dict:
    """Human-in-the-loop approval step."""
    if os.getenv("LANGGRAPH_INTERRUPT") == "true":
        from langgraph.types import interrupt

        decision = interrupt(
            {
                "proposed_action": state.get("proposed_action"),
                "query": state.get("query"),
            }
        )
        if isinstance(decision, dict):
            approval_decision = decision
        else:
            approval_decision = {"approved": bool(decision), "reviewer": "human", "comment": ""}
    else:
        approval_decision = {
            "approved": True,
            "reviewer": "mock-reviewer",
            "comment": "Auto-approved for scenario execution",
        }

    return {
        "approval": approval_decision,
        "events": [
            make_event(
                "approval",
                "completed",
                "approval decision recorded",
                approved=approval_decision.get("approved", False),
            )
        ],
    }


def retry_or_fallback_node(state: AgentState) -> dict:
    """Record a retry attempt. Increment attempt by 1 ONLY here."""
    current_attempt = state.get("attempt", 0)
    new_attempt = current_attempt + 1
    err_msg = f"Transient failure recorded, retrying attempt {new_attempt}"

    return {
        "attempt": new_attempt,
        "errors": [err_msg],
        "events": [make_event("retry", "completed", f"retry recorded attempt {new_attempt}")],
    }


def dead_letter_node(state: AgentState) -> dict:
    """Handle unresolvable failures after max retries exceeded."""
    msg = "The request could not be completed after maximum retry attempts and has been escalated for manual review."

    return {
        "final_answer": msg,
        "events": [make_event("dead_letter", "completed", "escalated to dead letter")],
    }


def finalize_node(state: AgentState) -> dict:
    """Emit a final audit event. All routes must pass through here before END."""
    return {
        "events": [make_event("finalize", "completed", "workflow finished")],
    }
