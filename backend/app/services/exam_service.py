from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.textbook_catalog_service import list_chunk_previews
from app.services.textbook_exam_service import (
    create_exam_notifications_for_published_exam,
    normalize_due_at,
    normalize_publish_at,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)


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


def safe_single(builder) -> dict | None:
    rows = safe_rows(builder)
    return rows[0] if rows else None


def mark_notification_ids_read(notification_ids: list[str]) -> int:
    clean_ids = [notification_id for notification_id in notification_ids if notification_id]
    if not clean_ids:
        return 0
    try:
        supabase.table("notifications").update({"status": "read"}).in_("id", clean_ids).eq("status", "pending").execute()
    except APIError as error:
        if get_api_error_code(error) == "PGRST205":
            return 0
        raise
    return len(clean_ids)


def build_tutor_prompt(exam: dict, question: dict, selected_choice: str | None) -> str:
    choice_text = selected_choice or "선택하지 않음"
    section_title = question.get("source_section_title") or exam.get("section_title")
    learning_objective = exam.get("learning_objective")
    context_parts = [part for part in [section_title, learning_objective] if part]
    context_suffix = f" 학습 맥락: {' / '.join(context_parts)}." if context_parts else ""
    return (
        f"{exam['title']}의 {question['question_order']}번 문제에서 '{choice_text}'를 골랐어요. "
        f"정답을 바로 말하지 말고, {question['concept_tag']} 개념을 스스로 떠올리게 질문으로 도와줘. "
        f"문제: {question['prompt']}.{context_suffix}"
    )


def parse_timestamp(raw_value: str | None) -> datetime | None:
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
    except ValueError:
        return None


def current_timestamp() -> datetime:
    return datetime.now(timezone.utc)


def is_exam_scheduled(exam: dict) -> bool:
    return exam.get("workflow_status") == "scheduled"


def is_exam_published(exam: dict) -> bool:
    return exam.get("workflow_status", "published") == "published"


def activate_scheduled_exam(exam: dict[str, Any]) -> dict[str, Any]:
    if not is_exam_scheduled(exam):
        return {
            "exam": exam,
            "notifications_created": 0,
            "activated": False,
        }

    publish_at = parse_timestamp(exam.get("published_at"))
    if not publish_at or publish_at > current_timestamp():
        return {
            "exam": exam,
            "notifications_created": 0,
            "activated": False,
        }

    supabase.table("exams").update({"workflow_status": "published"}).eq("id", exam["id"]).execute()
    published_exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam["id"])) or {
        **exam,
        "workflow_status": "published",
    }
    notifications_created = create_exam_notifications_for_published_exam(published_exam)
    return {
        "exam": published_exam,
        "notifications_created": notifications_created,
        "activated": True,
    }


def sync_scheduled_exams(course_id: str) -> int:
    scheduled_exams = safe_rows(
        lambda: supabase.table("exams")
        .select("*")
        .eq("course_id", course_id)
        .eq("workflow_status", "scheduled")
    )
    activated_count = 0
    for exam in scheduled_exams:
        result = activate_scheduled_exam(exam)
        if result.get("activated"):
            activated_count += 1
    return activated_count


def build_textbook_page_urls(textbook_slug: str | None, source_pages: list[int] | None) -> list[str]:
    if not textbook_slug:
        return []
    if not source_pages:
        return []
    return [f"/api/exams/textbooks/{textbook_slug}/pages/{int(page)}" for page in source_pages]


def build_source_reference(exam: dict, question: dict) -> str | None:
    textbook_title = exam.get("textbook_title")
    section_title = question.get("source_section_title") or exam.get("section_title")
    source_pages = question.get("source_pages") or []
    if not textbook_title and not section_title and not source_pages:
        return None

    parts = [part for part in [textbook_title, section_title] if part]
    if source_pages:
        if len(source_pages) == 1:
            parts.append(f"{source_pages[0]}p")
        else:
            ordered = sorted(int(page) for page in source_pages)
            parts.append(f"{ordered[0]}-{ordered[-1]}p")
    return " / ".join(parts)


def can_student_view_solution(answer: dict | None) -> bool:
    if not answer:
        return False
    return bool(answer.get("is_correct") or answer.get("resolved_via_tutor"))


def get_course_roster(course_id: str) -> tuple[list[dict], dict[str, dict]]:
    enrollments = safe_rows(
        lambda: supabase.table("enrollments")
        .select("student_id")
        .eq("course_id", course_id)
    )
    student_ids = [row["student_id"] for row in enrollments]
    profiles = (
        safe_rows(
            lambda: supabase.table("profiles")
            .select("id, full_name, email")
            .in_("id", student_ids)
        )
        if student_ids
        else []
    )
    profile_by_id = {profile["id"]: profile for profile in profiles}
    return enrollments, profile_by_id


