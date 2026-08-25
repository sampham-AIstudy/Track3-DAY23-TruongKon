"""Node functions for the LangGraph workflow."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from .llm import get_llm
from .state import AgentState, make_event


class Classification(BaseModel):
    route: Literal["simple", "tool", "missing_info", "risky", "error"]
    risk_level: Literal["low", "medium", "high"] = "low"
    reason: str = Field(min_length=1)


def _fallback_classification(query: str) -> tuple[str, str]:
    """Classify generically when the configured LLM provider is unavailable."""
    normalized = query.casefold()
    risky_terms = ("refund", "delete", "cancel", "send email", "send a message")
    tool_terms = ("lookup", "look up", "order status", "tracking", "search for")
    missing_phrases = (
        "fix it",
        "doesn't work",
        "does not work",
        "something is wrong",
        "help me",
    )
    error_terms = ("timeout", "failure", "crash", "service unavailable", "system error")
    if any(term in normalized for term in risky_terms):
        return "risky", "high"
    if any(term in normalized for term in tool_terms):
        return "tool", "low"
    if any(phrase in normalized for phrase in missing_phrases):
        return "missing_info", "low"
    if any(term in normalized for term in error_terms):
        return "error", "low"
    return "simple", "low"


def _response_text(response: object) -> str:
    content = getattr(response, "content", response)
    if isinstance(content, list):
        return "".join(
            item.get("text", "") if isinstance(item, dict) else str(item) for item in content
        ).strip()
    return str(content).strip()


def intake_node(state: AgentState) -> dict:
    """Normalize raw query. This node is provided as a working example."""
    query = state.get("query", "").strip()
    return {
        "query": query,
        "messages": [f"intake:{query[:40]}"],
        "events": [make_event("intake", "completed", "query normalized")],
    }


def classify_node(state: AgentState) -> dict:
    """Classify a query with Gemini structured output."""
    query = state.get("query", "")
    prompt = f"""Classify this support request into exactly one route.
Priority when multiple intents are present: risky > tool > missing_info > error > simple.
- risky: side effects such as refunds, deletion, cancellation, or sending messages
- tool: lookup or retrieval that needs a tool but has enough detail
- missing_info: vague request without enough actionable context
- error: explicit system failure, timeout, crash, or unavailable service
- simple: general informational question
Return only the structured schema.
Request: {query}"""
    try:
        raw_decision = get_llm(temperature=0).with_structured_output(Classification).invoke(
            prompt
        )
        decision = (
            raw_decision
            if isinstance(raw_decision, Classification)
            else Classification.model_validate(raw_decision)
        )
        risk_level: str = "high" if decision.route == "risky" else decision.risk_level
        return {
            "route": decision.route,
            "risk_level": risk_level,
            "events": [
                make_event(
                    "classify",
                    "completed",
                    "query classified",
                    route=decision.route,
                    risk_level=risk_level,
                )
            ],
        }
    except Exception as exc:
        route, risk_level = _fallback_classification(query)
        return {
            "route": route,
            "risk_level": risk_level,
            "errors": [f"classification LLM failed; fallback used: {type(exc).__name__}"],
            "events": [
                make_event(
                    "classify",
                    "fallback",
                    "LLM classification failed; generic fallback classification used",
                    route=route,
                    risk_level=risk_level,
                )
            ],
        }


def tool_node(state: AgentState) -> dict:
    """Execute a mock tool call."""
    attempt = state.get("attempt", 0)
    route = state.get("route", "")
    query = state.get("query", "")
    approval = state.get("approval")
    approved = (
        approval.get("approved", False)
        if isinstance(approval, dict)
        else bool(getattr(approval, "approved", False))
    )

    if route == "risky" and not approved:
        result = "ERROR: Risky tool execution blocked because approval is missing or rejected"
        return {
            "tool_results": [result],
            "errors": [result],
            "events": [make_event("tool", "blocked", "risky action blocked before execution")],
        }

    if route == "error" and attempt < 2:
        result = f"ERROR: simulated transient failure at attempt {attempt} for: {query}"
        return {
            "tool_results": [result],
            "errors": [result],
            "events": [make_event("tool", "failed", "mock tool returned a transient error")],
        }

    result = f"Mock tool execution succeeded for: {query}"
    return {
        "tool_results": [result],
        "events": [make_event("tool", "completed", f"mock tool completed at attempt {attempt}")],
    }


def evaluate_node(state: AgentState) -> dict:
    """Evaluate tool results."""
    tool_results = state.get("tool_results", [])
    latest_result = tool_results[-1] if tool_results else "ERROR: no tool result available"
    evaluation_result = "needs_retry" if "ERROR" in latest_result else "success"
    return {
        "evaluation_result": evaluation_result,
        "events": [
            make_event(
                "evaluate",
                "completed",
                f"latest tool result evaluated as {evaluation_result}",
            )
        ],
    }


def answer_node(state: AgentState) -> dict:
    """Generate a response grounded in the available state context."""
    query = state.get("query", "")
    context = {
        "tool_results": state.get("tool_results", []),
        "approval": state.get("approval"),
        "proposed_action": state.get("proposed_action"),
    }
    prompt = f"""Answer the user's request helpfully and concisely.
