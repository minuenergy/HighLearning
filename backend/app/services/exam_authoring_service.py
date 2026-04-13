from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID
from uuid import uuid4

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.textbook_catalog_service import (
    resolve_question_chunk_ids,
    resolve_textbook_catalog_scope,
)
from app.services.textbook_exam_service import normalize_due_at, normalize_publish_at

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "exams"
BLOCK_SPLIT_RE = re.compile(r"(?m)^---+\s*$")
FIELD_RE = re.compile(r"^(TITLE|DESCRIPTION|DATE|DURATION|TOTAL_POINTS|CONCEPT|DIFFICULTY|POINTS|QUESTION|ANSWER|EXPLANATION):\s*(.+)$")
CHOICE_RE = re.compile(r"^([A-Z])(?:[.):]|\s)\s*(.+)$")
WORKFLOW_STATUSES = {"draft", "reviewed", "scheduled", "published", "archived"}
ASSIGNMENT_TYPES = {"exam", "homework"}
SOURCE_FORMATS = {"manual", "markdown_upload", "preset", "simulation", "textbook_generated", "material_generated"}
QUESTION_DIFFICULTIES = {"easy", "medium", "hard"}


class ExamImportError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedExamQuestion:
    concept_tag: str
    prompt: str
    choices: list[dict]
    correct_choice: str
    explanation: str | None
    points: int
    difficulty: str


@dataclass(frozen=True)
class ParsedExam:
    title: str
    description: str
    exam_date: str
    duration_minutes: int
    total_points: int
    questions: list[ParsedExamQuestion]


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


def normalize_exam_date(raw_value: str | None) -> str:
    if not raw_value:
        return datetime.now(timezone.utc).isoformat()

    value = raw_value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return f"{value}T09:00:00+09:00"
    return value


def normalize_optional_uuid(raw_value: Any) -> str | None:
    if raw_value is None:
        return None

    value = str(raw_value).strip()
    if not value:
        return None

    try:
        return str(UUID(value))
    except ValueError:
        return None


def normalize_source_pages(raw_value: Any) -> list[int]:
    if not isinstance(raw_value, list):
        return []

    pages: set[int] = set()
    for item in raw_value:
        try:
            page = int(item)
        except (TypeError, ValueError):
            continue
        if page > 0:
            pages.add(page)
    return sorted(pages)


def question_chunk_column_available() -> bool:
    try:
        supabase.table("exam_questions").select("source_chunk_ids").limit(1).execute()
        return True
    except APIError as error:
        if get_api_error_code(error) in {"42703", "PGRST204", "PGRST205"}:
            return False
        raise


def normalize_uuid_list(raw_value: Any) -> list[str]:
    if not isinstance(raw_value, list):
        return []

    values: list[str] = []
    for item in raw_value:
        normalized = normalize_optional_uuid(item)
        if normalized and normalized not in values:
            values.append(normalized)
    return values


def normalize_choice_payload(choice: dict[str, Any], *, question_order: int, choice_index: int) -> dict[str, str]:
    label = str(choice.get("label") or "").strip().upper()[:1]
    text = str(choice.get("text") or "").strip()

    if not label:
        raise ExamImportError(f"{question_order}번 문항의 {choice_index}번째 선택지 라벨이 비어 있습니다.")
    if not text:
        raise ExamImportError(f"{question_order}번 문항의 {label} 선택지 내용이 비어 있습니다.")

    return {
        "label": label,
        "text": text,
    }


def build_editor_question_payload_from_existing(question: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": question.get("id"),
        "concept": question.get("concept_tag"),
        "concept_tag": question.get("concept_tag"),
        "prompt": question.get("prompt"),
        "choices": question.get("choices") or [],
        "answer": question.get("correct_choice"),
        "correct_choice": question.get("correct_choice"),
        "explanation": question.get("explanation"),
        "difficulty": question.get("difficulty") or "medium",
        "points": question.get("points") or 10,
        "source_pages": question.get("source_pages") or [],
        "evidence_excerpt": question.get("evidence_excerpt"),
        "source_chunk_ids": question.get("source_chunk_ids") or [],
        "source_textbook_slug": question.get("source_textbook_slug"),
        "source_section_title": question.get("source_section_title"),
    }