def sync_overdue_notifications(course_id: str) -> int:
    sync_scheduled_exams(course_id)
    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("id, course_id, title, due_at, workflow_status")
        .eq("course_id", course_id)
    )
    published_exams = [exam for exam in exams if is_exam_published(exam)]
    if not published_exams:
        return 0

    enrollments, _profiles = get_course_roster(course_id)
    if not enrollments:
        return 0

    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("exam_id, student_id")
        .eq("course_id", course_id)
        .in_("exam_id", [exam["id"] for exam in published_exams])
    )
    attempted_keys = {(attempt["exam_id"], attempt["student_id"]) for attempt in attempts}
    try:
        existing_rows = safe_rows(
            lambda: supabase.table("notifications")
            .select("exam_id, student_id, notification_type")
            .eq("course_id", course_id)
        )
    except APIError as error:
        if get_api_error_code(error) == "PGRST205":
            return 0
        raise
    existing_keys = {
        (row["exam_id"], row["student_id"], row["notification_type"])
        for row in existing_rows
    }

    now = current_timestamp()
    rows = []
    for exam in published_exams:
        due_at = parse_timestamp(exam.get("due_at"))
        if not due_at or due_at > now:
            continue
        for enrollment in enrollments:
            student_id = enrollment["student_id"]
            if (exam["id"], student_id) in attempted_keys:
                continue
            key = (exam["id"], student_id, "assignment_overdue")
            if key in existing_keys:
                continue
            rows.append(
                {
                    "course_id": course_id,
                    "student_id": student_id,
                    "exam_id": exam["id"],
                    "notification_type": "assignment_overdue",
                    "message": f"'{exam['title']}' 과제가 아직 제출되지 않았습니다. 지금 바로 풀어보세요.",
                }
            )

    if rows:
        try:
            supabase.table("notifications").insert(rows).execute()
        except APIError as error:
            if get_api_error_code(error) in {"PGRST205", "23505"}:
                return 0
            raise
    return len(rows)


def reconcile_course_notifications(course_id: str) -> dict[str, int]:
    activated_now = sync_scheduled_exams(course_id)
    overdue_created_now = sync_overdue_notifications(course_id)

    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("id, course_id, title, due_at, published_at, workflow_status, assignment_type")
        .eq("course_id", course_id)
    )
    if not exams:
        return {
            "activated_now": activated_now,
            "overdue_created_now": overdue_created_now,
            "cleared_now": 0,
            "pending_notifications": 0,
            "assigned_notifications": 0,
            "overdue_notifications": 0,
        }

    exam_ids = [exam["id"] for exam in exams]
    exam_by_id = {exam["id"]: exam for exam in exams}
    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("exam_id, student_id")
        .eq("course_id", course_id)
        .in_("exam_id", exam_ids)
    )
    attempted_keys = {(attempt["exam_id"], attempt["student_id"]) for attempt in attempts}

    notification_rows = safe_rows(
        lambda: supabase.table("notifications")
        .select("id, exam_id, student_id, notification_type, status")
        .eq("course_id", course_id)
    )

    now = current_timestamp()
    notification_ids_to_read: list[str] = []
    for row in notification_rows:
        if row.get("status") != "pending":
            continue
        exam = exam_by_id.get(row.get("exam_id"))
        if not exam:
            notification_ids_to_read.append(row["id"])
            continue

        if not is_exam_published(exam):
            notification_ids_to_read.append(row["id"])
            continue

        if (row.get("exam_id"), row.get("student_id")) in attempted_keys:
            notification_ids_to_read.append(row["id"])
            continue

        if row.get("notification_type") == "assignment_assigned":
            due_at = parse_timestamp(exam.get("due_at"))
            if due_at and due_at <= now:
                notification_ids_to_read.append(row["id"])

    cleared_now = mark_notification_ids_read(notification_ids_to_read)

    pending_rows = safe_rows(
        lambda: supabase.table("notifications")
        .select("notification_type")
        .eq("course_id", course_id)
        .eq("status", "pending")
    )
    return {
        "activated_now": activated_now,
        "overdue_created_now": overdue_created_now,
        "cleared_now": cleared_now,
        "pending_notifications": len(pending_rows),
        "assigned_notifications": len(
            [row for row in pending_rows if row.get("notification_type") == "assignment_assigned"]
        ),
        "overdue_notifications": len(
            [row for row in pending_rows if row.get("notification_type") == "assignment_overdue"]
        ),
    }


