from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.ai_client import generate_text

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
UTC = timezone.utc


def get_api_error_code(error: APIError) -> str | None:
    code = getattr(error, "code", None)
    if code:
        return str(code)

    if error.args and isinstance(error.args[0], dict):
        return error.args[0].get("code")

    return None


def safe_rows(builder) -> list[dict]:
    try:
        result = builder().execute()
    except APIError as error:
        if get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        raise
    return result.data or []


def safe_single(builder) -> dict | None:
    rows = safe_rows(builder)
    return rows[0] if rows else None


def _generate_conversation_summary_llm(concept: str, messages: list[dict]) -> str | None:
    """대화 원문 기반으로 교사용 1문장 학습 요약을 생성합니다. 실패 시 None 반환."""
    if len(messages) < 2:
        return None

    dialogue = "\n".join(
        f"{'학생' if m.get('role') == 'user' else '튜터'}: {str(m.get('content') or '')[:300]}"
        for m in messages[-6:]
    )
    try:
        summary = generate_text(
            f"아래 학생-AI튜터 대화를 읽고, 학생이 어디서 막혔고 어디까지 이해했는지를 "
            f"교사용으로 1문장으로 요약하라. 개념: {concept}\n\n{dialogue}",
            max_tokens=80,
            temperature=0.1,
        )
        return summary[:200] if summary else None
    except Exception:
        return None


def looks_like_uuid(value: str) -> bool:
    return len(value) == 36 and value.count("-") == 4


def create_tutor_conversation(
    *,
    course_id: str,
    student_id: str,
    concept: str,
    source_type: str = "tutor_session",
    source_reference_id: str | None = None,
    focus_question: str | None = None,
    starter_query: str | None = None,
) -> str | None:
    if not looks_like_uuid(student_id):
        return None

    conversation_id = str(uuid4())
    started_at = datetime.now(UTC).isoformat()
    summary = (
        f"{concept}에서 '{(starter_query or concept)[:60]}' 관련 질문을 시작함"
    )
    base_conversation = {
        "id": conversation_id,
        "student_id": student_id,
        "course_id": course_id,
        "concept_tag": concept,
        "summary": summary,
        "stuck_count": 1,
        "resolved": False,
        "started_at": started_at,
        "ended_at": started_at,
        "created_at": started_at,
    }

    try:
        try:
            supabase.table("tutor_conversations").insert(
                {
                    **base_conversation,
                    "source_type": source_type,
                    "source_reference_id": source_reference_id,
                    "focus_question": focus_question,
                }
            ).execute()
        except APIError:
            supabase.table("tutor_conversations").insert(base_conversation).execute()
        return conversation_id
    except APIError as error:
        if get_api_error_code(error) == "PGRST205":
            return None
        raise


def append_tutor_exchange(
    *,
    conversation_id: str,
    student_query: str,
    assistant_response: str,
) -> None:
    conversation = safe_single(
        lambda: supabase.table("tutor_conversations")
        .select("id, concept_tag")
        .eq("id", conversation_id)
    )
    if not conversation:
        return

    latest_message = safe_single(
        lambda: supabase.table("tutor_messages")
        .select("message_order")
        .eq("conversation_id", conversation_id)
        .order("message_order", desc=True)
        .limit(1)
    )
    next_order = int(latest_message.get("message_order", 0) if latest_message else 0) + 1
    now = datetime.now(UTC).isoformat()
    concept_tag = conversation.get("concept_tag") or "학습"
    template_summary = f"{concept_tag}에서 '{student_query[:60]}' 관련 질문을 남기고 질문형 피드백을 받음"

    supabase.table("tutor_messages").insert(
        [
            {
                "id": str(uuid4()),
                "conversation_id": conversation_id,
                "role": "user",
                "content": student_query,
                "message_order": next_order,
                "created_at": now,
            },
            {
                "id": str(uuid4()),
                "conversation_id": conversation_id,
                "role": "assistant",
                "content": assistant_response,
                "message_order": next_order + 1,
                "created_at": now,
            },
        ]
    ).execute()

    all_messages = safe_rows(
        lambda: supabase.table("tutor_messages")
        .select("role, content, message_order")
        .eq("conversation_id", conversation_id)
        .order("message_order")
    )
    llm_summary = _generate_conversation_summary_llm(concept_tag, all_messages)

    supabase.table("tutor_conversations").update(
        {
            "summary": llm_summary or template_summary,
            "ended_at": now,
            "stuck_count": next_order // 2,
        }
    ).eq("id", conversation_id).execute()


