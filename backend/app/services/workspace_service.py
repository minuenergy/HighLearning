from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.analytics_service import summarize_class_conversations_llm

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
UTC = timezone.utc

KNOWN_SUBJECTS = [
    "생명과학",
    "통합사회",
    "국어",
    "수학",
    "영어",
    "과학",
    "사회",
    "체육",
    "음악",
    "미술",
]

TRANSCRIPT_SIGNAL_RULES: tuple[dict[str, Any], ...] = (
    {
        "key": "definition",
        "label": "개념 정의를 자기 말로 고정하기 전에 멈춤",
        "summary": "정의나 핵심 문장을 다시 묻는 표현이 반복됩니다.",
        "keywords": (
            "무슨 뜻",
            "뜻이",
            "뜻을",
            "정의",
            "뭔지",
            "무엇인지",
            "무슨 말",
            "이해가 안",
            "헷갈",
            "모르겠",
        ),
        "prompt_style": "핵심 정의를 한 문장으로 먼저 말하게 하는 질문",
        "teacher_tip": "핵심 용어 두세 개만 먼저 제시하고, 학생이 자기 말로 정의 문장을 완성하게 해보세요.",
    },
    {
        "key": "condition",
        "label": "조건·범위·기준을 빼먹고 풀이를 시작함",
        "summary": "조건이나 범위를 빼먹은 채 바로 답을 찾으려는 흐름이 보입니다.",
        "keywords": (
            "조건",
            "범위",
            "기준",
            "어디까지",
            "단위",
            "부호",
            "순서",
            "경우",
            "언제",
            "먼저",
        ),
        "prompt_style": "문제의 조건과 기준을 먼저 체크하게 하는 질문",
        "teacher_tip": "문제에 들어가기 전에 조건 체크리스트를 먼저 읽고, 학생이 어떤 기준으로 풀지 말하게 해보세요.",
    },
    {
        "key": "calculation",
        "label": "계산이나 식 세우기 절차에서 자주 흔들림",
        "summary": "숫자, 부호, 공식 대입 단계에서 다시 확인하는 질문이 많습니다.",
        "keywords": (
            "계산",
            "숫자",
            "분모",
            "분자",
            "공식",
            "대입",
            "식이",
            "계산이",
            "실수",
            "나누기",
            "곱하기",
        ),
        "prompt_style": "계산 과정을 단계별로 끊어 확인하는 질문",
        "teacher_tip": "정답까지 한 번에 가지 말고, 식 세우기와 계산을 분리해서 한 단계씩 검산하게 해보세요.",
    },
    {
        "key": "evidence",
        "label": "지문·보기·자료의 근거를 끝까지 대조하지 않음",
        "summary": "근거 문장이나 보기 차이를 어디서 찾아야 하는지 묻는 장면이 자주 나옵니다.",
        "keywords": (
            "근거",
            "지문",
            "보기",
            "문장",
            "본문",
            "자료",
            "표에서",
            "그래프",
            "어디에",
            "찾아",
        ),
        "prompt_style": "근거 문장이나 보기 차이를 먼저 찾게 하는 질문",
        "teacher_tip": "정답 설명 전에 근거가 되는 문장이나 자료 위치를 학생이 직접 표시하게 해보세요.",
    },
    {
        "key": "answer_seeking",
        "label": "정답을 먼저 확인하려는 경향이 반복됨",
        "summary": "풀이 과정보다 정답 여부를 먼저 확인하려는 표현이 이어집니다.",
        "keywords": (
            "정답",
            "답이",
            "몇 번",
            "답만",
            "그냥 알려",
            "맞는지",
            "정답은",
            "답이 뭐",
        ),
        "prompt_style": "정답 대신 이유를 먼저 말하게 하는 질문",
        "teacher_tip": "정답 공개를 미루고, 왜 그 선택지가 맞다고 생각하는지 근거를 먼저 말하게 해보세요.",
    },
)

ASSISTANT_PROMPT_STYLE_RULES: tuple[dict[str, Any], ...] = (
    {
        "label": "핵심 정의를 한 문장으로 먼저 말하게 하는 질문",
        "keywords": ("한 문장", "네 말로", "직접 말", "정리해볼래", "뜻을 말", "정의를 말"),
    },
    {
        "label": "문제의 조건과 기준을 먼저 체크하게 하는 질문",
        "keywords": ("조건", "기준", "어디까지", "무엇을 먼저", "먼저 확인"),
    },
    {
        "label": "근거 문장이나 보기 차이를 먼저 찾게 하는 질문",
        "keywords": ("근거", "어떤 문장", "보기", "본문", "자료", "표에서", "그래프"),
    },
    {
        "label": "계산 과정을 단계별로 끊어 확인하는 질문",
        "keywords": ("한 단계", "차근차근", "순서대로", "다음 단계", "식을 세워", "계산"),
    },
    {
        "label": "예시를 바꿔 비교하게 하는 질문",
        "keywords": ("예를 들어", "다른 예", "비슷한 경우", "실생활", "바꿔서"),
    },
    {
        "label": "정답 대신 이유를 먼저 말하게 하는 질문",
        "keywords": ("왜", "이유", "왜냐하면", "설명해볼래"),
    },
)

TRANSCRIPT_SIGNAL_RULE_BY_KEY = {
    rule["key"]: rule
    for rule in TRANSCRIPT_SIGNAL_RULES
}


def get_api_error_code(error: APIError) -> str | None:
    code = getattr(error, "code", None)
    if code:
        return str(code)

    if error.args and isinstance(error.args[0], dict):
        return error.args[0].get("code")

    return None