def get_course_schedule_status(course_id: str) -> dict[str, Any]:
    notification_state = reconcile_course_notifications(course_id)
    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("id, title, workflow_status, published_at, due_at, assignment_type")
        .eq("course_id", course_id)
        .order("exam_date", desc=True)
    )
    if not exams:
        return {
            **notification_state,
            "total_exams": 0,
            "draft_exams": 0,
            "reviewed_exams": 0,
            "scheduled_exams": 0,
            "published_exams": 0,
            "overdue_exams": 0,
            "active_exams": 0,
            "upcoming_schedule": [],
            "overdue_queue": [],
            "last_reconciled_at": current_timestamp().isoformat(),
        }

    now = current_timestamp()
    scheduled_rows: list[dict[str, Any]] = []
    overdue_rows: list[dict[str, Any]] = []
    workflow_counts = Counter(exam.get("workflow_status") or "published" for exam in exams)
    active_exams = 0

    for exam in exams:
        due_at = parse_timestamp(exam.get("due_at"))
        schedule_entry = {
            "id": exam["id"],
            "title": exam.get("title") or "시험",
            "workflow_status": exam.get("workflow_status") or "published",
            "assignment_type": exam.get("assignment_type") or "homework",
            "published_at": exam.get("published_at"),
            "due_at": exam.get("due_at"),
        }
        if is_exam_scheduled(exam):
            scheduled_rows.append(schedule_entry)
            continue
        if is_exam_published(exam):
            if due_at and due_at < now:
                overdue_rows.append(schedule_entry)
            else:
                active_exams += 1

    scheduled_rows.sort(key=lambda row: parse_timestamp(row.get("published_at")) or datetime.max.replace(tzinfo=timezone.utc))
    overdue_rows.sort(key=lambda row: parse_timestamp(row.get("due_at")) or datetime.max.replace(tzinfo=timezone.utc))

    return {
        **notification_state,
        "total_exams": len(exams),
        "draft_exams": workflow_counts.get("draft", 0),
        "reviewed_exams": workflow_counts.get("reviewed", 0),
        "scheduled_exams": len(scheduled_rows),
        "published_exams": workflow_counts.get("published", 0),
        "overdue_exams": len(overdue_rows),
        "active_exams": active_exams,
        "upcoming_schedule": scheduled_rows[:5],
        "overdue_queue": overdue_rows[:5],
        "last_reconciled_at": now.isoformat(),
    }


def get_exam_progress(exam_id: str) -> dict | None:
    exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    if not exam:
        return None
    activation = activate_scheduled_exam(exam)
    exam = activation["exam"]

    enrollments, profile_by_id = get_course_roster(exam["course_id"])
    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("*")
        .eq("exam_id", exam_id)
        .order("submitted_at", desc=True)
    )

    latest_attempt_by_student: dict[str, dict] = {}
    for attempt in attempts:
        latest_attempt_by_student.setdefault(attempt["student_id"], attempt)

    roster: list[dict[str, Any]] = []
    for enrollment in enrollments:
        student_id = enrollment["student_id"]
        profile = profile_by_id.get(student_id, {})
        attempt = latest_attempt_by_student.get(student_id)
        roster.append(
            {
                "student_id": student_id,
                "student_name": profile.get("full_name") or profile.get("email") or "학생",
                "submitted": bool(attempt),
                "submitted_at": attempt.get("submitted_at") if attempt else None,
                "score": attempt.get("score") if attempt else None,
                "max_score": attempt.get("max_score") if attempt else None,
            }
        )

    due_at = parse_timestamp(exam.get("due_at"))
    now = current_timestamp()
    submitted_count = len([item for item in roster if item["submitted"]])
    pending_roster = [item for item in roster if not item["submitted"]]

    return {
        "exam_id": exam_id,
        "total_students": len(roster),
        "submitted_students": submitted_count,
        "pending_students": len(pending_roster),
        "is_overdue": bool(due_at and due_at < now),
        "roster": roster,
        "missing_students": pending_roster,
    }