def normalize_editor_question(
    raw_question: dict[str, Any],
    *,
    question_order: int,
    default_textbook_slug: str | None = None,
    default_section_title: str | None = None,
) -> dict[str, Any]:
    prompt = str(raw_question.get("prompt") or "").strip()
    if not prompt:
        raise ExamImportError(f"{question_order}번 문항 내용이 비어 있습니다.")

    concept_tag = str(raw_question.get("concept_tag") or raw_question.get("concept") or "").strip()
    if not concept_tag:
        concept_tag = default_section_title or "교재 기반 학습"

    raw_choices = raw_question.get("choices")
    if not isinstance(raw_choices, list) or len(raw_choices) < 2:
        raise ExamImportError(f"{question_order}번 문항에는 최소 2개 이상의 선택지가 필요합니다.")

    choices = [
        normalize_choice_payload(choice, question_order=question_order, choice_index=index)
        for index, choice in enumerate(raw_choices, start=1)
    ]
    labels = [choice["label"] for choice in choices]
    if len(set(labels)) != len(labels):
        raise ExamImportError(f"{question_order}번 문항의 선택지 라벨이 중복되었습니다.")

    correct_choice = str(raw_question.get("correct_choice") or raw_question.get("answer") or "").strip().upper()
    if correct_choice not in set(labels):
        raise ExamImportError(f"{question_order}번 문항의 정답 라벨이 선택지에 없습니다.")

    difficulty = str(raw_question.get("difficulty") or "medium").strip().lower()
    if difficulty not in QUESTION_DIFFICULTIES:
        raise ExamImportError(f"{question_order}번 문항의 difficulty는 easy, medium, hard 중 하나여야 합니다.")

    points_raw = raw_question.get("points", 10)
    try:
        points = int(points_raw)
    except (TypeError, ValueError) as error:
        raise ExamImportError(f"{question_order}번 문항의 배점이 숫자가 아닙니다.") from error
    if points <= 0:
        raise ExamImportError(f"{question_order}번 문항의 배점은 1점 이상이어야 합니다.")

    source_textbook_slug = str(raw_question.get("source_textbook_slug") or default_textbook_slug or "").strip() or None
    source_section_title = str(raw_question.get("source_section_title") or default_section_title or "").strip() or None
    source_pages = normalize_source_pages(raw_question.get("source_pages"))
    evidence_excerpt = str(raw_question.get("evidence_excerpt") or "").strip() or None
    source_chunk_ids = normalize_uuid_list(raw_question.get("source_chunk_ids"))
    if not source_chunk_ids:
        source_chunk_ids = resolve_question_chunk_ids(
            textbook_slug=source_textbook_slug,
            source_pages=source_pages,
            evidence_excerpt=evidence_excerpt,
            section_title=source_section_title,
        )

    return {
        "id": normalize_optional_uuid(raw_question.get("id")),
        "question_order": question_order,
        "concept_tag": concept_tag,
        "prompt": prompt,
        "choices": choices,
        "correct_choice": correct_choice,
        "explanation": str(raw_question.get("explanation") or "").strip() or None,
        "difficulty": difficulty,
        "points": points,
        "source_pages": source_pages,
        "evidence_excerpt": evidence_excerpt,
        "source_chunk_ids": source_chunk_ids,
        "source_textbook_slug": source_textbook_slug,
        "source_section_title": source_section_title,
    }


