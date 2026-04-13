from postgrest.exceptions import APIError
from supabase import create_client

from app.services.textbook_catalog_service import list_chunk_previews
from app.services.rag_service import retrieve_context
from app.config import settings

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

# ── AI 클라이언트 초기화 ───────────────────────────────────
if settings.ai_provider == "openrouter":
    from openai import OpenAI as _OpenAI
    _or_client = _OpenAI(
        api_key=settings.openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
    )
else:
    from google import genai as _genai
    from google.genai import types as _types
    _gemini_client = _genai.Client(api_key=settings.gemini_api_key)

SOCRATIC_SYSTEM = """당신은 소크라테스식 AI 튜터입니다.
핵심 규칙:
1. 절대 직접 답을 주지 마세요. 학생이 스스로 답을 찾도록 유도하세요.
2. 질문으로만 응답하세요 (역질문, 유도질문, 확인질문).
3. 학생이 3번 시도해도 막히면 아주 작은 힌트만 제공하세요.
4. 학생의 오개념을 발견하면 부드럽게 다른 관점을 질문으로 제시하세요.
5. 응답은 2-3문장을 넘지 마세요.
6. 항상 친근하고 격려하는 톤을 유지하세요.

현재 학습 맥락:
{learning_context}

수업 자료 컨텍스트:
{context}

현재 개념 태그: {concept}"""


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


def build_exam_source_reference(exam: dict | None, question: dict | None) -> str | None:
    if not exam or not question:
        return None

    parts = [part for part in [exam.get("textbook_title"), question.get("source_section_title") or exam.get("section_title")] if part]
    source_pages = [int(page) for page in (question.get("source_pages") or []) if isinstance(page, int) or str(page).isdigit()]
    if source_pages:
        ordered = sorted(source_pages)
        if len(ordered) == 1:
            parts.append(f"{ordered[0]}p")
        else:
            parts.append(f"{ordered[0]}-{ordered[-1]}p")
    return " / ".join(parts) if parts else None


def load_exam_review_context(source_reference_id: str | None) -> dict[str, str | None]:
    if not source_reference_id:
        return {}

    answer = safe_single(
        lambda: supabase.table("exam_answers")
        .select("id, question_id, selected_choice")
        .eq("id", source_reference_id)
    )
    if not answer:
        return {}

    question = safe_single(
        lambda: supabase.table("exam_questions")
        .select(
            "id, exam_id, question_order, prompt, concept_tag, evidence_excerpt, "
            "source_pages, source_section_title, source_chunk_ids"
        )
        .eq("id", answer["question_id"])
    )
    if not question:
        return {}

    exam = safe_single(
        lambda: supabase.table("exams")
        .select("id, title, learning_objective, textbook_title, section_title")
        .eq("id", question["exam_id"])
    )
    source_reference = build_exam_source_reference(exam, question)
    chunk_previews = list_chunk_previews(question.get("source_chunk_ids") or [])

    evidence_lines: list[str] = []
    if question.get("evidence_excerpt"):
        evidence_lines.append(f"- 근거 요약: {question['evidence_excerpt']}")
    for preview in chunk_previews[:2]:
        page_label = preview.get("page_label") or (
            f"{preview.get('page_number')}p" if preview.get("page_number") else "교재 텍스트"
        )
        evidence_lines.append(f"- {page_label} 근거 텍스트: {preview.get('content')}")

    return {
        "focus_question": question.get("prompt"),
        "context_title": f"{exam.get('title') if exam else '시험'} {question.get('question_order')}번 문항",
        "learning_objective": exam.get("learning_objective") if exam else None,
        "source_reference": source_reference,
        "evidence_context": "\n".join(evidence_lines) if evidence_lines else None,
        "selected_choice": answer.get("selected_choice"),
    }