def list_student_notifications(student_id: str, course_id: str) -> list[dict]:
    reconcile_course_notifications(course_id)
    rows = safe_rows(
        lambda: supabase.table("notifications")
        .select("*")
        .eq("course_id", course_id)
        .eq("student_id", student_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
    )
    if not rows:
        return []

    exam_ids = [str(row["exam_id"]) for row in rows if row.get("exam_id")]
    exams = (
        safe_rows(
            lambda: supabase.table("exams")
            .select("id, title, due_at, published_at, assignment_type, workflow_status, course_id")
            .in_("id", exam_ids)
        )
        if exam_ids
        else []
    )
    # archived 시험 알림은 제외
    exam_by_id = {row["id"]: row for row in exams if row.get("workflow_status") != "archived"}

    # course → teacher 이름 조회
    course_ids = list({str(ex["course_id"]) for ex in exam_by_id.values() if ex.get("course_id")})
    teacher_name_by_course: dict[str, str] = {}
    if course_ids:
        courses_rows = safe_rows(
            lambda: supabase.table("courses")
            .select("id, teacher_id")
            .in_("id", course_ids)
        )
        teacher_ids = list({c["teacher_id"] for c in courses_rows if c.get("teacher_id")})
        if teacher_ids:
            profiles_rows = safe_rows(
                lambda: supabase.table("profiles")
                .select("id, full_name")
                .in_("id", teacher_ids)
            )
            profile_by_id = {p["id"]: p["full_name"] for p in profiles_rows}
            for c in courses_rows:
                teacher_name_by_course[c["id"]] = profile_by_id.get(c["teacher_id"], "")

    now = current_timestamp()

    enriched_rows: list[dict[str, Any]] = []
    for row in rows[:10]:
        exam = exam_by_id.get(str(row.get("exam_id")))
        if not exam:
            continue  # archived 또는 없는 시험 알림 제외
        due_at = parse_timestamp(exam.get("due_at"))
        exam_course_id = str(exam.get("course_id", ""))
        enriched_rows.append(
            {
                **row,
                "exam_title": exam.get("title"),
                "due_at": exam.get("due_at"),
                "published_at": exam.get("published_at"),
                "assignment_type": exam.get("assignment_type"),
                "workflow_status": exam.get("workflow_status"),
                "is_overdue": bool(due_at and due_at < now),
                "teacher_name": teacher_name_by_course.get(exam_course_id, ""),
            }
        )
    return enriched_rows


def mark_exam_notifications_read(student_id: str, exam_id: str) -> None:
    try:
        supabase.table("notifications").update({"status": "read"}).eq("student_id", student_id).eq("exam_id", exam_id).eq("status", "pending").execute()
    except APIError as error:
        if get_api_error_code(error) == "PGRST205":
            return
        raise


def publish_exam(
    exam_id: str,
    *,
    publish_at: str | None = None,
    due_at: str | None = None,
    assignment_type: str | None = None,
    assignment_note: str | None = None,
) -> dict | None:
    exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    if not exam:
        return None

    normalized_publish_at = normalize_publish_at(publish_at)
    publish_timestamp = parse_timestamp(normalized_publish_at)
    should_schedule = bool(publish_timestamp and publish_timestamp > current_timestamp())

    update_payload: dict[str, Any] = {
        "workflow_status": "scheduled" if should_schedule else "published",
        "published_at": normalized_publish_at or current_timestamp().isoformat(),
    }
    if due_at is not None:
        update_payload["due_at"] = normalize_due_at(due_at)
    if assignment_type in {"exam", "homework"}:
        update_payload["assignment_type"] = assignment_type
    if assignment_note is not None:
        update_payload["assignment_note"] = assignment_note

    supabase.table("exams").update(update_payload).eq("id", exam_id).execute()
    published_exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    if not published_exam:
        return None

    notifications_created = 0
    if published_exam.get("workflow_status") == "published":
        notifications_created = create_exam_notifications_for_published_exam(published_exam)
    return {
        "exam": published_exam,
        "notifications_created": notifications_created,
        "scheduled": published_exam.get("workflow_status") == "scheduled",
        "progress": get_exam_progress(exam_id),
    }


def list_student_exams(course_id: str, student_id: str) -> list[dict]:
    reconcile_course_notifications(course_id)
    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("*")
        .eq("course_id", course_id)
        .order("exam_date", desc=True)
    )
    published_exams = [exam for exam in exams if is_exam_published(exam)]
    if not published_exams:
        return []

    exam_ids = [exam["id"] for exam in published_exams]
    questions = safe_rows(
        lambda: supabase.table("exam_questions")
        .select("*")
        .in_("exam_id", exam_ids)
        .order("question_order")
    )
    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("*")
        .eq("course_id", course_id)
        .eq("student_id", student_id)
        .in_("exam_id", exam_ids)
        .order("submitted_at", desc=True)
    )

    latest_attempt_by_exam: dict[str, dict] = {}
    for attempt in attempts:
        latest_attempt_by_exam.setdefault(attempt["exam_id"], attempt)

    answer_ids = [attempt["id"] for attempt in latest_attempt_by_exam.values()]
    answers = (
        safe_rows(
            lambda: supabase.table("exam_answers")
            .select("*")
            .in_("attempt_id", answer_ids)
        )
        if answer_ids
        else []
    )

    question_count_by_exam: dict[str, int] = defaultdict(int)
    for question in questions:
        question_count_by_exam[question["exam_id"]] += 1

    wrong_count_by_attempt: dict[str, int] = Counter()
    for answer in answers:
        if not answer.get("is_correct"):
            wrong_count_by_attempt[answer["attempt_id"]] += 1

    result: list[dict] = []
    for exam in published_exams:
        latest_attempt = latest_attempt_by_exam.get(exam["id"])
        latest_attempt_payload = None
        if latest_attempt:
            latest_attempt_payload = {
                "id": latest_attempt["id"],
                "score": latest_attempt["score"],
                "max_score": latest_attempt["max_score"],
                "submitted_at": latest_attempt["submitted_at"],
                "attempt_number": latest_attempt["attempt_number"],
                "wrong_count": wrong_count_by_attempt.get(latest_attempt["id"], 0),
            }

        due_at = parse_timestamp(exam.get("due_at"))
        is_overdue = bool(due_at and due_at < current_timestamp() and not latest_attempt)
        result.append(
            {
                **exam,
                "question_count": question_count_by_exam.get(exam["id"], 0),
                "latest_attempt": latest_attempt_payload,
                "is_overdue": is_overdue,
            }
        )

    return result