def is_missing_profiles_phone_number(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return "profiles.phone_number" in message


def is_missing_workspace_course_columns(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return any(
        column_name in message
        for column_name in (
            "courses.school_class_id",
            "courses.subject_id",
            "courses.academic_year",
            "courses.grade_level",
            "courses.class_label",
            "courses.subject_name",
        )
    )


def is_missing_exam_section_title(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return "exams.section_title" in message


def is_missing_exam_question_source_columns(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return any(
        column_name in message
        for column_name in (
            "exam_questions.source_pages",
            "exam_questions.evidence_excerpt",
        )
    )


def is_missing_tutor_conversation_context_columns(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return any(
        column_name in message
        for column_name in (
            "tutor_conversations.source_type",
            "tutor_conversations.focus_question",
        )
    )


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


def safe_optional_rows(builder) -> list[dict]:
    try:
        result = builder().execute()
    except APIError as error:
        if get_api_error_code(error) in {"42P01", "PGRST205", "PGRST204"}:
            return []
        raise

    return result.data or []


def safe_workspace_course_rows(builder_with_workspace_columns, builder_without_workspace_columns) -> list[dict]:
    try:
        result = builder_with_workspace_columns().execute()
    except APIError as error:
        if is_missing_workspace_course_columns(error):
            result = builder_without_workspace_columns().execute()
        elif get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        else:
            raise

    rows = result.data or []
    for row in rows:
        row.setdefault("school_class_id", None)
        row.setdefault("subject_id", None)
        row.setdefault("academic_year", None)
        row.setdefault("grade_level", None)
        row.setdefault("class_label", None)
        row.setdefault("subject_name", None)
    return rows


def safe_workspace_course_single(builder_with_workspace_columns, builder_without_workspace_columns) -> dict | None:
    rows = safe_workspace_course_rows(builder_with_workspace_columns, builder_without_workspace_columns)
    return rows[0] if rows else None


def safe_exam_rows(builder_with_section, builder_without_section) -> list[dict]:
    try:
        result = builder_with_section().execute()
    except APIError as error:
        if is_missing_exam_section_title(error):
            result = builder_without_section().execute()
        elif get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        else:
            raise

    rows = result.data or []
    for row in rows:
        row.setdefault("section_title", None)
    return rows


def safe_exam_question_rows(builder_with_source_columns, builder_without_source_columns) -> list[dict]:
    try:
        result = builder_with_source_columns().execute()
    except APIError as error:
        if is_missing_exam_question_source_columns(error):
            result = builder_without_source_columns().execute()
        elif get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        else:
            raise

    rows = result.data or []
    for row in rows:
        row.setdefault("source_pages", [])
        row.setdefault("evidence_excerpt", None)
    return rows


def safe_tutor_conversation_rows(builder_with_context_columns, builder_without_context_columns) -> list[dict]:
    try:
        result = builder_with_context_columns().execute()
    except APIError as error:
        if is_missing_tutor_conversation_context_columns(error):
            result = builder_without_context_columns().execute()
        elif get_api_error_code(error) in {"42P01", "PGRST205", "PGRST204"}:
            return []
        else:
            raise

    rows = result.data or []
    for row in rows:
        row.setdefault("source_type", None)
        row.setdefault("focus_question", None)
    return rows


def safe_profile_rows(builder_with_phone, builder_without_phone) -> list[dict]:
    try:
        result = builder_with_phone().execute()
    except APIError as error:
        if is_missing_profiles_phone_number(error):
            result = builder_without_phone().execute()
        elif get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        else:
            raise

    rows = result.data or []
    for row in rows:
        row.setdefault("phone_number", None)
    return rows


def safe_profile_single(builder_with_phone, builder_without_phone) -> dict | None:
    rows = safe_profile_rows(builder_with_phone, builder_without_phone)
    return rows[0] if rows else None


def update_profile_record(user_id: str, *, full_name: str | None, phone_number: str | None) -> None:
    payload = {
        "full_name": full_name,
        "phone_number": phone_number,
    }
    try:
        supabase.table("profiles").update(payload).eq("id", user_id).execute()
    except APIError as error:
        if not is_missing_profiles_phone_number(error):
            raise
        supabase.table("profiles").update({"full_name": full_name}).eq("id", user_id).execute()


def upsert_workspace_settings(table_name: str, payload: dict[str, Any]) -> None:
    try:
        supabase.table(table_name).upsert(payload).execute()
    except APIError as error:
        if get_api_error_code(error) not in {"42P01", "PGRST205", "PGRST204"}:
            raise
        raise ValueError(
            "워크스페이스 설정 테이블이 없습니다. `006_workspace_domain_and_settings.sql` 마이그레이션을 적용해주세요."
        ) from error


def parse_subject_label(raw_value: str | None) -> str:
    if not raw_value:
        return "통합"

    normalized = raw_value.replace("[SIM]", " ").strip()
    for subject in KNOWN_SUBJECTS:
        if subject in normalized:
            return subject

    if "·" in normalized:
        left = normalized.split("·", 1)[0].strip()
        for token in reversed(left.split()):
            if token and token not in {"초등", "중학", "고등"}:
                return token

    return "통합"


def normalize_space(value: str | None) -> str:
    return " ".join(str(value or "").split())


def clip_text(value: str | None, limit: int = 96) -> str:
    text = normalize_space(value)
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def dedupe_preserving_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        normalized = normalize_space(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def text_contains_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in keywords)


def load_conversation_messages(conversation_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    if not conversation_ids:
        return {}

    messages = safe_optional_rows(
        lambda: supabase.table("tutor_messages")
        .select("conversation_id, role, content, message_order, created_at")
        .in_("conversation_id", conversation_ids)
        .order("message_order")
    )
    messages_by_conversation: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for message in messages:
        messages_by_conversation[message["conversation_id"]].append(message)
    return messages_by_conversation


def build_conversation_preview(conversation: dict[str, Any], messages: list[dict[str, Any]]) -> str:
    for message in reversed(messages):
        if message.get("role") != "user":
            continue
        preview = clip_text(message.get("content"), 88)
        if preview:
            return preview

    fallback = conversation.get("focus_question") or conversation.get("summary")
    return clip_text(fallback, 88)


def analyze_transcript_bundle(
    conversations: list[dict[str, Any]],
    messages_by_conversation: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    signal_counts: Counter[str] = Counter()
    prompt_style_counts: Counter[str] = Counter()
    signal_examples: dict[str, str] = {}
    transcript_highlights: list[str] = []

    for conversation in conversations:
        messages = messages_by_conversation.get(conversation["id"], [])
        latest_user_message = ""
        latest_assistant_message = ""

        for message in messages:
            content = normalize_space(message.get("content"))
            if not content:
                continue

            if message.get("role") == "user":
                latest_user_message = content
                for rule in TRANSCRIPT_SIGNAL_RULES:
                    if not text_contains_keyword(content, rule["keywords"]):
                        continue
                    signal_counts[rule["key"]] += 1
                    signal_examples.setdefault(rule["key"], clip_text(content, 72))
            elif message.get("role") == "assistant":
                latest_assistant_message = content
                for rule in ASSISTANT_PROMPT_STYLE_RULES:
                    if text_contains_keyword(content, rule["keywords"]):
                        prompt_style_counts[rule["label"]] += 1

        if latest_user_message and len(transcript_highlights) < 3:
            transcript_highlights.append(f"학생: {clip_text(latest_user_message, 92)}")
        if latest_assistant_message and len(transcript_highlights) < 4:
            transcript_highlights.append(f"튜터: {clip_text(latest_assistant_message, 92)}")

    conversation_patterns: list[str] = []
    for signal_key, _count in signal_counts.most_common(3):
        rule = TRANSCRIPT_SIGNAL_RULE_BY_KEY[signal_key]
        example = signal_examples.get(signal_key)
        if example:
            conversation_patterns.append(f"'{example}'처럼 {rule['summary']}")
        else:
            conversation_patterns.append(rule["summary"])

    if not conversation_patterns:
        for conversation in conversations[:3]:
            fallback = conversation.get("focus_question") or conversation.get("summary")
            preview = clip_text(fallback, 96)
            if preview:
                conversation_patterns.append(preview)

    exam_review_count = len(
        [conversation for conversation in conversations if conversation.get("source_type") == "exam_review"]
    )
    if exam_review_count and len(conversation_patterns) < 3:
        conversation_patterns.append(
            f"최근 대화 {exam_review_count}건이 오답 복기 맥락이라, 시험 직후 개념 정리가 특히 중요합니다."
        )

    repeated_misconceptions = [
        TRANSCRIPT_SIGNAL_RULE_BY_KEY[signal_key]["label"]
        for signal_key, _count in signal_counts.most_common(3)
    ]
    helpful_prompt_styles = [label for label, _count in prompt_style_counts.most_common(3)]
    for signal_key, _count in signal_counts.most_common(3):
        helpful_prompt_styles.append(TRANSCRIPT_SIGNAL_RULE_BY_KEY[signal_key]["prompt_style"])

    return {
        "signal_counts": signal_counts,
        "conversation_patterns": dedupe_preserving_order(conversation_patterns)[:3],
        "repeated_misconceptions": dedupe_preserving_order(repeated_misconceptions)[:3],
        "helpful_prompt_styles": dedupe_preserving_order(helpful_prompt_styles)[:3],
        "transcript_highlights": dedupe_preserving_order(transcript_highlights)[:4],
    }


def build_llm_conversation_examples(
    conversations: list[dict[str, Any]],
    messages_by_conversation: dict[str, list[dict[str, Any]]],
    course_meta_by_id: dict[str, dict[str, Any]],
    *,
    default_student_name: str = "학생",
    student_name_by_id: dict[str, str] | None = None,
    limit: int = 6,
) -> list[dict[str, Any]]:
    examples: list[dict[str, Any]] = []
    student_names = student_name_by_id or {}

    for conversation in conversations:
        messages = messages_by_conversation.get(conversation["id"], [])
        normalized_messages = [
            {
                "role": message.get("role"),
                "content": normalize_space(message.get("content"))[:280],
            }
            for message in messages
            if normalize_space(message.get("content"))
        ]
        if not normalized_messages:
            preview = build_conversation_preview(conversation, messages)
            if preview:
                normalized_messages = [{"role": "user", "content": preview}]
        if not normalized_messages:
            continue

        course_meta = course_meta_by_id.get(conversation.get("course_id"), {})
        examples.append(
            {
                "conversation_id": conversation["id"],
                "concept": conversation.get("concept_tag"),
                "student_name": student_names.get(conversation.get("student_id"), default_student_name),
                "course_title": course_meta.get("course_title") or course_meta.get("class_title") or "수업",
                "focus_question": conversation.get("focus_question") or conversation.get("summary"),
                "source_type": conversation.get("source_type"),
                "messages": normalized_messages[:6],
            }
        )
        if len(examples) >= limit:
            break

    return examples


def build_student_llm_briefing(
    student_name: str,
    group_title: str,
    class_concept_summary: dict[str, list[dict[str, Any]]],
    unresolved_concepts: list[dict[str, Any]],
) -> dict[str, Any]:
    class_difficult = class_concept_summary.get("difficult", [])
    class_strong = class_concept_summary.get("strong", [])

    if unresolved_concepts:
        unresolved_labels = ", ".join(item["label"] for item in unresolved_concepts[:3])
        executive_summary = (
            f"{group_title}에서 공통적으로 어려웠던 개념 흐름 안에서도 "
            f"{student_name} 학생은 {unresolved_labels} 개념을 아직 확실히 정리하지 못했습니다. "
            f"이 개념들만 우선 다시 확인하면 됩니다."
        )
    elif class_difficult:
        executive_summary = (
            f"{student_name} 학생은 현재 별도 미해결 개념 신호가 두드러지지 않습니다. "
            f"다만 {group_title} 전체가 어려워했던 {class_difficult[0]['label']} 같은 개념은 한 번 더 점검하면 좋습니다."
        )
    else:
        executive_summary = (
            f"{student_name} 학생은 현재 반 전체 흐름 기준으로도 큰 미해결 개념 신호가 없습니다. "
            f"필요한 개념만 가볍게 확인하면 됩니다."
        )

    return {
        "executive_summary": executive_summary,
        "class_difficult_concepts": class_difficult,
        "class_strong_concepts": class_strong,
        "unresolved_concepts": unresolved_concepts,
    }


def build_subject_llm_briefing(
    subject_label: str,
    subject_snapshot: dict[str, Any],
    conversations: list[dict[str, Any]],
    messages_by_conversation: dict[str, list[dict[str, Any]]],
    course_meta_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    examples = build_llm_conversation_examples(
        conversations,
        messages_by_conversation,
        course_meta_by_id,
        limit=8,
    )
    llm_result = summarize_class_conversations_llm(examples)

    lowest_sections = [
        row.get("section")
        for row in subject_snapshot.get("sections", [])
        if row.get("section")
    ][:3]
    teacher_actions = dedupe_preserving_order(
        list(llm_result.get("teaching_suggestions") or [])
        + list(subject_snapshot.get("teaching_signals") or [])
    )[:5]
    talk_track = dedupe_preserving_order(list(llm_result.get("teacher_talk_track") or []))[:3]
    executive_summary = str(llm_result.get("executive_summary") or "").strip()
    if not executive_summary:
        if lowest_sections:
            executive_summary = (
                f"{subject_label}에서는 '{lowest_sections[0]}' 단원을 중심으로 최초 시험 점수가 가장 낮고, "
                f"튜터 대화에서도 비슷한 혼동이 반복되고 있습니다."
            )
        else:
            executive_summary = (
                f"{subject_label} 과목은 최근 시험과 튜터 대화를 함께 보면 특정 개념 확인 질문이 반복되는 흐름입니다."
            )

    return {
        "subject": subject_label,
        "executive_summary": executive_summary,
        "priority_sections": dedupe_preserving_order(lowest_sections)[:3],
        "misconceptions": llm_result.get("misconceptions") or [],
        "question_patterns": llm_result.get("question_patterns") or [],
        "teacher_actions": teacher_actions,
        "teacher_talk_track": talk_track,
    }


def build_teaching_tips(
    subject: str,
    *,
    confusing_concepts: list[str],
    transcript_analysis: dict[str, Any],
    resolved_after_review_count: int,
) -> list[str]:
    tips: list[str] = []

    if confusing_concepts:
        tips.append(
            f"{subject}에서는 '{confusing_concepts[0]}'을 다시 설명하기 전에, 학생이 기준 문장을 먼저 말하고 예시를 분류하게 해보세요."
        )

    signal_counts: Counter[str] = transcript_analysis.get("signal_counts", Counter())
    for signal_key, _count in signal_counts.most_common(2):
        tips.append(TRANSCRIPT_SIGNAL_RULE_BY_KEY[signal_key]["teacher_tip"])

    if resolved_after_review_count > 0:
        tips.append(
            f"복기 후 다시 해결한 문항이 {resolved_after_review_count}개라서, 풀이를 보여주기보다 한 단계씩 말하게 하는 과제가 효과적일 가능성이 높습니다."
        )

    if not tips:
        tips.append(
            f"{subject}는 현재 대화 기준으로 비교적 안정적입니다. 이미 이해한 설명 구조를 다음 단원에서도 반복해서 써볼 수 있습니다."
        )

    return dedupe_preserving_order(tips)[:3]


def resolve_support_signal(
    *,
    average_score: float | None,
    confusing_concept_count: int,
    conversation_count: int,
    transcript_analysis: dict[str, Any],
) -> str:
    signal_total = sum((transcript_analysis.get("signal_counts") or Counter()).values())
    if (
        (average_score is not None and average_score < 60)
        or confusing_concept_count >= 2
        or signal_total >= 4
    ):
        return "intensive"
    if (
        (average_score is not None and average_score < 80)
        or confusing_concept_count >= 1
        or conversation_count >= 2
        or signal_total >= 2
    ):
        return "watch"
    return "stable"


def build_class_title(course: dict, class_row: dict | None) -> str:
    if class_row and class_row.get("title"):
        return class_row["title"]

    grade_level = course.get("grade_level")
    class_label = course.get("class_label")
    if grade_level and class_label:
        return f"{grade_level} {class_label}"
    if class_label:
        return class_label
    return course.get("title") or "운영 반"


def load_course_context(teacher_id: str) -> tuple[list[dict], dict[str, dict]]:
    courses = safe_workspace_course_rows(
        lambda: supabase.table("courses")
        .select(
            "id, teacher_id, title, description, created_at, school_class_id, subject_id, "
            "academic_year, grade_level, class_label, subject_name"
        )
        .eq("teacher_id", teacher_id)
        .order("created_at", desc=True),
        lambda: supabase.table("courses")
        .select("id, teacher_id, title, description, created_at")
        .eq("teacher_id", teacher_id)
        .order("created_at", desc=True),
    )
    if not courses:
        return [], {}

    class_ids = [course["school_class_id"] for course in courses if course.get("school_class_id")]
    subject_ids = [course["subject_id"] for course in courses if course.get("subject_id")]

    class_rows = (
        safe_optional_rows(
            lambda: supabase.table("school_classes")
            .select("id, title, grade_level, class_label, academic_year, class_code")
            .in_("id", class_ids)
        )
        if class_ids
        else []
    )
    subject_rows = (
        safe_optional_rows(
            lambda: supabase.table("subjects")
            .select("id, code, name")
            .in_("id", subject_ids)
        )
        if subject_ids
        else []
    )

    class_by_id = {row["id"]: row for row in class_rows}
    subject_by_id = {row["id"]: row for row in subject_rows}
    meta_by_course_id: dict[str, dict[str, Any]] = {}

    for course in courses:
        class_row = class_by_id.get(course.get("school_class_id"))
        subject_row = subject_by_id.get(course.get("subject_id"))
        group_scope = "school_class" if course.get("school_class_id") else "course"
        group_id = course.get("school_class_id") or course["id"]
        subject_label = subject_row.get("name") if subject_row else None
        subject_label = subject_label or course.get("subject_name") or parse_subject_label(course.get("title"))

        meta_by_course_id[course["id"]] = {
            "course_id": course["id"],
            "course_title": course.get("title") or "수업",
            "group_id": group_id,
            "group_scope": group_scope,
            "class_title": build_class_title(course, class_row),
            "grade_level": class_row.get("grade_level") if class_row else course.get("grade_level"),
            "class_label": class_row.get("class_label") if class_row else course.get("class_label"),
            "subject_label": subject_label,
            "subject_id": course.get("subject_id"),
            "school_class_id": course.get("school_class_id"),
            "academic_year": class_row.get("academic_year") if class_row else course.get("academic_year"),
        }

    return courses, meta_by_course_id


def get_profile_bundle(user_id: str) -> dict[str, Any] | None:
    profile = safe_profile_single(
        lambda: supabase.table("profiles")
        .select("id, email, full_name, role, phone_number, created_at")
        .eq("id", user_id),
        lambda: supabase.table("profiles")
        .select("id, email, full_name, role, created_at")
        .eq("id", user_id),
    )
    if not profile:
        return None

    if profile.get("role") == "teacher":
        settings_row = safe_single(
            lambda: supabase.table("teacher_settings")
            .select("*")
            .eq("teacher_id", user_id)
        ) or {
            "teacher_id": user_id,
            "school_name": "",
            "school_email": profile.get("email") or "",
            "phone_number": profile.get("phone_number") or "",
            "verification_status": "pending",
            "verification_method": "school_email",
            "subject_names": [],
            "grade_levels": [],
            "class_labels": [],
        }
        settings_row["is_admin"] = (
            str(settings_row.get("verification_status") or "").strip().lower() == "verified"
            and str(settings_row.get("verification_method") or "").strip().lower() == "bootstrap_admin"
        )
    else:
        settings_row = safe_single(
            lambda: supabase.table("student_settings")
            .select("*")
            .eq("student_id", user_id)
        ) or {
            "student_id": user_id,
            "phone_number": profile.get("phone_number") or "",
            "student_number": "",
            "class_label": "",
        }

    return {
        "profile": profile,
        "settings": settings_row,
    }


def update_profile_bundle(user_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    existing = get_profile_bundle(user_id)
    if not existing:
        return None

    profile = existing["profile"]
    role = profile.get("role")
    now = datetime.now(UTC).isoformat()
    full_name = payload.get("full_name", profile.get("full_name"))
    phone_number = payload.get("phone_number", profile.get("phone_number"))

    update_profile_record(
        user_id,
        full_name=full_name,
        phone_number=phone_number,
    )

    if role == "teacher":
        settings_payload = {
            "teacher_id": user_id,
            "school_name": payload.get("school_name", ""),
            "school_email": payload.get("school_email", profile.get("email")),
            "phone_number": phone_number,
            "verification_status": payload.get("verification_status", "pending"),
            "verification_method": payload.get("verification_method", "school_email"),
            "subject_names": payload.get("subject_names", []),
            "grade_levels": payload.get("grade_levels", []),
            "class_labels": payload.get("class_labels", []),
            "updated_at": now,
        }
        upsert_workspace_settings("teacher_settings", settings_payload)
    else:
        settings_payload = {
            "student_id": user_id,
            "phone_number": phone_number,
            "student_number": payload.get("student_number", ""),
            "school_class_id": payload.get("school_class_id"),
            "class_label": payload.get("class_label", ""),
            "updated_at": now,
        }
        upsert_workspace_settings("student_settings", settings_payload)

    return get_profile_bundle(user_id)


def build_first_attempt_question_rows(
    course_ids: list[str],
    course_meta_by_id: dict[str, dict],
    *,
    student_id: str | None = None,
) -> list[dict[str, Any]]:
    if not course_ids:
        return []

    exams = safe_exam_rows(
        lambda: supabase.table("exams")
        .select("id, course_id, title, section_title")
        .in_("course_id", course_ids),
        lambda: supabase.table("exams")
        .select("id, course_id, title")
        .in_("course_id", course_ids),
    )
    if not exams:
        return []

    exam_ids = [row["id"] for row in exams]
    exam_by_id = {row["id"]: row for row in exams}

    questions = safe_exam_question_rows(
        lambda: supabase.table("exam_questions")
        .select("id, exam_id, question_order, concept_tag, prompt, points, source_pages, evidence_excerpt")
        .in_("exam_id", exam_ids),
        lambda: supabase.table("exam_questions")
        .select("id, exam_id, question_order, concept_tag, prompt, points")
        .in_("exam_id", exam_ids),
    )
    question_by_id = {row["id"]: row for row in questions}

    attempt_query = (
        lambda: supabase.table("exam_attempts")
        .select("id, exam_id, student_id, course_id, attempt_number, score, max_score, submitted_at")
        .in_("course_id", course_ids)
        .order("attempt_number")
        .order("submitted_at")
    )
    if student_id:
        attempts = safe_rows(lambda: attempt_query().eq("student_id", student_id))
    else:
        attempts = safe_rows(attempt_query)

    first_attempt_by_exam_student: dict[tuple[str, str], dict] = {}
    for attempt in attempts:
        key = (attempt["student_id"], attempt["exam_id"])
        first_attempt_by_exam_student.setdefault(key, attempt)

    first_attempts = list(first_attempt_by_exam_student.values())
    attempt_ids = [attempt["id"] for attempt in first_attempts]
    if not attempt_ids:
        return []

    answers = safe_rows(
        lambda: supabase.table("exam_answers")
        .select("attempt_id, question_id, is_correct, resolved_via_tutor, selected_choice, corrected_choice")
        .in_("attempt_id", attempt_ids)
    )
    answers_by_attempt: dict[str, list[dict]] = defaultdict(list)
    for answer in answers:
        answers_by_attempt[answer["attempt_id"]].append(answer)

    rows: list[dict[str, Any]] = []
    for attempt in first_attempts:
        course_meta = course_meta_by_id.get(attempt["course_id"], {})
        exam = exam_by_id.get(attempt["exam_id"], {})
        for answer in answers_by_attempt.get(attempt["id"], []):
            question = question_by_id.get(answer["question_id"])
            if not question:
                continue
            points = int(question.get("points", 0) or 0)
            subject_label = parse_subject_label(question.get("concept_tag")) or course_meta.get("subject_label") or "통합"
            rows.append(
                {
                    "course_id": attempt["course_id"],
                    "student_id": attempt["student_id"],
                    "exam_id": attempt["exam_id"],
                    "exam_title": exam.get("title") or "시험",
                    "attempt_id": attempt["id"],
                    "question_id": question["id"],
                    "question_order": question.get("question_order"),
                    "prompt": question.get("prompt"),
                    "subject_label": subject_label,
                    "section_label": question.get("concept_tag") or exam.get("section_title") or "기타",
                    "points": points,
                    "score_points": points if answer.get("is_correct") else 0,
                    "resolved_via_tutor": bool(answer.get("resolved_via_tutor")),
                    "is_correct": bool(answer.get("is_correct")),
                    "selected_choice": answer.get("selected_choice"),
                    "course_meta": course_meta,
                }
            )

    return rows


def compute_average_percent(rows: list[dict[str, Any]]) -> float | None:
    total_points = sum(int(row.get("points", 0) or 0) for row in rows)
    if total_points <= 0:
        return None
    score_points = sum(int(row.get("score_points", 0) or 0) for row in rows)
    return round(score_points / total_points * 100, 1)


def build_concept_display_label(subject_label: str | None, section_label: str | None) -> str:
    normalized_subject = normalize_space(subject_label)
    normalized_section = normalize_space(section_label)
    if not normalized_section:
        return normalized_subject or "기타"
    if normalized_subject and normalized_subject != "통합" and normalized_subject not in normalized_section:
        return f"{normalized_subject} · {normalized_section}"
    return normalized_section


def summarize_group_concepts(first_attempt_rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    rows_by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    student_ids_by_label: dict[str, set[str]] = defaultdict(set)

    for row in first_attempt_rows:
        label = build_concept_display_label(row.get("subject_label"), row.get("section_label"))
        rows_by_label[label].append(row)
        if row.get("student_id"):
            student_ids_by_label[label].add(str(row["student_id"]))

    concept_rows: list[dict[str, Any]] = []
    for label, rows in rows_by_label.items():
        concept_rows.append(
            {
                "label": label,
                "average_first_score": compute_average_percent(rows),
                "student_count": len(student_ids_by_label[label]),
                "question_count": len(rows),
            }
        )

    common_rows = [row for row in concept_rows if row["student_count"] >= 2] or concept_rows

    difficult = sorted(
        common_rows,
        key=lambda row: (
            -(row.get("student_count") or 0),
            row.get("average_first_score") if row.get("average_first_score") is not None else 101,
            row["label"],
        ),
    )[:4]
    strong = sorted(
        common_rows,
        key=lambda row: (
            -(row.get("student_count") or 0),
            -1 * (row.get("average_first_score") if row.get("average_first_score") is not None else -1),
            row["label"],
        ),
    )[:4]

    return {
        "difficult": difficult,
        "strong": strong,
    }


def summarize_student_unresolved_concepts(
    first_attempt_rows: list[dict[str, Any]],
    concept_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    unresolved_by_label: dict[str, dict[str, Any]] = {}

    for row in first_attempt_rows:
        if row.get("is_correct") or row.get("resolved_via_tutor"):
            continue
        label = build_concept_display_label(row.get("subject_label"), row.get("section_label"))
        entry = unresolved_by_label.setdefault(
            label,
            {
                "label": label,
                "subject": row.get("subject_label") or parse_subject_label(label),
                "reason": "최초 시험에서 틀렸고, 아직 복기로 해결된 기록이 없습니다.",
                "unresolved_question_count": 0,
            },
        )
        entry["unresolved_question_count"] += 1

    for row in concept_rows:
        stuck_count = int(row.get("stuck_count", 0) or 0)
        resolved_count = int(row.get("resolved_count", 0) or 0)
        if stuck_count <= resolved_count:
            continue
        label = normalize_space(row.get("concept")) or "기타"
        entry = unresolved_by_label.setdefault(
            label,
            {
                "label": label,
                "subject": parse_subject_label(label),
                "reason": "튜터 대화 기준으로 아직 개념 이해가 안정되지 않았습니다.",
                "unresolved_question_count": 0,
            },
        )
        if entry["unresolved_question_count"] > 0:
            entry["reason"] = "최초 시험 오답과 튜터 대화 모두에서 아직 미해결 신호가 남아 있습니다."

    return sorted(
        unresolved_by_label.values(),
        key=lambda row: (-row.get("unresolved_question_count", 0), row["label"]),
    )[:5]


def get_teacher_students_overview(teacher_id: str) -> dict[str, Any]:
    courses, course_meta_by_id = load_course_context(teacher_id)
    if not courses:
        return {"classes": []}

    course_ids = [course["id"] for course in courses]
    enrollments = safe_rows(
        lambda: supabase.table("enrollments")
        .select("id, course_id, student_id")
        .in_("course_id", course_ids)
    )
    if not enrollments:
        return {"classes": []}

    student_ids = sorted({row["student_id"] for row in enrollments})
    profiles = safe_profile_rows(
        lambda: supabase.table("profiles")
        .select("id, email, full_name, phone_number")
        .in_("id", student_ids),
        lambda: supabase.table("profiles")
        .select("id, email, full_name")
        .in_("id", student_ids),
    )
    profile_by_id = {row["id"]: row for row in profiles}

    concept_rows = safe_optional_rows(
        lambda: supabase.table("concept_stats")
        .select("student_id, course_id, concept, stuck_count, resolved_count")
        .in_("course_id", course_ids)
        .in_("student_id", student_ids)
    )
    concept_rows_by_student_course: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in concept_rows:
        concept_rows_by_student_course[(row["student_id"], row["course_id"])].append(row)

    conversation_rows = safe_rows(
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at")
        .in_("course_id", course_ids)
        .in_("student_id", student_ids)
        .order("ended_at", desc=True)
    )
    conversations_by_student_course: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in conversation_rows:
        conversations_by_student_course[(row["student_id"], row["course_id"])].append(row)

    first_attempt_rows = build_first_attempt_question_rows(course_ids, course_meta_by_id)
    attempt_rows_by_student_course: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in first_attempt_rows:
        attempt_rows_by_student_course[(row["student_id"], row["course_id"])].append(row)

    notes = safe_rows(
        lambda: supabase.table("teacher_notes")
        .select("id, student_id, course_id, school_class_id, note, updated_at")
        .eq("teacher_id", teacher_id)
        .in_("student_id", student_ids)
        .order("updated_at", desc=True)
    )
    note_by_scope: dict[tuple[str, str], dict] = {}
    for row in notes:
        scope_id = row.get("school_class_id") or row.get("course_id")
        if not scope_id:
            continue
        note_by_scope.setdefault((row["student_id"], scope_id), row)

    classes: dict[str, dict[str, Any]] = {}
    for enrollment in enrollments:
        course_meta = course_meta_by_id.get(enrollment["course_id"])
        if not course_meta:
            continue
        group_id = str(course_meta["group_id"])
        group = classes.setdefault(
            group_id,
            {
                "id": group_id,
                "scope_type": course_meta["group_scope"],
                "title": course_meta["class_title"],
                "grade_level": course_meta.get("grade_level"),
                "class_label": course_meta.get("class_label"),
                "course_ids": [],
                "subject_labels": set(),
                "students": {},
            },
        )
        if enrollment["course_id"] not in group["course_ids"]:
            group["course_ids"].append(enrollment["course_id"])
        group["subject_labels"].add(course_meta["subject_label"])
        student = group["students"].setdefault(
            enrollment["student_id"],
            {
                "id": enrollment["student_id"],
                "full_name": profile_by_id.get(enrollment["student_id"], {}).get("full_name") or "학생",
                "email": profile_by_id.get(enrollment["student_id"], {}).get("email"),
                "average_first_score": None,
                "needs_support_count": 0,
                "mastered_count": 0,
                "recent_conversation_count": 0,
                "note_preview": None,
            },
        )
        stats_rows = concept_rows_by_student_course.get((enrollment["student_id"], enrollment["course_id"]), [])
        student["needs_support_count"] += len(
            [row for row in stats_rows if row.get("stuck_count", 0) > 0 and row.get("stuck_count", 0) >= row.get("resolved_count", 0)]
        )
        student["mastered_count"] += len(
            [row for row in stats_rows if row.get("resolved_count", 0) > row.get("stuck_count", 0)]
        )
        student["recent_conversation_count"] += len(
            conversations_by_student_course.get((enrollment["student_id"], enrollment["course_id"]), [])[:3]
        )

    for group in classes.values():
        for student in group["students"].values():
            relevant_rows = [
                row
                for course_id in group["course_ids"]
                for row in attempt_rows_by_student_course.get((student["id"], course_id), [])
            ]
            student["average_first_score"] = compute_average_percent(relevant_rows)
            note = note_by_scope.get((student["id"], group["id"]))
            if note and note.get("note"):
                student["note_preview"] = note["note"][:80]

        group["student_count"] = len(group["students"])
        group["subject_labels"] = sorted(group["subject_labels"])
        group["students"] = sorted(group["students"].values(), key=lambda row: row["full_name"])

    class_rows = sorted(classes.values(), key=lambda row: row["title"])
    return {"classes": class_rows}


def get_teacher_student_detail(teacher_id: str, student_id: str, group_id: str | None = None) -> dict[str, Any] | None:
    courses, course_meta_by_id = load_course_context(teacher_id)
    if not courses:
        return None

    matching_course_ids = [
        course["id"]
        for course in courses
        if not group_id or str(course_meta_by_id.get(course["id"], {}).get("group_id")) == str(group_id)
    ]
    if not matching_course_ids:
        matching_course_ids = [course["id"] for course in courses]

    profile = safe_profile_single(
        lambda: supabase.table("profiles")
        .select("id, email, full_name, phone_number")
        .eq("id", student_id),
        lambda: supabase.table("profiles")
        .select("id, email, full_name")
        .eq("id", student_id),
    )
    student_settings = safe_single(
        lambda: supabase.table("student_settings")
        .select("*")
        .eq("student_id", student_id)
    ) or {}
    if not profile:
        return None

    group_meta = course_meta_by_id.get(matching_course_ids[0], {})
    group_title = group_meta.get("class_title") or "운영 반"
    class_first_attempt_rows = build_first_attempt_question_rows(
        matching_course_ids,
        course_meta_by_id,
    )

    concept_rows = safe_optional_rows(
        lambda: supabase.table("concept_stats")
        .select("student_id, course_id, concept, stuck_count, resolved_count")
        .in_("course_id", matching_course_ids)
        .eq("student_id", student_id)
    )
    first_attempt_rows = build_first_attempt_question_rows(
        matching_course_ids,
        course_meta_by_id,
        student_id=student_id,
    )
    conversations = safe_tutor_conversation_rows(
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at, source_type, focus_question")
        .in_("course_id", matching_course_ids)
        .eq("student_id", student_id)
        .order("ended_at", desc=True)
        .limit(24),
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at")
        .in_("course_id", matching_course_ids)
        .eq("student_id", student_id)
        .order("ended_at", desc=True)
        .limit(24),
    )
    conversation_messages_by_id = load_conversation_messages([row["id"] for row in conversations])

    note = safe_single(
        lambda: supabase.table("teacher_notes")
        .select("id, note, updated_at")
        .eq("teacher_id", teacher_id)
        .eq("student_id", student_id)
        .eq(
            "school_class_id" if group_meta.get("group_scope") == "school_class" else "course_id",
            group_meta.get("group_id"),
        )
        .order("updated_at", desc=True)
        .limit(1)
    )

    subject_scores: list[dict[str, Any]] = []
    rows_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in first_attempt_rows:
        rows_by_subject[row["subject_label"]].append(row)

    concept_rows_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in concept_rows:
        concept_rows_by_subject[parse_subject_label(row.get("concept"))].append(row)

    conversation_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in conversations:
        conversation_by_subject[parse_subject_label(row.get("concept_tag"))].append(row)

    ai_analysis: list[dict[str, Any]] = []
    analysis_subjects = sorted(
        {
            *rows_by_subject.keys(),
            *concept_rows_by_subject.keys(),
            *conversation_by_subject.keys(),
        }
    )
    for subject in analysis_subjects:
        rows = rows_by_subject.get(subject, [])
        sections: list[dict[str, Any]] = []
        rows_by_section: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            rows_by_section[row["section_label"]].append(row)
        for section, section_rows in sorted(rows_by_section.items()):
            sections.append(
                {
                    "section": section,
                    "average_score": compute_average_percent(section_rows),
                    "question_count": len(section_rows),
                }
            )

        subject_concepts = concept_rows_by_subject.get(subject, [])
        subject_conversations = conversation_by_subject.get(subject, [])
        confusing_concepts = sorted(
            [row for row in subject_concepts if row.get("stuck_count", 0) >= row.get("resolved_count", 0)],
            key=lambda row: (-row.get("stuck_count", 0), row.get("concept") or ""),
        )
        understood_concepts = sorted(
            [row for row in subject_concepts if row.get("resolved_count", 0) > row.get("stuck_count", 0)],
            key=lambda row: (-row.get("resolved_count", 0), row.get("concept") or ""),
        )
        confusing_concept_names = dedupe_preserving_order([row.get("concept") or "" for row in confusing_concepts[:4]])
        understood_concept_names = dedupe_preserving_order([row.get("concept") or "" for row in understood_concepts[:4]])
        resolved_after_review_count = len([row for row in rows if row.get("resolved_via_tutor")])
        transcript_analysis = analyze_transcript_bundle(
            subject_conversations,
            conversation_messages_by_id,
        )
        average_score = compute_average_percent(rows)

        if rows:
            subject_scores.append(
                {
                    "subject": subject,
                    "average_score": average_score,
                    "question_count": len(rows),
                    "resolved_after_review_count": resolved_after_review_count,
                    "sections": sections,
                }
            )
        ai_analysis.append(
            {
                "subject": subject,
                "understood_concepts": understood_concept_names,
                "confusing_concepts": confusing_concept_names,
                "repeated_misconceptions": transcript_analysis["repeated_misconceptions"],
                "helpful_prompt_styles": transcript_analysis["helpful_prompt_styles"],
                "conversation_patterns": transcript_analysis["conversation_patterns"],
                "transcript_highlights": transcript_analysis["transcript_highlights"],
                "conversation_count": len(subject_conversations),
                "support_signal": resolve_support_signal(
                    average_score=average_score,
                    confusing_concept_count=len(confusing_concept_names),
                    conversation_count=len(subject_conversations),
                    transcript_analysis=transcript_analysis,
                ),
                "teaching_tips": build_teaching_tips(
                    subject,
                    confusing_concepts=confusing_concept_names,
                    transcript_analysis=transcript_analysis,
                    resolved_after_review_count=resolved_after_review_count,
                ),
            }
        )

    summary = {
        "average_first_score": compute_average_percent(first_attempt_rows),
        "needs_support_count": len([row for row in concept_rows if row.get("stuck_count", 0) > row.get("resolved_count", 0)]),
        "mastered_count": len([row for row in concept_rows if row.get("resolved_count", 0) > row.get("stuck_count", 0)]),
        "recent_conversation_count": len(conversations),
    }
    class_concept_summary = summarize_group_concepts(class_first_attempt_rows)
    unresolved_concepts = summarize_student_unresolved_concepts(first_attempt_rows, concept_rows)
    llm_briefing = build_student_llm_briefing(
        profile.get("full_name") or "학생",
        group_title,
        class_concept_summary,
        unresolved_concepts,
    )

    return {
        "student": {
            **profile,
            "student_number": student_settings.get("student_number"),
            "class_label": student_settings.get("class_label") or group_meta.get("class_label"),
        },
        "group": {
            "id": str(group_meta.get("group_id") or matching_course_ids[0]),
            "scope_type": group_meta.get("group_scope", "course"),
            "title": group_title,
            "subject_labels": sorted({course_meta_by_id[course_id]["subject_label"] for course_id in matching_course_ids if course_id in course_meta_by_id}),
        },
        "summary": summary,
        "note": note.get("note") if note else "",
        "note_updated_at": note.get("updated_at") if note else None,
        "subject_scores": subject_scores,
        "ai_analysis": ai_analysis,
        "class_concept_summary": class_concept_summary,
        "llm_briefing": llm_briefing,
        "recent_conversations": [
            {
                **conversation,
                "preview": build_conversation_preview(
                    conversation,
                    conversation_messages_by_id.get(conversation["id"], []),
                ),
                "message_count": len(conversation_messages_by_id.get(conversation["id"], [])),
            }
            for conversation in conversations[:8]
        ],
    }


def save_teacher_note(
    teacher_id: str,
    student_id: str,
    note: str,
    *,
    school_class_id: str | None = None,
    course_id: str | None = None,
) -> dict[str, Any]:
    existing = safe_single(
        lambda: supabase.table("teacher_notes")
        .select("id")
        .eq("teacher_id", teacher_id)
        .eq("student_id", student_id)
        .eq("school_class_id" if school_class_id else "course_id", school_class_id or course_id)
        .limit(1)
    )
    payload = {
        "teacher_id": teacher_id,
        "student_id": student_id,
        "school_class_id": school_class_id,
        "course_id": course_id,
        "note": note,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if existing:
        supabase.table("teacher_notes").update(payload).eq("id", existing["id"]).execute()
        note_id = existing["id"]
    else:
        created = (
            supabase.table("teacher_notes")
            .insert(payload)
            .execute()
        )
        note_id = created.data["id"]

    return {
        "id": note_id,
        "note": note,
        "updated_at": payload["updated_at"],
    }


def get_teacher_subject_overview(teacher_id: str) -> dict[str, Any]:
    courses, course_meta_by_id = load_course_context(teacher_id)
    if not courses:
        return {"subjects": []}

    course_ids = [course["id"] for course in courses]
    first_attempt_rows = build_first_attempt_question_rows(course_ids, course_meta_by_id)
    if not first_attempt_rows:
        return {"subjects": []}

    concept_rows = safe_optional_rows(
        lambda: supabase.table("concept_stats")
        .select("student_id, course_id, concept, stuck_count, resolved_count")
        .in_("course_id", course_ids)
    )
    concept_rows_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in concept_rows:
        concept_rows_by_subject[parse_subject_label(row.get("concept"))].append(row)

    conversations = safe_tutor_conversation_rows(
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at, source_type, focus_question")
        .in_("course_id", course_ids)
        .order("ended_at", desc=True)
        .limit(240),
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at")
        .in_("course_id", course_ids)
        .order("ended_at", desc=True)
        .limit(240),
    )
    conversation_messages_by_id = load_conversation_messages([row["id"] for row in conversations])
    conversation_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in conversations:
        conversation_by_subject[parse_subject_label(row.get("concept_tag"))].append(row)

    subjects: list[dict[str, Any]] = []
    rows_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in first_attempt_rows:
        rows_by_subject[row["subject_label"]].append(row)

    for subject_label, subject_rows in sorted(rows_by_subject.items()):
        rows_by_section: dict[str, list[dict]] = defaultdict(list)
        rows_by_group: dict[str, list[dict]] = defaultdict(list)
        rows_by_group_section: dict[tuple[str, str], list[dict]] = defaultdict(list)
        rows_by_question: dict[str, list[dict]] = defaultdict(list)
        for row in subject_rows:
            rows_by_section[row["section_label"]].append(row)
            group_key = str(row["course_meta"].get("group_id") or row["course_id"])
            rows_by_group[group_key].append(row)
            rows_by_group_section[(group_key, row["section_label"])].append(row)
            rows_by_question[row["question_id"]].append(row)

        sections = [
            {
                "section": section,
                "average_score": compute_average_percent(section_rows),
                "question_count": len(section_rows),
            }
            for section, section_rows in sorted(rows_by_section.items(), key=lambda item: (compute_average_percent(item[1]) or 1000, item[0]))
        ]

        class_breakdown = [
            {
                "group_id": group_id,
                "title": group_rows[0]["course_meta"].get("class_title") or "운영 반",
                "average_score": compute_average_percent(group_rows),
            }
            for group_id, group_rows in rows_by_group.items()
        ]
        class_breakdown.sort(key=lambda row: (row["average_score"] if row["average_score"] is not None else 1000, row["title"]))

        class_sections = []
        for group_id, group_rows in rows_by_group.items():
            section_rows = [
                {
                    "section": section,
                    "average_score": compute_average_percent(group_section_rows),
                    "question_count": len(group_section_rows),
                }
                for (section_group_id, section), group_section_rows in rows_by_group_section.items()
                if section_group_id == group_id
            ]
            section_rows.sort(key=lambda row: (row["average_score"] if row["average_score"] is not None else 1000, row["section"]))
            class_sections.append(
                {
                    "group_id": group_id,
                    "title": group_rows[0]["course_meta"].get("class_title") or "운영 반",
                    "sections": section_rows,
                }
            )

        hardest_questions = [
            {
                "question_id": question_id,
                "exam_title": question_rows[0]["exam_title"],
                "question_order": question_rows[0]["question_order"],
                "prompt": question_rows[0]["prompt"],
                "accuracy_rate": compute_average_percent(question_rows),
            }
            for question_id, question_rows in rows_by_question.items()
        ]
        hardest_questions.sort(key=lambda row: (row["accuracy_rate"] if row["accuracy_rate"] is not None else 1000, row["question_order"] or 0))

        subject_concepts = concept_rows_by_subject.get(subject_label, [])
        confusing_concepts = sorted(
            [row for row in subject_concepts if row.get("stuck_count", 0) >= row.get("resolved_count", 0)],
            key=lambda row: (-row.get("stuck_count", 0), row.get("concept") or ""),
        )
        confusing_concept_names = dedupe_preserving_order([row.get("concept") or "" for row in confusing_concepts[:4]])
        transcript_analysis = analyze_transcript_bundle(
            conversation_by_subject.get(subject_label, [])[:12],
            conversation_messages_by_id,
        )
        transcript_signals: list[str] = []
        if transcript_analysis["repeated_misconceptions"]:
            transcript_signals.append(
                f"대화 원문에서는 '{transcript_analysis['repeated_misconceptions'][0]}' 흐름이 가장 자주 보입니다."
            )
        if transcript_analysis["helpful_prompt_styles"]:
            transcript_signals.append(
                f"복기 질문 방식으로는 '{transcript_analysis['helpful_prompt_styles'][0]}'이 가장 자주 쓰였습니다."
            )
        if confusing_concept_names:
            transcript_signals.append(
                f"학생들이 특히 헷갈려하는 개념은 '{confusing_concept_names[0]}'입니다."
            )

        subjects.append(
            {
                "subject": subject_label,
                "average_first_score": compute_average_percent(subject_rows),
                "student_count": len({row["student_id"] for row in subject_rows}),
                "course_count": len({row["course_id"] for row in subject_rows}),
                "sections": sections[:10],
                "class_breakdown": class_breakdown,
                "class_sections": class_sections,
                "hardest_questions": hardest_questions[:5],
                "conversation_count": len(conversation_by_subject.get(subject_label, [])),
                "common_confusions": transcript_analysis["repeated_misconceptions"],
                "helpful_prompt_styles": transcript_analysis["helpful_prompt_styles"],
                "conversation_patterns": transcript_analysis["conversation_patterns"],
                "teaching_signals": dedupe_preserving_order([
                    (
                        f"가장 낮은 목차는 '{sections[0]['section']}' 입니다. "
                        f"최초 시험 평균은 {sections[0]['average_score']}점입니다."
                    )
                    if sections
                    else "아직 충분한 시험 데이터가 없습니다.",
                    (
                        f"가장 어려운 문항은 {hardest_questions[0]['exam_title']} {hardest_questions[0]['question_order']}번입니다."
                    )
                    if hardest_questions
                    else "문항 난이도 신호가 아직 없습니다.",
                    *transcript_signals,
                ])[:4],
            }
        )

    subjects.sort(key=lambda row: (row["average_first_score"] if row["average_first_score"] is not None else 1000, row["subject"]))
    return {"subjects": subjects}


def get_teacher_subject_briefing(teacher_id: str, subject_name: str) -> dict[str, Any] | None:
    overview = get_teacher_subject_overview(teacher_id)
    subject_snapshot = next(
        (item for item in overview.get("subjects", []) if item.get("subject") == subject_name),
        None,
    )
    if not subject_snapshot:
        return None

    courses, course_meta_by_id = load_course_context(teacher_id)
    if not courses:
        return None

    course_ids = [course["id"] for course in courses]
    conversations = safe_tutor_conversation_rows(
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at, source_type, focus_question")
        .in_("course_id", course_ids)
        .order("ended_at", desc=True)
        .limit(240),
        lambda: supabase.table("tutor_conversations")
        .select("id, student_id, course_id, concept_tag, summary, ended_at")
        .in_("course_id", course_ids)
        .order("ended_at", desc=True)
        .limit(240),
    )
    subject_conversations = [
        conversation
        for conversation in conversations
        if parse_subject_label(conversation.get("concept_tag")) == subject_name
    ]
    messages_by_conversation = load_conversation_messages([row["id"] for row in subject_conversations])

    return build_subject_llm_briefing(
        subject_name,
        subject_snapshot,
        subject_conversations[:12],
        messages_by_conversation,
        course_meta_by_id,
    )


def get_student_performance_overview(student_id: str, course_id: str) -> dict[str, Any]:
    course = safe_workspace_course_single(
        lambda: supabase.table("courses")
        .select(
            "id, teacher_id, title, description, created_at, school_class_id, subject_id, "
            "academic_year, grade_level, class_label, subject_name"
        )
        .eq("id", course_id),
        lambda: supabase.table("courses")
        .select("id, teacher_id, title, description, created_at")
        .eq("id", course_id),
    )
    if not course:
        return {"subjects": [], "exam_cards": [], "summary": {}}

    course_meta_by_id = {course_id: load_course_context(course.get("teacher_id"))[1].get(course_id, {
        "course_id": course_id,
        "course_title": course.get("title") or "수업",
        "group_id": course_id,
        "group_scope": "course",
        "class_title": course.get("title") or "수업",
        "subject_label": course.get("subject_name") or parse_subject_label(course.get("title")),
    })}

    first_attempt_rows = build_first_attempt_question_rows([course_id], course_meta_by_id, student_id=student_id)
    rows_by_subject: dict[str, list[dict]] = defaultdict(list)
    for row in first_attempt_rows:
        rows_by_subject[row["subject_label"]].append(row)

    subjects = [
        {
            "subject": subject,
            "average_score": compute_average_percent(rows),
            "question_count": len(rows),
            "sections": [
                {
                    "section": section,
                    "average_score": compute_average_percent(section_rows),
                    "question_count": len(section_rows),
                }
                for section, section_rows in defaultdict(list, {
                    key: value for key, value in ((section, [row for row in rows if row["section_label"] == section]) for section in sorted({row["section_label"] for row in rows}))
                }).items()
            ],
        }
        for subject, rows in sorted(rows_by_subject.items())
    ]

    exam_cards: list[dict[str, Any]] = []
    rows_by_exam: dict[str, list[dict]] = defaultdict(list)
    for row in first_attempt_rows:
        rows_by_exam[row["exam_id"]].append(row)
    for exam_id, rows in rows_by_exam.items():
        exam_cards.append(
            {
                "exam_id": exam_id,
                "title": rows[0]["exam_title"],
                "average_score": compute_average_percent(rows),
                "subjects": sorted({row["subject_label"] for row in rows}),
                "wrong_count": len([row for row in rows if not row.get("is_correct")]),
            }
        )
    exam_cards.sort(key=lambda row: row["title"])

    return {
        "summary": {
            "subject_count": len(subjects),
            "average_first_score": compute_average_percent(first_attempt_rows),
            "completed_exams": len(exam_cards),
        },
        "subjects": subjects,
        "exam_cards": exam_cards,
    }