def build_learning_context(
    *,
    focus_question: str | None = None,
    context_title: str | None = None,
    learning_objective: str | None = None,
    source_reference: str | None = None,
    evidence_context: str | None = None,
) -> str:
    lines: list[str] = []
    if context_title or focus_question:
        title = context_title or "현재 질문"
        value = focus_question or "현재 질문 맥락 없음"
        lines.append(f"- {title}: {value}")
    if learning_objective:
        lines.append(f"- 교육 목적: {learning_objective}")
    if source_reference:
        lines.append(f"- 자료 범위: {source_reference}")
    if evidence_context:
        lines.append(evidence_context)
    return "\n".join(lines) if lines else "- 별도 시험/성적 맥락 없이 일반 학습 질문입니다."


def build_system_prompt(
    course_id: str,
    concept: str,
    student_query: str,
    *,
    source_type: str | None = None,
    source_reference_id: str | None = None,
    focus_question: str | None = None,
    context_title: str | None = None,
    learning_objective: str | None = None,
    source_reference: str | None = None,
) -> str:
    if source_type == "exam_review" and source_reference_id:
        review_context = load_exam_review_context(source_reference_id)
        focus_question = focus_question or review_context.get("focus_question")
        context_title = context_title or review_context.get("context_title")
        learning_objective = learning_objective or review_context.get("learning_objective")
        source_reference = source_reference or review_context.get("source_reference")
        evidence_context = review_context.get("evidence_context")
    else:
        evidence_context = None

    retrieval_query = "\n".join(
        part
        for part in [student_query, concept, focus_question, learning_objective, source_reference, evidence_context]
        if part
    )
    context = retrieve_context(course_id, retrieval_query or student_query)
    learning_context = build_learning_context(
        focus_question=focus_question,
        context_title=context_title,
        learning_objective=learning_objective,
        source_reference=source_reference,
        evidence_context=evidence_context,
    )
    return SOCRATIC_SYSTEM.format(
        learning_context=learning_context,
        context=context or "수업 자료가 아직 없습니다.",
        concept=concept,
    )


def stream_socratic_response(
    course_id: str,
    concept: str,
    messages: list[dict],
    student_query: str,
    *,
    source_type: str | None = None,
    source_reference_id: str | None = None,
    focus_question: str | None = None,
    context_title: str | None = None,
    learning_objective: str | None = None,
    source_reference: str | None = None,
):
    system = build_system_prompt(
        course_id,
        concept,
        student_query,
        source_type=source_type,
        source_reference_id=source_reference_id,
        focus_question=focus_question,
        context_title=context_title,
        learning_objective=learning_objective,
        source_reference=source_reference,
    )

    if settings.ai_provider == "openrouter":
        yield from _stream_openrouter(system, messages, student_query)
    else:
        yield from _stream_gemini(system, messages, student_query)


def _stream_openrouter(system: str, messages: list[dict], student_query: str):
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in messages[:-1]
    ]
    or_messages = (
        [{"role": "system", "content": system}]
        + history
        + [{"role": "user", "content": student_query}]
    )
    stream = _or_client.chat.completions.create(
        model=settings.openrouter_model,
        messages=or_messages,
        max_tokens=300,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            yield delta


def _stream_gemini(system: str, messages: list[dict], student_query: str):
    from google.genai import types as _t
    role_map = {"user": "user", "assistant": "model"}
    history = [
        _t.Content(role=role_map.get(m["role"], "user"), parts=[_t.Part(text=m["content"])])
        for m in messages[:-1]
    ]
    contents = history + [
        _t.Content(role="user", parts=[_t.Part(text=f"{system}\n\n학생 질문: {student_query}")])
    ]
    response = _gemini_client.models.generate_content_stream(
        model=settings.gemini_model,
        contents=contents,
        config=_t.GenerateContentConfig(
            max_output_tokens=300,
            thinking_config=_t.ThinkingConfig(
                thinking_budget=settings.gemini_thinking_budget
            ),
        ),
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text