def list_course_exams(course_id: str) -> list[dict]:
    reconcile_course_notifications(course_id)
    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("*")
        .eq("course_id", course_id)
        .order("exam_date", desc=True)
    )
    if not exams:
        return []

    exam_ids = [exam["id"] for exam in exams]
    questions = safe_rows(
        lambda: supabase.table("exam_questions")
        .select("*")
        .in_("exam_id", exam_ids)
        .order("question_order")
    )
    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("*")
        .eq("course_id", course_id)
        .in_("exam_id", exam_ids)
        .order("submitted_at", desc=True)
    )
    attempt_ids = [attempt["id"] for attempt in attempts]
    answers = (
        safe_rows(
            lambda: supabase.table("exam_answers")
            .select("*")
            .in_("attempt_id", attempt_ids)
        )
        if attempt_ids
        else []
    )

    enrollments, profile_by_id = get_course_roster(course_id)
    enrolled_student_ids = {row["student_id"] for row in enrollments}

    questions_by_exam: dict[str, int] = defaultdict(int)
    attempts_by_exam: dict[str, list[dict]] = defaultdict(list)
    resolved_by_exam: dict[str, int] = defaultdict(int)
    attempt_by_id = {attempt["id"]: attempt for attempt in attempts}

    for question in questions:
        questions_by_exam[question["exam_id"]] += 1

    for attempt in attempts:
        attempts_by_exam[attempt["exam_id"]].append(attempt)

    for answer in answers:
        if answer.get("resolved_via_tutor"):
            attempt = attempt_by_id.get(answer["attempt_id"])
            if attempt:
                resolved_by_exam[attempt["exam_id"]] += 1

    course_exam_rows: list[dict] = []
    for exam in exams:
        exam_attempts = attempts_by_exam.get(exam["id"], [])
        latest_by_student: dict[str, dict] = {}
        for attempt in exam_attempts:
            latest_by_student.setdefault(attempt["student_id"], attempt)
        average_score = None
        if exam_attempts:
            average_score = round(
                sum(attempt["score"] for attempt in exam_attempts) / len(exam_attempts),
                1,
            )
        due_at = parse_timestamp(exam.get("due_at"))
        is_scheduled = is_exam_scheduled(exam)
        pending_students = (
            []
            if is_scheduled
            else [student_id for student_id in enrolled_student_ids if student_id not in latest_by_student]
        )
        missing_students = [
            profile_by_id.get(student_id, {}).get("full_name")
            or profile_by_id.get(student_id, {}).get("email")
            or "학생"
            for student_id in pending_students[:6]
        ]

        course_exam_rows.append(
            {
                **exam,
                "question_count": questions_by_exam.get(exam["id"], 0),
                "attempt_count": len(exam_attempts),
                "submitted_student_count": len(latest_by_student),
                "total_students": len(enrolled_student_ids),
                "pending_student_count": len(pending_students),
                "missing_students": missing_students,
                "is_overdue": False if is_scheduled else bool(due_at and due_at < current_timestamp()),
                "average_score": average_score,
                "resolved_after_review_count": resolved_by_exam.get(exam["id"], 0),
            }
        )

    return course_exam_rows


