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
        decision = get_llm(temperature=0).with_structured_output(Classification).invoke(prompt)
        risk_level = "high" if decision.route == "risky" else decision.risk_level
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
        return {
            "route": "error",
            "risk_level": "low",
            "errors": [f"classification failed: {type(exc).__name__}"],
            "events": [make_event("classify", "failed", "LLM classification failed")],
        }


def tool_node(state: AgentState) -> dict:
    """Execute a mock tool call."""
    raise NotImplementedError("TODO(student): implement mock tool with error simulation")


def evaluate_node(state: AgentState) -> dict:
    """Evaluate tool results."""
    raise NotImplementedError("TODO(student): implement tool result evaluation")


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
                "Mình chưa thể hoàn tất câu trả lời vì dịch vụ AI đang gặp sự cố. "
                "Vui lòng thử lại sau."
            ),
            "errors": [f"answer generation failed: {type(exc).__name__}"],
            "events": [make_event("answer", "failed", "LLM answer generation failed")],
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
            "Bạn đang gặp vấn đề ở hệ thống hoặc dịch vụ nào, và lỗi cụ thể "
            "đang hiển thị là gì?"
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
    raise NotImplementedError("TODO(student): implement retry with attempt tracking")


def dead_letter_node(state: AgentState) -> dict:
    """Handle unresolvable failures after max retries."""
    raise NotImplementedError("TODO(student): implement dead letter handling")


def finalize_node(state: AgentState) -> dict:
    """Emit a final audit event. All routes must pass through here before END.

    Return: {"events": [make_event("finalize", "completed", "workflow finished")]}
    """
    return {"events": [make_event("finalize", "completed", "workflow finished")]}