def list_tutor_conversations(
    student_id: str,
    *,
    course_id: str | None = None,
    limit: int = 24,
) -> list[dict]:
    query = (
        lambda: supabase.table("tutor_conversations")
        .select("id, course_id, concept_tag, summary, ended_at, started_at, source_type")
        .eq("student_id", student_id)
        .order("ended_at", desc=True)
        .limit(limit)
    )
    conversations = safe_rows(lambda: query().eq("course_id", course_id)) if course_id else safe_rows(query)
    if not conversations:
        return []

    conversation_ids = [row["id"] for row in conversations]
    messages = safe_rows(
        lambda: supabase.table("tutor_messages")
        .select("conversation_id, role, content, message_order")
        .in_("conversation_id", conversation_ids)
        .order("message_order")
    )
    messages_by_conversation: dict[str, list[dict]] = {}
    for message in messages:
        messages_by_conversation.setdefault(message["conversation_id"], []).append(message)

    results: list[dict] = []
    for row in conversations:
        conversation_messages = messages_by_conversation.get(row["id"], [])
        if not conversation_messages:
            continue
        preview = ""
        for message in reversed(conversation_messages):
            content = (message.get("content") or "").strip()
            if content:
                preview = content[:100]
                break
        results.append(
            {
                "id": row["id"],
                "courseId": row.get("course_id"),
                "concept": row.get("concept_tag") or "개념 학습",
                "preview": preview or (row.get("summary") or "새 학습 대화"),
                "updatedAt": row.get("ended_at") or row.get("started_at"),
                "messageCount": len(conversation_messages),
                "sourceType": row.get("source_type") or "tutor_session",
            }
        )
    return results


def get_tutor_conversation_thread(
    conversation_id: str,
    *,
    student_id: str | None = None,
) -> dict | None:
    builder = lambda: supabase.table("tutor_conversations").select("*").eq("id", conversation_id)
    conversation = safe_single(lambda: builder().eq("student_id", student_id)) if student_id else safe_single(builder)
    if not conversation:
        return None

    messages = safe_rows(
        lambda: supabase.table("tutor_messages")
        .select("id, role, content, message_order, created_at")
        .eq("conversation_id", conversation_id)
        .order("message_order")
    )
    return {
        "conversation": conversation,
        "messages": messages,
    }


def delete_tutor_conversation(conversation_id: str, *, student_id: str | None = None) -> bool:
    conversation = get_tutor_conversation_thread(conversation_id, student_id=student_id)
    if not conversation:
        return False

    supabase.table("tutor_messages").delete().eq("conversation_id", conversation_id).execute()
    supabase.table("tutor_conversations").delete().eq("id", conversation_id).execute()
    return True


def log_tutor_exchange(
    *,
    course_id: str,
    student_id: str,
    concept: str,
    student_query: str,
    assistant_response: str,
    source_type: str = "tutor_session",
    source_reference_id: str | None = None,
    focus_question: str | None = None,
    conversation_id: str | None = None,
) -> str | None:
    resolved_conversation_id = conversation_id or create_tutor_conversation(
        course_id=course_id,
        student_id=student_id,
        concept=concept,
        source_type=source_type,
        source_reference_id=source_reference_id,
        focus_question=focus_question,
        starter_query=student_query,
    )
    if not resolved_conversation_id:
        return None

    append_tutor_exchange(
        conversation_id=resolved_conversation_id,
        student_query=student_query,
        assistant_response=assistant_response,
    )
    return resolved_conversation_id