def get_exam_detail(
    exam_id: str,
    student_id: str | None = None,
    attempt_id: str | None = None,
    teacher_view: bool = False,
) -> dict | None:
    exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    if not exam:
        return None
    exam = activate_scheduled_exam(exam)["exam"]

    if student_id and not is_exam_published(exam):
        return None

    questions = safe_rows(
        lambda: supabase.table("exam_questions")
        .select("*")
        .eq("exam_id", exam_id)
        .order("question_order")
    )
    all_chunk_ids = [
        str(chunk_id)
        for question in questions
        for chunk_id in (question.get("source_chunk_ids") or [])
        if str(chunk_id).strip()
    ]
    chunk_preview_rows = list_chunk_previews(all_chunk_ids)
    chunk_preview_by_id = {row["id"]: row for row in chunk_preview_rows}

    attempt: dict | None = None
    if attempt_id:
        attempt = safe_single(lambda: supabase.table("exam_attempts").select("*").eq("id", attempt_id))
    elif student_id:
        attempt = safe_single(
            lambda: supabase.table("exam_attempts")
            .select("*")
            .eq("exam_id", exam_id)
            .eq("student_id", student_id)
            .order("submitted_at", desc=True)
            .limit(1)
        )

    answers = (
        safe_rows(
            lambda: supabase.table("exam_answers")
            .select("*")
            .eq("attempt_id", attempt["id"])
        )
        if attempt
        else []
    )
    answer_by_question = {answer["question_id"]: answer for answer in answers}

    detailed_questions: list[dict] = []
    for question in questions:
        answer = answer_by_question.get(question["id"])
        allow_solution = teacher_view or (not student_id) or can_student_view_solution(answer)
        source_pages = question.get("source_pages") or []
        page_asset_urls = build_textbook_page_urls(question.get("source_textbook_slug"), source_pages)
        source_chunk_ids = [str(chunk_id) for chunk_id in (question.get("source_chunk_ids") or []) if str(chunk_id).strip()]
        source_chunk_previews = [chunk_preview_by_id[chunk_id] for chunk_id in source_chunk_ids if chunk_id in chunk_preview_by_id]
        detailed_questions.append(
            {
                **question,
                "answer_id": answer["id"] if answer else None,
                "student_answer": answer["selected_choice"] if answer else None,
                "is_correct": answer["is_correct"] if answer else None,
                "tutor_prompt": answer.get("tutor_prompt") if answer else None,
                "corrected_choice": answer.get("corrected_choice") if answer else None,
                "resolved_via_tutor": answer.get("resolved_via_tutor") if answer else None,
                "review_completed_at": answer.get("review_completed_at") if answer else None,
                "correct_choice": question["correct_choice"] if allow_solution else None,
                "explanation": question.get("explanation") if allow_solution else None,
                "source_pages": source_pages if allow_solution or teacher_view else [],
                "evidence_excerpt": question.get("evidence_excerpt") if allow_solution or teacher_view else None,
                "source_chunk_ids": source_chunk_ids if allow_solution or teacher_view else [],
                "source_chunk_previews": source_chunk_previews if allow_solution or teacher_view else [],
                "page_asset_urls": page_asset_urls if allow_solution or teacher_view else [],
                "source_reference": build_source_reference(exam, question) if allow_solution or teacher_view else None,
                "can_view_solution": allow_solution,
            }
        )

    return {
        "exam": exam,
        "attempt": attempt,
        "questions": detailed_questions,
    }


def submit_exam_attempt(
    exam_id: str,
    student_id: str,
    answers: dict[str, str],
    duration_minutes: int = 0,
) -> dict | None:
    exam = safe_single(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    if exam:
        exam = activate_scheduled_exam(exam)["exam"]
    if not exam or not is_exam_published(exam):
        return None

    questions = safe_rows(
        lambda: supabase.table("exam_questions")
        .select("*")
        .eq("exam_id", exam_id)
        .order("question_order")
    )
    if not questions:
        return None

    existing_attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("id")
        .eq("exam_id", exam_id)
        .eq("student_id", student_id)
    )

    max_score = sum(int(question.get("points", 0)) for question in questions)
    score = 0
    attempt_id = str(uuid4())
    answer_rows: list[dict[str, Any]] = []

    for question in questions:
        selected_choice = answers.get(question["id"])
        is_correct = selected_choice == question["correct_choice"]
        if is_correct:
            score += int(question.get("points", 0))

        answer_rows.append(
            {
                "id": str(uuid4()),
                "attempt_id": attempt_id,
                "question_id": question["id"],
                "concept_tag": question["concept_tag"],
                "selected_choice": selected_choice,
                "is_correct": is_correct,
                "tutor_prompt": None
                if is_correct
                else build_tutor_prompt(exam, question, selected_choice),
            }
        )

    supabase.table("exam_attempts").insert(
        {
            "id": attempt_id,
            "exam_id": exam_id,
            "course_id": exam["course_id"],
            "student_id": student_id,
            "attempt_number": len(existing_attempts) + 1,
            "score": score,
            "max_score": max_score,
            "duration_minutes": duration_minutes,
            "status": "graded",
        }
    ).execute()

    if answer_rows:
        supabase.table("exam_answers").insert(answer_rows).execute()

    mark_exam_notifications_read(student_id, exam_id)

    return get_exam_detail(exam_id, student_id=student_id, attempt_id=attempt_id)


