import json
import re

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.services.socratic_service import stream_socratic_response
from app.services.analytics_service import log_stuck_event
from app.services.tutor_transcript_service import create_tutor_conversation, log_tutor_exchange

router = APIRouter()


class ChatRequest(BaseModel):
    course_id: str
    concept: str
    messages: list[dict]
    student_query: str
    student_id: str
    conversation_id: str | None = None
    source_type: str | None = None
    source_reference_id: str | None = None
    focus_question: str | None = None
    context_title: str | None = None
    learning_objective: str | None = None
    source_reference: str | None = None


def _parse_retry_seconds(error: Exception) -> int | None:
    """429 에러 메시지에서 retry 초 수를 추출."""
    msg = str(error)
    match = re.search(r'retry[^\d]*(\d+(?:\.\d+)?)\s*s', msg, re.IGNORECASE)
    return int(float(match.group(1))) + 1 if match else None


def _user_friendly_error(error: Exception) -> str:
    msg = str(error)
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        retry_sec = _parse_retry_seconds(error)
        if retry_sec:
            return f"AI 응답 한도에 잠시 도달했어요. {retry_sec}초 후에 다시 시도해보세요."
        return "AI 응답 한도에 잠시 도달했어요. 잠시 후 다시 시도해보세요."
    if "500" in msg or "503" in msg:
        return "AI 서버가 일시적으로 응답하지 않아요. 잠시 후 다시 시도해보세요."
    return "응답을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."


def generate_sse(req: ChatRequest, conversation_id: str | None):
    full_response: list[str] = []

    if req.student_id != "guest":
        try:
            log_stuck_event(req.student_id, req.course_id, req.concept)
        except Exception:
            pass

    try:
        for chunk in stream_socratic_response(
            req.course_id,
            req.concept,
            req.messages,
            req.student_query,
            source_type=req.source_type,
            source_reference_id=req.source_reference_id,
            focus_question=req.focus_question,
            context_title=req.context_title,
            learning_objective=req.learning_objective,
            source_reference=req.source_reference,
        ):
            full_response.append(chunk)
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    except Exception as exc:
        error_msg = _user_friendly_error(exc)
        yield f"data: {json.dumps(error_msg, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    assistant_response = "".join(full_response).strip()
    if assistant_response:
        try:
            log_tutor_exchange(
                course_id=req.course_id,
                student_id=req.student_id,
                concept=req.concept,
                student_query=req.student_query,
                assistant_response=assistant_response,
                source_type=req.source_type or "tutor_session",
                source_reference_id=req.source_reference_id,
                focus_question=req.focus_question,
                conversation_id=conversation_id,
            )
        except Exception:
            pass

    yield "data: [DONE]\n\n"


@router.post("/socratic")
def socratic_chat(req: ChatRequest):
    conversation_id = req.conversation_id
    if not conversation_id and req.student_id != "guest":
        try:
            conversation_id = create_tutor_conversation(
                course_id=req.course_id,
                student_id=req.student_id,
                concept=req.concept,
                source_type=req.source_type or "tutor_session",
                source_reference_id=req.source_reference_id,
                focus_question=req.focus_question,
                starter_query=req.student_query,
            )
        except Exception:
            conversation_id = None

    headers = {"Cache-Control": "no-cache"}
    if conversation_id:
        headers["x-conversation-id"] = conversation_id

    return StreamingResponse(
        generate_sse(req, conversation_id),
        media_type="text/event-stream",
        headers=headers,
    )
