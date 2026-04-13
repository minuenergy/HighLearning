from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.ai_client import generate_json
from app.services.exam_service import (
    get_course_exam_overview,
    get_exam_progress,
    get_student_exam_overview,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
LLM_ANALYSIS_CACHE_TTL_SECONDS = 300
LLM_ANALYSIS_CACHE: dict[str, tuple[datetime, dict]] = {}


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
        if get_api_error_code(error) == "PGRST205":
            return []
        raise

    return result.data or []


def get_existing_stat(student_id: str, course_id: str, concept: str):
    result = supabase.table("concept_stats").select("*") \
        .eq("student_id", student_id) \
        .eq("course_id", course_id) \
        .eq("concept", concept).execute()
    return result.data[0] if result.data else None


def log_stuck_event(student_id: str, course_id: str, concept: str):
    supabase.table("tutor_sessions").insert({
        "student_id": student_id,
        "course_id": course_id,
        "concept_tag": concept,
        "stuck_count": 1,
    }).execute()

    existing = get_existing_stat(student_id, course_id, concept)
    if existing:
        supabase.table("concept_stats").update({
            "stuck_count": existing["stuck_count"] + 1,
            "last_updated": datetime.utcnow().isoformat()
        }).eq("id", existing["id"]).execute()
    else:
        supabase.table("concept_stats").insert({
            "student_id": student_id,
            "course_id": course_id,
            "concept": concept,
            "stuck_count": 1,
        }).execute()


def log_resolved_event(student_id: str, course_id: str, concept: str):
    existing = get_existing_stat(student_id, course_id, concept)
    if existing:
        supabase.table("concept_stats").update({
            "resolved_count": existing["resolved_count"] + 1,
            "last_updated": datetime.utcnow().isoformat()
        }).eq("id", existing["id"]).execute()


def aggregate_class_stats(rows: list[dict]) -> list[dict]:
    stats: dict[str, dict] = {}
    for row in rows:
        concept = row["concept"]
        if concept not in stats:
            stats[concept] = {
                "concept": concept,
                "total_stuck": 0,
                "total_resolved": 0,
                "student_count": 0,
            }
        stats[concept]["total_stuck"] += row.get("stuck_count", 0)
        stats[concept]["total_resolved"] += row.get("resolved_count", 0)
        stats[concept]["student_count"] += 1
    return list(stats.values())


def enrich_class_stats(rows: list[dict]) -> list[dict]:
    enriched: list[dict] = []
    for row in aggregate_class_stats(rows):
        total_events = row["total_stuck"] + row["total_resolved"]
        resolve_rate = round((row["total_resolved"] / total_events) * 100, 1) if total_events else 0.0
        strength_score = round((row["total_resolved"] + 1) / (row["total_stuck"] + row["total_resolved"] + 1) * 100, 1)
        enriched.append(
            {
                **row,
                "resolve_rate": resolve_rate,
                "strength_score": strength_score,
            }
        )
    return enriched


def get_class_concept_stats(course_id: str) -> list[dict]:
    result = supabase.table("concept_stats") \
        .select("concept, stuck_count, resolved_count") \
        .eq("course_id", course_id).execute()
    return aggregate_class_stats(result.data)


def get_student_concept_stats(student_id: str, course_id: str) -> list[dict]:
    result = supabase.table("concept_stats").select("*") \
        .eq("student_id", student_id) \
        .eq("course_id", course_id).execute()
    return result.data


def fetch_profiles(profile_ids: list[str]) -> dict[str, dict]:
    if not profile_ids:
        return {}

    rows = safe_rows(
        lambda: supabase.table("profiles")
        .select("id, full_name, email, role")
        .in_("id", profile_ids)
    )
    return {row["id"]: row for row in rows}


def get_conversation_examples(course_id: str, focus_concepts: list[str]) -> list[dict]:
    conversations = safe_rows(
        lambda: supabase.table("tutor_conversations")
        .select("*")
        .eq("course_id", course_id)
        .order("started_at", desc=True)
        .limit(80)
    )
    if not conversations:
        return []

    concept_rank = {concept: index for index, concept in enumerate(focus_concepts)}
    filtered = conversations
    if focus_concepts:
        prioritized = [row for row in conversations if row.get("concept_tag") in concept_rank]
        filtered = prioritized or conversations

    filtered.sort(
        key=lambda row: (
            0 if row.get("source_type") == "exam_review" else 1,
            concept_rank.get(row.get("concept_tag"), 999),
            -(row.get("stuck_count") or 0),
            row.get("started_at") or "",
        )
    )
    top_examples = filtered[:6]

    conversation_ids = [row["id"] for row in top_examples]
    student_ids = [row["student_id"] for row in top_examples if row.get("student_id")]
    messages = (
        safe_rows(
            lambda: supabase.table("tutor_messages")
            .select("*")
            .in_("conversation_id", conversation_ids)
            .order("message_order")
        )
        if conversation_ids
        else []
    )
    messages_by_conversation: dict[str, list[dict]] = defaultdict(list)
    for message in messages:
        messages_by_conversation[message["conversation_id"]].append(message)

    profiles = fetch_profiles(student_ids)
    results: list[dict] = []
    for row in top_examples:
        results.append(
            {
                "conversation_id": row["id"],
                "concept": row.get("concept_tag"),
                "student_name": profiles.get(row.get("student_id"), {}).get("full_name", "학생"),
                "summary": row.get("summary"),
                "source_type": row.get("source_type", "tutor_session"),
                "focus_question": row.get("focus_question"),
                "started_at": row.get("started_at"),
                "messages": [
                    {
                        "role": message.get("role"),
                        "content": message.get("content"),
                    }
                    for message in messages_by_conversation.get(row["id"], [])[:4]
                ],
            }
        )
    return results


def build_teacher_insights(
    difficult_concepts: list[dict],
    strong_concepts: list[dict],
    hardest_questions: list[dict],
    assignment_overview: list[dict],
) -> list[str]:
    insights: list[str] = []

    if difficult_concepts:
        concept = difficult_concepts[0]
        insights.append(
            f"'{concept['concept']}'에서 막힘이 가장 많습니다. 질문 사례와 시험 문항을 함께 보며 오개념 패턴을 확인해보세요."
        )

    if strong_concepts:
        concept = strong_concepts[0]
        insights.append(
            f"'{concept['concept']}'은 해결 비율이 높아 강점 단원으로 보입니다. 같은 설명 구조를 다른 단원 보강에 재사용해볼 수 있습니다."
        )

    if hardest_questions:
        question = hardest_questions[0]
        insights.append(
            f"{question['exam_title']} {question['question_order']}번 문항은 정답률이 가장 낮습니다. 관련 개념은 '{question['concept_tag']}'입니다."
        )

    if assignment_overview:
        assignment = assignment_overview[0]
        if assignment.get("pending_student_count", 0) > 0:
            insights.append(
                f"'{assignment['title']}'은 아직 {assignment['pending_student_count']}명이 미제출 상태입니다. 짧은 복습 카드와 함께 다시 알림을 보내보세요."
            )

    return insights


def build_intervention_recommendations(
    difficult_concepts: list[dict],
    hardest_questions: list[dict],
    assignment_overview: list[dict],
) -> list[dict]:
    recommendations: list[dict] = []

    for concept in difficult_concepts[:2]:
        recommendations.append(
            {
                "title": f"{concept['concept']} 재설명 미니레슨",
                "reason": f"반 전체 막힘 {concept['total_stuck']}회, 해결률 {concept['resolve_rate']}%",
                "actions": [
                    "대표 오개념 예시 2개를 다시 설명합니다.",
                    "교재 근거 페이지를 짚으며 핵심 정의를 다시 읽게 합니다.",
                    "바로 3문항 미니퀴즈를 배포합니다.",
                ],
            }
        )

    if hardest_questions:
        question = hardest_questions[0]
        recommendations.append(
            {
                "title": f"{question['exam_title']} {question['question_order']}번 문항 보강",
                "reason": f"정답률 {question['accuracy_rate']}%, 오답 {question['incorrect_count']}건",
                "actions": [
                    "교사가 해당 문항의 근거 페이지를 다시 보여줍니다.",
                    "학생들에게 왜 가장 많은 오답 선택지가 틀렸는지 말하게 합니다.",
                    "유사 문항 2개를 추가 숙제로 배포합니다.",
                ],
            }
        )

    for assignment in assignment_overview[:1]:
        if assignment.get("pending_student_count", 0) <= 0:
            continue
        recommendations.append(
            {
                "title": f"{assignment['title']} 미제출 학생 케어",
                "reason": f"미제출 {assignment['pending_student_count']}명",
                "actions": [
                    "학생별 미제출 목록을 확인하고 개별 리마인드를 보냅니다.",
                    "숙제 분량을 5분 단위 재도전 과제로 쪼갭니다.",
                    "다음 수업 시작 전에 1문항 워밍업으로 연결합니다.",
                ],
            }
        )

    return recommendations


def summarize_class_conversations_llm(conversation_examples: list[dict]) -> dict:
    """Gemini로 대화 원문을 분석해 공통 오개념/질문 패턴/보강 제안을 추출합니다. 실패 시 빈 결과 반환."""
    empty: dict = {
        "executive_summary": "",
        "misconceptions": [],
        "question_patterns": [],
        "teaching_suggestions": [],
        "teacher_talk_track": [],
    }
    if not conversation_examples:
        return empty

    transcript_parts: list[str] = []
    for index, conv in enumerate(conversation_examples, 1):
        concept = conv.get("concept") or "미분류"
        student = conv.get("student_name") or "학생"
        course_title = conv.get("course_title") or "수업"
        focus_question = conv.get("focus_question") or "질문 정보 없음"
        messages = conv.get("messages") or []
        if not messages:
            continue
        dialogue = "\n".join(
            f"  {'학생' if m.get('role') == 'user' else '튜터'}: {str(m.get('content') or '')[:300]}"
            for m in messages
        )
        transcript_parts.append(
            f"[대화 {index} — {course_title} / {concept} / {student}]\n"
            f"핵심 질문: {focus_question}\n{dialogue}"
        )

    if not transcript_parts:
        return empty

    transcript_text = "\n\n".join(transcript_parts)
    cache_key = hashlib.sha256(
        f"{settings.ai_provider}:{settings.openrouter_model if settings.ai_provider == 'openrouter' else settings.gemini_model}\n{transcript_text}".encode("utf-8")
    ).hexdigest()
    cached = LLM_ANALYSIS_CACHE.get(cache_key)
    if cached:
        cached_at, cached_payload = cached
        if (datetime.utcnow() - cached_at).total_seconds() < LLM_ANALYSIS_CACHE_TTL_SECONDS:
            return cached_payload

    prompt = f"""
너는 교사를 돕는 학습 분석 전문가다.
아래는 학생들과 AI 튜터 사이의 실제 대화 기록이다.
이 대화들을 분석해서 교사가 수업 보강에 바로 활용할 수 있는 인사이트를 추출하라.

반드시 JSON 객체 하나만 반환하라.
형식:
{{
  "executive_summary": "교사가 지금 가장 먼저 알아야 할 상황 요약 2~3문장",
  "misconceptions": [
    {{"concept": "개념명", "pattern": "학생들이 자주 틀리는 오개념 패턴 한 줄 설명", "evidence": "대화에서 드러난 짧은 근거"}}
  ],
  "question_patterns": [
    {{"type": "질문 유형", "example": "실제 질문 예시나 패턴 한 줄", "teacher_move": "교사가 취하면 좋은 대응 한 줄"}}
  ],
  "teaching_suggestions": [
    "교사가 다음 수업에서 바로 말할 수 있는 구체적 보강 문장"
  ],
  "teacher_talk_track": [
    "교사가 실제 수업에서 바로 읽어도 되는 1~2문장 분량의 말하기 스크립트"
  ]
}}

제약:
- executive_summary는 최대 1개
- misconceptions는 최대 3개
- question_patterns는 최대 3개
- teaching_suggestions는 최대 3개
- teacher_talk_track은 최대 3개
- 대화에서 직접 근거를 찾아 작성할 것, 지어내지 말 것
- 학생 이름은 반복하지 말고 개념/질문 방식 중심으로 요약할 것

대화 기록:
{transcript_text}
""".strip()

    try:
        raw = generate_json(prompt, temperature=0.2)
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?", "", raw).strip()
            raw = re.sub(r"```$", "", raw).strip()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            return empty
        normalized = {
            "executive_summary": str(payload.get("executive_summary") or "").strip(),
            "misconceptions": payload.get("misconceptions") or [],
            "question_patterns": payload.get("question_patterns") or [],
            "teaching_suggestions": payload.get("teaching_suggestions") or [],
            "teacher_talk_track": payload.get("teacher_talk_track") or [],
        }
        LLM_ANALYSIS_CACHE[cache_key] = (datetime.utcnow(), normalized)
        return normalized
    except Exception:
        return empty


def build_assignment_overview(course_id: str, exam_summaries: list[dict]) -> list[dict]:
    published_exams = [exam for exam in exam_summaries if exam.get("workflow_status", "published") == "published"]
    overview: list[dict] = []
    for exam in published_exams:
        progress = get_exam_progress(exam["id"])
        if not progress:
            continue
        overview.append(
            {
                "id": exam["id"],
                "title": exam["title"],
                "assignment_type": exam.get("assignment_type", "exam"),
                "due_at": exam.get("due_at"),
                "pending_student_count": progress.get("pending_students", 0),
                "submitted_student_count": progress.get("submitted_students", 0),
                "total_students": progress.get("total_students", 0),
                "missing_students": progress.get("missing_students", []),
                "is_overdue": progress.get("is_overdue", False),
            }
        )

    overview.sort(key=lambda item: (-item["pending_student_count"], item["title"]))
    return overview[:5]


def get_class_dashboard_overview(course_id: str) -> dict:
    concept_rows = safe_rows(
        lambda: supabase.table("concept_stats")
        .select("*")
        .eq("course_id", course_id)
    )
    class_stats = enrich_class_stats(concept_rows)
    difficult_concepts = sorted(class_stats, key=lambda row: (-row["total_stuck"], row["resolve_rate"]))[:4]
    strong_concepts = sorted(
        [row for row in class_stats if row["total_resolved"] > 0],
        key=lambda row: (-row["resolve_rate"], -row["total_resolved"], row["total_stuck"])
    )[:4]

    exam_overview = get_course_exam_overview(course_id)
    assignment_overview = build_assignment_overview(course_id, exam_overview.get("exam_summaries", []))
    conversation_examples = get_conversation_examples(
        course_id,
        [row["concept"] for row in difficult_concepts],
    )

    summary = {
        "concept_count": len(class_stats),
        "total_stuck": sum(row["total_stuck"] for row in class_stats),
        "resolved_concepts": len([row for row in class_stats if row["total_resolved"] > 0]),
        "strong_concepts": len(strong_concepts),
        "average_exam_score": exam_overview.get("average_score"),
        "exam_count": exam_overview.get("exam_count", 0),
        "pending_assignments": sum(item["pending_student_count"] for item in assignment_overview),
    }

    conversation_analysis = summarize_class_conversations_llm(conversation_examples)

    return {
        "summary": summary,
        "concepts": class_stats,
        "difficult_concepts": difficult_concepts,
        "strong_concepts": strong_concepts,
        "conversation_examples": conversation_examples,
        "conversation_analysis": conversation_analysis,
        "exam_overview": exam_overview,
        "assignment_overview": assignment_overview,
        "teaching_insights": build_teacher_insights(
            difficult_concepts,
            strong_concepts,
            exam_overview.get("hardest_questions", []),
            assignment_overview,
        ),
        "intervention_recommendations": build_intervention_recommendations(
            difficult_concepts,
            exam_overview.get("hardest_questions", []),
            assignment_overview,
        ),
    }


def get_teacher_dashboard_briefing(teacher_id: str) -> dict:
    courses = safe_rows(
        lambda: supabase.table("courses")
        .select("id, title, subject_name, class_label, grade_level, created_at")
        .eq("teacher_id", teacher_id)
        .order("created_at", desc=False)
    )
    empty = {
        "summary": {
            "course_count": 0,
            "concept_count": 0,
            "total_stuck": 0,
            "average_exam_score": None,
            "pending_assignments": 0,
            "conversation_count": 0,
        },
        "course_snapshots": [],
        "top_difficult_concepts": [],
        "hardest_questions": [],
        "conversation_examples": [],
        "llm_briefing": {
            "executive_summary": "",
            "misconceptions": [],
            "question_patterns": [],
            "teaching_suggestions": [],
            "teacher_talk_track": [],
        },
        "intervention_recommendations": [],
    }
    if not courses:
        return empty

    course_ids = [course["id"] for course in courses]
    concept_rows = (
        safe_rows(
            lambda: supabase.table("concept_stats")
            .select("*")
            .in_("course_id", course_ids)
        )
        if course_ids
        else []
    )
    concept_rows_by_course: dict[str, list[dict]] = defaultdict(list)
    for row in concept_rows:
        course_id = row.get("course_id")
        if course_id:
            concept_rows_by_course[course_id].append(row)

    course_snapshots: list[dict] = []
    top_difficult_concepts: list[dict] = []
    hardest_questions: list[dict] = []
    conversation_examples: list[dict] = []
    intervention_recommendations: list[dict] = []
    average_scores: list[float] = []
    pending_assignments = 0

    for course in courses:
        course_id = course["id"]
        course_stats = enrich_class_stats(concept_rows_by_course.get(course_id, []))
        difficult_concepts = sorted(
            course_stats,
            key=lambda row: (-row["total_stuck"], row["resolve_rate"], row["concept"]),
        )[:3]
        strong_concepts = sorted(
            [row for row in course_stats if row["total_resolved"] > 0],
            key=lambda row: (-row["resolve_rate"], -row["total_resolved"], row["concept"]),
        )[:2]

        exam_overview = get_course_exam_overview(course_id)
        assignment_overview = build_assignment_overview(course_id, exam_overview.get("exam_summaries", []))
        pending_assignments += sum(item["pending_student_count"] for item in assignment_overview)

        if isinstance(exam_overview.get("average_score"), (int, float)):
            average_scores.append(float(exam_overview["average_score"]))

        for concept in difficult_concepts:
            top_difficult_concepts.append(
                {
                    **concept,
                    "course_id": course_id,
                    "course_title": course["title"],
                    "subject_name": course.get("subject_name"),
                    "class_label": course.get("class_label"),
                }
            )

        for question in exam_overview.get("hardest_questions", [])[:2]:
            hardest_questions.append(
                {
                    **question,
                    "course_id": course_id,
                    "course_title": course["title"],
                    "subject_name": course.get("subject_name"),
                }
            )

        examples = get_conversation_examples(course_id, [row["concept"] for row in difficult_concepts])[:2]
        for example in examples:
            conversation_examples.append(
                {
                    **example,
                    "course_id": course_id,
                    "course_title": course["title"],
                    "subject_name": course.get("subject_name"),
                    "class_label": course.get("class_label"),
                }
            )

        for recommendation in build_intervention_recommendations(
            difficult_concepts,
            exam_overview.get("hardest_questions", []),
            assignment_overview,
        )[:2]:
            intervention_recommendations.append(
                {
                    **recommendation,
                    "course_id": course_id,
                    "course_title": course["title"],
                    "subject_name": course.get("subject_name"),
                }
            )

        course_snapshots.append(
            {
                "course_id": course_id,
                "course_title": course["title"],
                "subject_name": course.get("subject_name"),
                "class_label": course.get("class_label"),
                "grade_level": course.get("grade_level"),
                "average_exam_score": exam_overview.get("average_score"),
                "pending_assignments": sum(item["pending_student_count"] for item in assignment_overview),
                "conversation_count": len(examples),
                "top_concept": difficult_concepts[0]["concept"] if difficult_concepts else None,
                "top_concept_stuck": difficult_concepts[0]["total_stuck"] if difficult_concepts else 0,
                "strong_concept": strong_concepts[0]["concept"] if strong_concepts else None,
                "lowest_accuracy_question": (
                    exam_overview.get("hardest_questions", [{}])[0].get("accuracy_rate")
                    if exam_overview.get("hardest_questions")
                    else None
                ),
            }
        )

    top_difficult_concepts.sort(
        key=lambda row: (-row["total_stuck"], row["resolve_rate"], row["course_title"])
    )
    hardest_questions.sort(
        key=lambda row: (
            row.get("accuracy_rate", 101),
            -row.get("incorrect_count", 0),
            row.get("course_title", ""),
        )
    )
    conversation_examples.sort(
        key=lambda row: (
            0 if row.get("source_type") == "exam_review" else 1,
            row.get("course_title", ""),
            row.get("started_at") or "",
        )
    )
    course_snapshots.sort(
        key=lambda row: (
            -(row.get("top_concept_stuck") or 0),
            row.get("average_exam_score") if row.get("average_exam_score") is not None else 999,
            row.get("course_title", ""),
        )
    )
    intervention_recommendations.sort(
        key=lambda row: (
            0 if "미니레슨" in row.get("title", "") else 1,
            row.get("course_title", ""),
            row.get("title", ""),
        )
    )

    llm_briefing = summarize_class_conversations_llm(conversation_examples[:8])

    return {
        "summary": {
            "course_count": len(courses),
            "concept_count": len(
                {
                    f"{row.get('course_id')}::{row.get('concept')}"
                    for row in concept_rows
                    if row.get("course_id") and row.get("concept")
                }
            ),
            "total_stuck": sum(int(row.get("stuck_count", 0) or 0) for row in concept_rows),
            "average_exam_score": round(sum(average_scores) / len(average_scores), 1) if average_scores else None,
            "pending_assignments": pending_assignments,
            "conversation_count": len(conversation_examples),
        },
        "course_snapshots": course_snapshots[:6],
        "top_difficult_concepts": top_difficult_concepts[:6],
        "hardest_questions": hardest_questions[:6],
        "conversation_examples": conversation_examples[:6],
        "llm_briefing": llm_briefing,
        "intervention_recommendations": intervention_recommendations[:6],
    }


def get_student_learning_overview(student_id: str, course_id: str) -> dict:
    stats = get_student_concept_stats(student_id, course_id)
    enriched_stats: list[dict] = []
    for row in stats:
        total_events = row.get("stuck_count", 0) + row.get("resolved_count", 0)
        understanding_score = round((row.get("resolved_count", 0) / total_events) * 100, 1) if total_events else 0.0
        enriched_stats.append(
            {
                **row,
                "understanding_score": understanding_score,
            }
        )

    strengths = sorted(
        [row for row in enriched_stats if row.get("resolved_count", 0) > 0],
        key=lambda row: (-row["understanding_score"], -row.get("resolved_count", 0))
    )[:3]
    weaknesses = sorted(
        [row for row in enriched_stats if row.get("stuck_count", 0) > 0],
        key=lambda row: (-row.get("stuck_count", 0), row["understanding_score"])
    )[:3]

    exam_overview = get_student_exam_overview(course_id, student_id)

    return {
        "summary": {
            "concept_count": len(enriched_stats),
            "strong_concepts": len(strengths),
            "needs_support": len(weaknesses),
            "completed_exams": len([exam for exam in exam_overview["exams"] if exam.get("latest_attempt")]),
        },
        "concepts": enriched_stats,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "exam_overview": exam_overview,
    }