def review_exam_answer(
    answer_id: str,
    student_id: str,
    corrected_choice: str,
) -> dict | None:
    answer = safe_single(lambda: supabase.table("exam_answers").select("*").eq("id", answer_id))
    if not answer:
        return None

    attempt = safe_single(lambda: supabase.table("exam_attempts").select("*").eq("id", answer["attempt_id"]))
    if not attempt or attempt.get("student_id") != student_id:
        return None

    question = safe_single(lambda: supabase.table("exam_questions").select("*").eq("id", answer["question_id"]))
    if not question:
        return None

    normalized_choice = corrected_choice.strip().upper()
    is_resolved = normalized_choice == question["correct_choice"]
    update_payload: dict[str, Any] = {
        "corrected_choice": normalized_choice,
    }

    if is_resolved:
        update_payload["resolved_via_tutor"] = True
        update_payload["review_completed_at"] = datetime.now(timezone.utc).isoformat()

    supabase.table("exam_answers").update(update_payload).eq("id", answer_id).execute()

    if is_resolved and not answer.get("resolved_via_tutor"):
        from app.services.analytics_service import log_resolved_event

        log_resolved_event(
            student_id=student_id,
            course_id=attempt["course_id"],
            concept=question["concept_tag"],
        )

    return get_exam_detail(
        attempt["exam_id"],
        student_id=student_id,
        attempt_id=attempt["id"],
    )