def build_exam_editor_payload(
    course_id: str,
    payload: dict[str, Any],
    *,
    created_by: str | None = None,
    existing_exam: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    title = str(payload.get("title") or (existing_exam.get("title") if existing_exam else "") or "").strip()
    if not title:
        raise ExamImportError("시험 제목이 비어 있습니다.")

    description = str(payload.get("description") or (existing_exam.get("description") if existing_exam else "") or "").strip()
    raw_exam_date = payload.get("exam_date")
    if raw_exam_date is None and existing_exam:
        raw_exam_date = existing_exam.get("exam_date")
    exam_date = normalize_exam_date(str(raw_exam_date or ""))

    duration_raw = payload.get("duration_minutes", existing_exam.get("duration_minutes") if existing_exam else 30)
    try:
        duration_minutes = int(duration_raw)
    except (TypeError, ValueError) as error:
        raise ExamImportError("시험 제한 시간은 숫자여야 합니다.") from error
    if duration_minutes <= 0:
        raise ExamImportError("시험 제한 시간은 1분 이상이어야 합니다.")

    raw_workflow_status = payload.get("workflow_status")
    if raw_workflow_status is None and existing_exam:
        raw_workflow_status = existing_exam.get("workflow_status")
    workflow_status = str(raw_workflow_status or "draft").strip().lower()
    if workflow_status not in WORKFLOW_STATUSES:
        raise ExamImportError(f"지원하지 않는 workflow_status 입니다: {workflow_status}")

    raw_assignment_type = payload.get("assignment_type")
    if raw_assignment_type is None and existing_exam:
        raw_assignment_type = existing_exam.get("assignment_type")
    assignment_type = str(raw_assignment_type or "homework").strip().lower()
    if assignment_type not in ASSIGNMENT_TYPES:
        raise ExamImportError(f"지원하지 않는 assignment_type 입니다: {assignment_type}")

    raw_source_format = payload.get("source_format")
    if raw_source_format is None and existing_exam:
        raw_source_format = existing_exam.get("source_format")
    source_format = str(raw_source_format or "manual").strip().lower()
    if source_format not in SOURCE_FORMATS:
        raise ExamImportError(f"지원하지 않는 source_format 입니다: {source_format}")

    textbook_slug = str(payload.get("textbook_slug") or (existing_exam.get("textbook_slug") if existing_exam else "") or "").strip() or None
    textbook_title = str(payload.get("textbook_title") or (existing_exam.get("textbook_title") if existing_exam else "") or "").strip() or None
    section_title = str(payload.get("section_title") or (existing_exam.get("section_title") if existing_exam else "") or "").strip() or None
    material_id = normalize_optional_uuid(payload.get("material_id")) or (
        normalize_optional_uuid(existing_exam.get("material_id")) if existing_exam else None
    )
    learning_objective = str(
        payload.get("learning_objective") or (existing_exam.get("learning_objective") if existing_exam else "")
    ).strip() or None
    assignment_note = str(payload.get("assignment_note") or (existing_exam.get("assignment_note") if existing_exam else "")).strip() or None
    due_at = payload.get("due_at", existing_exam.get("due_at") if existing_exam else None)
    publish_at = payload.get("published_at", existing_exam.get("published_at") if existing_exam else None)

    raw_questions = payload.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise ExamImportError("시험에는 최소 1개 이상의 문항이 필요합니다.")

    question_rows: list[dict[str, Any]] = []
    total_points = 0
    all_source_pages: list[int] = []
    for order, raw_question in enumerate(raw_questions, start=1):
        if not isinstance(raw_question, dict):
            raise ExamImportError(f"{order}번 문항 형식을 이해하지 못했습니다.")
        question = normalize_editor_question(
            raw_question,
            question_order=order,
            default_textbook_slug=textbook_slug,
            default_section_title=section_title,
        )
        total_points += question["points"]
        all_source_pages.extend(question["source_pages"])
        question_rows.append(question)

    section_page_start = payload.get("section_page_start", existing_exam.get("section_page_start") if existing_exam else None)
    section_page_end = payload.get("section_page_end", existing_exam.get("section_page_end") if existing_exam else None)
    normalized_all_pages = sorted({page for page in all_source_pages if page > 0})
    if section_page_start is None and normalized_all_pages:
        section_page_start = normalized_all_pages[0]
    if section_page_end is None and normalized_all_pages:
        section_page_end = normalized_all_pages[-1]

    catalog_scope = resolve_textbook_catalog_scope(
        textbook_slug=textbook_slug,
        section_title=section_title,
        page_start=section_page_start,
        page_end=section_page_end,
    )

    exam_row = {
        "course_id": course_id,
        "title": title,
        "description": description,
        "exam_date": exam_date,
        "duration_minutes": duration_minutes,
        "total_points": total_points,
        "source_name": str(payload.get("source_name") or (existing_exam.get("source_name") if existing_exam else "")).strip() or None,
        "source_format": source_format,
        "created_by": created_by if created_by is not None else (existing_exam.get("created_by") if existing_exam else None),
        "workflow_status": workflow_status,
        "assignment_type": assignment_type,
        "due_at": normalize_due_at(due_at) if isinstance(due_at, str) else due_at,
        "published_at": normalize_publish_at(publish_at) if isinstance(publish_at, str) else publish_at,
        "textbook_slug": textbook_slug,
        "textbook_title": textbook_title,
        "textbook_id": catalog_scope["textbook_id"],
        "textbook_toc_node_id": catalog_scope["textbook_toc_node_id"],
        "section_title": section_title,
        "material_id": material_id,
        "learning_objective": learning_objective,
        "section_page_start": section_page_start,
        "section_page_end": section_page_end,
        "assignment_note": assignment_note,
    }
    return exam_row, question_rows


def create_exam_from_editor_payload(
    course_id: str,
    payload: dict[str, Any],
    *,
    created_by: str | None = None,
) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    exam_id = str(uuid4())
    exam_row, question_rows = build_exam_editor_payload(course_id, payload, created_by=created_by)
    exam_row["id"] = exam_id
    exam_row["created_at"] = created_at
    if exam_row.get("workflow_status") == "published" and not exam_row.get("published_at"):
        exam_row["published_at"] = created_at

    persisted_questions = []
    include_chunk_ids = question_chunk_column_available()
    for question in question_rows:
        row = {
            "id": str(uuid4()),
            "exam_id": exam_id,
            "question_order": question["question_order"],
            "concept_tag": question["concept_tag"],
            "prompt": question["prompt"],
            "choices": question["choices"],
            "correct_choice": question["correct_choice"],
            "explanation": question.get("explanation"),
            "difficulty": question["difficulty"],
            "points": question["points"],
            "created_at": created_at,
            "source_pages": question["source_pages"],
            "evidence_excerpt": question.get("evidence_excerpt"),
            "source_textbook_slug": question.get("source_textbook_slug"),
            "source_section_title": question.get("source_section_title"),
        }
        if include_chunk_ids:
            row["source_chunk_ids"] = question.get("source_chunk_ids") or []
        persisted_questions.append(row)

    try:
        supabase.table("exams").insert(exam_row).execute()
        if persisted_questions:
            supabase.table("exam_questions").insert(persisted_questions).execute()
    except APIError as error:
        raise ExamImportError(
            "시험 편집용 DB 스키마가 아직 준비되지 않았습니다. "
            "backend/supabase/migrations/003_assessments_and_chat_sources.sql, "
            "004_exam_workflows.sql, 005_textbook_assignment_pipeline.sql 을 먼저 적용해주세요."
        ) from error

    return {
        "exam": exam_row,
        "question_count": len(persisted_questions),
    }


def list_exam_questions_for_editor(exam_id: str) -> list[dict[str, Any]]:
    fields = (
        "id, question_order, concept_tag, prompt, choices, correct_choice, "
        "explanation, difficulty, points, source_pages, evidence_excerpt, "
        "source_textbook_slug, source_section_title"
    )
    if question_chunk_column_available():
        fields += ", source_chunk_ids"
    return safe_rows(
        lambda: supabase.table("exam_questions")
        .select(fields)
        .eq("exam_id", exam_id)
        .order("question_order")
    )


def update_exam_from_editor_payload(
    exam_id: str,
    payload: dict[str, Any],
    *,
    updated_by: str | None = None,
    partial: bool = False,
) -> dict[str, Any]:
    exam = safe_rows(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    existing_exam = exam[0] if exam else None
    if not existing_exam:
        raise ExamImportError("수정할 시험을 찾지 못했습니다.")

    existing_attempts = safe_rows(
        lambda: supabase.table("exam_attempts")
        .select("id")
        .eq("exam_id", exam_id)
        .limit(1)
    )
    if existing_attempts:
        raise ExamImportError("이미 학생 응시 기록이 있는 시험은 문항을 수정할 수 없습니다.")

    if partial and "questions" not in payload:
        payload = {
            **payload,
            "questions": [
                build_editor_question_payload_from_existing(question)
                for question in list_exam_questions_for_editor(exam_id)
            ],
        }

    exam_row, question_rows = build_exam_editor_payload(
        existing_exam["course_id"],
        payload,
        created_by=updated_by,
        existing_exam=existing_exam,
    )
    if existing_exam.get("workflow_status") != "published" and exam_row.get("workflow_status") == "published":
        exam_row["published_at"] = datetime.now(timezone.utc).isoformat()
    elif exam_row.get("workflow_status") == "scheduled" and not exam_row.get("published_at"):
        exam_row["published_at"] = existing_exam.get("published_at")

    existing_questions = list_exam_questions_for_editor(exam_id)
    existing_question_ids = {question["id"] for question in existing_questions}
    include_chunk_ids = question_chunk_column_available()

    upsert_rows: list[dict[str, Any]] = []
    next_question_ids: set[str] = set()
    for question in question_rows:
        question_id = question["id"] if question.get("id") in existing_question_ids else str(uuid4())
        next_question_ids.add(question_id)
        row = {
            "id": question_id,
            "exam_id": exam_id,
            "question_order": question["question_order"],
            "concept_tag": question["concept_tag"],
            "prompt": question["prompt"],
            "choices": question["choices"],
            "correct_choice": question["correct_choice"],
            "explanation": question.get("explanation"),
            "difficulty": question["difficulty"],
            "points": question["points"],
            "source_pages": question["source_pages"],
            "evidence_excerpt": question.get("evidence_excerpt"),
            "source_textbook_slug": question.get("source_textbook_slug"),
            "source_section_title": question.get("source_section_title"),
        }
        if include_chunk_ids:
            row["source_chunk_ids"] = question.get("source_chunk_ids") or []
        upsert_rows.append(row)

    try:
        for offset, question in enumerate(existing_questions, start=1):
            supabase.table("exam_questions").update({"question_order": 1000 + offset}).eq("id", question["id"]).execute()
        supabase.table("exams").update(exam_row).eq("id", exam_id).execute()
        if upsert_rows:
            supabase.table("exam_questions").upsert(upsert_rows).execute()
        removed_question_ids = sorted(existing_question_ids - next_question_ids)
        if removed_question_ids:
            supabase.table("exam_questions").delete().in_("id", removed_question_ids).execute()
    except APIError as error:
        for question in existing_questions:
            supabase.table("exam_questions").update({"question_order": question["question_order"]}).eq("id", question["id"]).execute()
        raise ExamImportError("시험 수정 저장 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.") from error

    updated_exam_rows = safe_rows(lambda: supabase.table("exams").select("*").eq("id", exam_id))
    updated_exam = updated_exam_rows[0] if updated_exam_rows else None
    if not updated_exam:
        raise ExamImportError("시험 수정 저장 후 결과를 확인하지 못했습니다.")

    return {
        "exam": updated_exam,
        "question_count": len(upsert_rows),
    }


def split_document(raw_text: str) -> tuple[str, list[str]]:
    sections = [section.strip() for section in BLOCK_SPLIT_RE.split(raw_text.strip()) if section.strip()]
    if len(sections) < 2:
        raise ExamImportError("시험지에는 헤더와 최소 1개 이상의 문제 블록이 필요합니다.")
    return sections[0], sections[1:]


def parse_header(header_text: str) -> dict[str, str]:
    header: dict[str, str] = {}
    for line in header_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        match = FIELD_RE.match(stripped)
        if not match:
            raise ExamImportError(f"헤더 형식을 이해하지 못했습니다: {stripped}")
        key, value = match.groups()
        header[key] = value.strip()
    return header


def parse_question_block(block_text: str) -> ParsedExamQuestion:
    data: dict[str, str] = {}
    choices: list[dict] = []

    for line in block_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        choice_match = CHOICE_RE.match(stripped)
        if choice_match:
            label, text = choice_match.groups()
            choices.append({"label": label, "text": text.strip()})
            continue

        match = FIELD_RE.match(stripped)
        if not match:
            raise ExamImportError(f"문제 블록 형식을 이해하지 못했습니다: {stripped}")

        key, value = match.groups()
        if key in {"TITLE", "DESCRIPTION", "DATE", "DURATION", "TOTAL_POINTS"}:
            raise ExamImportError(f"문제 블록에는 {key} 대신 QUESTION/CONCEPT 등의 필드를 사용해주세요.")
        data[key] = value.strip()

    missing_fields = [field for field in ("CONCEPT", "QUESTION", "ANSWER") if field not in data]
    if missing_fields:
        raise ExamImportError(f"문제 블록에 필요한 필드가 없습니다: {', '.join(missing_fields)}")

    if len(choices) < 2:
        raise ExamImportError("각 문제에는 최소 2개 이상의 선택지가 필요합니다.")

    correct_choice = data["ANSWER"].upper()
    available_labels = {choice["label"] for choice in choices}
    if correct_choice not in available_labels:
        raise ExamImportError(f"정답 {correct_choice}가 선택지에 없습니다.")

    difficulty = data.get("DIFFICULTY", "medium").lower()
    if difficulty not in {"easy", "medium", "hard"}:
        raise ExamImportError("DIFFICULTY는 easy, medium, hard 중 하나여야 합니다.")

    return ParsedExamQuestion(
        concept_tag=data["CONCEPT"],
        prompt=data["QUESTION"],
        choices=choices,
        correct_choice=correct_choice,
        explanation=data.get("EXPLANATION"),
        points=int(data.get("POINTS", "10")),
        difficulty=difficulty,
    )


def parse_exam_document(raw_text: str) -> ParsedExam:
    header_text, blocks = split_document(raw_text)
    header = parse_header(header_text)
    if "TITLE" not in header:
        raise ExamImportError("시험지 헤더에 TITLE이 필요합니다.")

    questions = [parse_question_block(block) for block in blocks]
    total_points = int(header.get("TOTAL_POINTS", "0")) or sum(question.points for question in questions)

    return ParsedExam(
        title=header["TITLE"],
        description=header.get("DESCRIPTION", ""),
        exam_date=normalize_exam_date(header.get("DATE")),
        duration_minutes=int(header.get("DURATION", "30")),
        total_points=total_points,
        questions=questions,
    )


def create_exam_from_text(
    course_id: str,
    raw_text: str,
    *,
    created_by: str | None = None,
    source_name: str | None = None,
    source_format: str = "markdown_upload",
) -> dict:
    parsed = parse_exam_document(raw_text)
    exam_id = str(uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    exam_row = {
        "id": exam_id,
        "course_id": course_id,
        "title": parsed.title,
        "description": parsed.description,
        "exam_date": parsed.exam_date,
        "duration_minutes": parsed.duration_minutes,
        "total_points": parsed.total_points,
        "source_name": source_name,
        "source_format": source_format,
        "created_by": created_by,
        "created_at": created_at,
    }
    question_rows = []
    for order, question in enumerate(parsed.questions, start=1):
        question_rows.append(
            {
                "id": str(uuid4()),
                "exam_id": exam_id,
                "question_order": order,
                "concept_tag": question.concept_tag,
                "prompt": question.prompt,
                "choices": question.choices,
                "correct_choice": question.correct_choice,
                "explanation": question.explanation,
                "difficulty": question.difficulty,
                "points": question.points,
                "created_at": created_at,
            }
        )

    try:
        supabase.table("exams").insert(exam_row).execute()
        supabase.table("exam_questions").insert(question_rows).execute()
    except APIError as error:
        raise ExamImportError(
            "시험 업로드용 DB 스키마가 아직 준비되지 않았습니다. "
            "backend/supabase/migrations/003_assessments_and_chat_sources.sql 과 "
            "backend/supabase/migrations/004_exam_workflows.sql 을 먼저 적용해주세요."
        ) from error

    return {
        "exam": exam_row,
        "question_count": len(question_rows),
    }


def list_exam_presets() -> list[dict]:
    presets: list[dict] = []
    for path in sorted(FIXTURE_DIR.glob("*.exam.md")):
        raw_text = path.read_text(encoding="utf-8")
        parsed = parse_exam_document(raw_text)
        preset_id = path.name.removesuffix(".exam.md")
        presets.append(
            {
                "id": preset_id,
                "title": parsed.title,
                "description": parsed.description,
                "duration_minutes": parsed.duration_minutes,
                "question_count": len(parsed.questions),
                "total_points": parsed.total_points,
                "concepts": [question.concept_tag for question in parsed.questions[:3]],
                "source_name": path.name,
            }
        )
    return presets


def import_exam_presets(
    course_id: str,
    preset_ids: list[str] | None = None,
    *,
    created_by: str | None = None,
) -> dict:
    available_paths = {
        path.name.removesuffix(".exam.md"): path
        for path in sorted(FIXTURE_DIR.glob("*.exam.md"))
    }
    target_ids = preset_ids or list(available_paths.keys())
    existing_presets = {
        row.get("source_name")
        for row in safe_rows(
            lambda: supabase.table("exams")
            .select("id, source_name")
            .eq("course_id", course_id)
            .eq("source_format", "preset")
        )
    }

    created: list[dict] = []
    skipped: list[dict] = []
    for preset_id in target_ids:
        path = available_paths.get(preset_id)
        if not path:
            raise ExamImportError(f"알 수 없는 preset id입니다: {preset_id}")

        if preset_id in existing_presets:
            skipped.append({"id": preset_id, "reason": "already_imported"})
            continue

        raw_text = path.read_text(encoding="utf-8")
        created.append(
            create_exam_from_text(
                course_id,
                raw_text,
                created_by=created_by,
                source_name=preset_id,
                source_format="preset",
            )
        )

    return {
        "created": created,
        "skipped": skipped,
    }