Use only the request and the supplied context. Do not invent tool results.
Do not claim an action was completed unless the context contains evidence of completion.
If context is missing, say what you can and cannot confirm.
User request: {query}
Context: {context}
"""
    try:
        answer = _response_text(get_llm(temperature=0.2).invoke(prompt))
        if not answer:
            raise ValueError("LLM returned an empty answer")
        return {
            "final_answer": answer,
            "events": [make_event("answer", "completed", "grounded answer generated")],
        }
    except Exception as exc:
        return {
            "final_answer": (
                "The language-model provider is unavailable. The workflow completed "
                f"with this available context: query={query!r}; "
                f"tool_results={state.get('tool_results', [])!r}."
            ),
            "errors": [f"answer LLM failed; grounded fallback used: {type(exc).__name__}"],
            "events": [
                make_event(
                    "answer",
                    "fallback",
                    "LLM answer generation failed; grounded fallback response used",
                )
            ],
        }


def ask_clarification_node(state: AgentState) -> dict:
    """Ask one specific question when the request lacks actionable detail."""
    query = state.get("query", "")
    prompt = f"""Ask one specific, actionable clarification question for this vague support request.
Do not answer the request or invent missing facts. Ask for the system/service and the concrete
error, item, or action needed. Reply with the question only.
Request: {query}"""
    try:
        question = _response_text(get_llm(temperature=0.2).invoke(prompt))
        if not question:
            raise ValueError("LLM returned an empty clarification")
    except Exception as exc:
        question = (
            "Which system or service is affected, and what exact error message, "
            "order identifier, or action are you trying to complete?"
        )
        return {
            "pending_question": question,
            "final_answer": question,
            "errors": [f"clarification generation failed: {type(exc).__name__}"],
            "events": [make_event("clarify", "failed", "LLM clarification failed")],
        }
    return {
        "pending_question": question,
        "final_answer": question,
        "events": [make_event("clarify", "completed", "clarification question generated")],
    }


def risky_action_node(state: AgentState) -> dict:
    """Prepare a risky action for human approval.

    Describe the proposed action and why it requires approval.

    Note: You may need to add 'proposed_action' to AgentState if not present.

    Return: {"proposed_action": str, "events": [make_event(...)]}
    """
    query = state.get("query", "").strip()
    risk_level = state.get("risk_level", "high")
    proposed_action = (
        "Proposed action:\n"
        f"- Review and carry out the requested action: {query}\n"
        f"- Risk level: {risk_level}\n"
        "- Requires approval before execution"
    )
    return {
        "proposed_action": proposed_action,
        "events": [
            make_event(
                "risky_action",
                "proposed",
                "risky action prepared without executing side effects",
            )
        ],
    }


def approval_node(state: AgentState) -> dict:
    """Human-in-the-loop approval step.

    Default behavior: mock approval (approved=True) so tests and CI run offline.
    A real ``interrupt()``/resume flow is intentionally left as a future extension.

    Return: {"approval": {...}, "events": [make_event(...)]}
    """
    supplied_decision = state.get("approval")
    if isinstance(supplied_decision, dict) and "approved" in supplied_decision:
        approval = {
            "approved": bool(supplied_decision["approved"]),
            "reviewer": str(supplied_decision.get("reviewer", "mock-reviewer")),
            "comment": str(supplied_decision.get("comment", "")),
        }
    else:
        approval = {
            "approved": True,
            "reviewer": "mock-reviewer",
            "comment": "Approved automatically for the core lab workflow.",
        }
    event_type = "approved" if approval["approved"] else "rejected"
    return {
        "approval": approval,
        "events": [
            make_event(
                "approval",
                event_type,
                "approval decision recorded before action execution",
                proposed_action=state.get("proposed_action", ""),
                reviewer=approval["reviewer"],
            )
        ],
    }
def retry_or_fallback_node(state: AgentState) -> dict:
    """Record a retry attempt."""
    attempt = state.get("attempt", 0) + 1
    error = f"retry attempt {attempt} recorded after transient tool failure"
    return {
        "attempt": attempt,
        "errors": [error],
        "events": [make_event("retry", "completed", error)],
    }


def dead_letter_node(state: AgentState) -> dict:
    """Handle unresolvable failures after max retries."""
    attempt = state.get("attempt", 0)
    max_attempts = state.get("max_attempts", 0)
    return {
        "final_answer": (
            "The request could not be completed after the configured retry limit "
            "and has been escalated for manual review."
        ),
        "events": [
            make_event(
                "dead_letter",
                "completed",
                f"retry limit exhausted ({attempt}/{max_attempts}); escalated for review",
            )
        ],
    }


def finalize_node(state: AgentState) -> dict:
    """Emit a final audit event. All routes must pass through here before END.

    Return: {"events": [make_event("finalize", "completed", "workflow finished")]}
    """
    return {"events": [make_event("finalize", "completed", "workflow finished")]}