def get_course_exam_overview(course_id: str) -> dict:
    sync_scheduled_exams(course_id)
    exams = safe_rows(
        lambda: supabase.table("exams")
        .select("*")
        .eq("course_id", course_id)
        .order("exam_date", desc=True)
    )
    if not exams:
        return {
            "exam_count": 0,
            "average_score": None,
            "exam_summaries": [],
            "hardest_questions": [],
        }

    exam_ids = [exam["id"] for exam in exams]
    questions = safe_rows(
        lambda: supabase.table("exam_questions")
        .select("*")
        .in_("exam_id", exam_ids)
        .order("question_order")
    )
    attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("*")
        .eq("course_id", course_id)
        .in_("exam_id", exam_ids)
        .order("submitted_at", desc=True)
    )
    attempt_ids = [attempt["id"] for attempt in attempts]
    answers = (
        safe_rows(
            lambda: supabase.table("exam_answers")
            .select("*")
            .in_("attempt_id", attempt_ids)
        )
        if attempt_ids
        else []
    )

    questions_by_exam: dict[str, list[dict]] = defaultdict(list)
    for question in questions:
        questions_by_exam[question["exam_id"]].append(question)

    attempts_by_exam: dict[str, list[dict]] = defaultdict(list)
    for attempt in attempts:
        attempts_by_exam[attempt["exam_id"]].append(attempt)

    answer_by_attempt: dict[str, list[dict]] = defaultdict(list)
    for answer in answers:
        answer_by_attempt[answer["attempt_id"]].append(answer)

    exam_summaries: list[dict] = []
    for exam in exams:
        exam_attempts = attempts_by_exam.get(exam["id"], [])
        # First attempt per student only (attempts ordered desc by submitted_at)
        seen_students: set[str] = set()
        first_attempt_scores: list[float] = []
        for attempt in reversed(exam_attempts):
            sid = attempt["student_id"]
            if sid not in seen_students:
                seen_students.add(sid)
                if attempt.get("score") is not None:
                    first_attempt_scores.append(attempt["score"])
        average_score = None
        if first_attempt_scores:
            average_score = round(sum(first_attempt_scores) / len(first_attempt_scores), 1)

        exam_summaries.append(
            {
                "id": exam["id"],
                "title": exam["title"],
                "exam_date": exam["exam_date"],
                "question_count": len(questions_by_exam.get(exam["id"], [])),
                "attempt_count": len(exam_attempts),
                "average_score": average_score,
                "max_score": exam.get("total_points"),
                "source_name": exam.get("source_name"),
                "source_format": exam.get("source_format"),
                "workflow_status": exam.get("workflow_status", "published"),
                "assignment_type": exam.get("assignment_type", "exam"),
                "due_at": exam.get("due_at"),
                "pending_student_count": get_exam_progress(exam["id"]).get("pending_students", 0) if exam.get("course_id") else 0,
                "resolved_after_review_count": sum(
                    1
                    for attempt in exam_attempts
                    for answer in answer_by_attempt.get(attempt["id"], [])
                    if answer.get("resolved_via_tutor")
                ),
            }
        )

    exam_title_by_id = {exam["id"]: exam["title"] for exam in exams}
    question_by_id = {question["id"]: question for question in questions}
    hardest_questions: list[dict] = []

    answers_by_question: dict[str, list[dict]] = defaultdict(list)
    for answer in answers:
        answers_by_question[answer["question_id"]].append(answer)

    for question in questions:
        question_answers = answers_by_question.get(question["id"], [])
        if not question_answers:
            continue

        attempted_count = len(question_answers)
        incorrect_answers = [answer for answer in question_answers if not answer.get("is_correct")]
        incorrect_count = len(incorrect_answers)
        accuracy_rate = round(((attempted_count - incorrect_count) / attempted_count) * 100, 1)
        wrong_choice_counts = Counter(
            answer["selected_choice"]
            for answer in incorrect_answers
            if answer.get("selected_choice")
        )
        common_wrong_choice = wrong_choice_counts.most_common(1)[0][0] if wrong_choice_counts else None

        hardest_questions.append(
            {
                "question_id": question["id"],
                "exam_id": question["exam_id"],
                "exam_title": exam_title_by_id.get(question["exam_id"], "시험"),
                "question_order": question["question_order"],
                "prompt": question["prompt"],
                "concept_tag": question["concept_tag"],
                "attempted_count": attempted_count,
                "incorrect_count": incorrect_count,
                "accuracy_rate": accuracy_rate,
                "common_wrong_choice": common_wrong_choice,
                "explanation": question.get("explanation"),
            }
        )

    hardest_questions.sort(key=lambda item: (item["accuracy_rate"], -item["incorrect_count"]))

    # Overall average: first attempt per (student_id, exam_id) only
    seen_first: set[tuple] = set()
    all_first_scores: list[float] = []
    for attempt in reversed(attempts):  # reversed = oldest first (fetched desc)
        key = (attempt["student_id"], attempt["exam_id"])
        if key not in seen_first:
            seen_first.add(key)
            if attempt.get("score") is not None:
                all_first_scores.append(attempt["score"])
    average_score = None
    if all_first_scores:
        average_score = round(sum(all_first_scores) / len(all_first_scores), 1)

    return {
        "exam_count": len(exams),
        "average_score": average_score,
        "exam_summaries": exam_summaries,
        "hardest_questions": hardest_questions[:5],
    }


def get_student_exam_overview(course_id: str, student_id: str) -> dict:
    exams = list_student_exams(course_id, student_id)
    notifications = list_student_notifications(student_id, course_id)
    latest_wrong_questions: list[dict] = []

    for exam in exams:
        latest_attempt = exam.get("latest_attempt")
        if not latest_attempt:
            continue

        detail = get_exam_detail(exam["id"], student_id=student_id, attempt_id=latest_attempt["id"])
        if not detail:
            continue

        for question in detail["questions"]:
            if question.get("is_correct") is False:
                latest_wrong_questions.append(
                    {
                        "exam_id": exam["id"],
                        "exam_title": exam["title"],
                        "attempt_id": latest_attempt["id"],
                        "answer_id": question.get("answer_id"),
                        "question_id": question["id"],
                        "question_order": question["question_order"],
                        "prompt": question["prompt"],
                        "concept_tag": question["concept_tag"],
                        "selected_choice": question.get("student_answer"),
                        "correct_choice": question["correct_choice"],
                        "tutor_prompt": question.get("tutor_prompt"),
                        "resolved_via_tutor": question.get("resolved_via_tutor"),
                    }
                )

    latest_wrong_questions.sort(
        key=lambda item: (
            1 if item.get("resolved_via_tutor") else 0,
            item["exam_title"],
            item["question_order"],
        )
    )

    return {
        "exams": exams,
        "recent_wrong_questions": latest_wrong_questions[:6],
        "notifications": notifications,
    }
