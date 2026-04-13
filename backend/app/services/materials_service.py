from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import pymupdf
from supabase import create_client

from app.config import settings


def _material_pdf_path(material_id: str) -> Path:
    return Path(settings.material_storage_root) / f"{material_id}.pdf"
from app.services.document_parsing_service import DocumentParsingError, parse_document_pages_from_path
from app.services.material_generation_service import auto_generate_material_draft_exams, update_material_generation_state
from app.services.rag_service import index_material_pages

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

UTC = timezone.utc

LIST_SELECT = (
    "id, course_id, file_name, indexed, created_at, processing_status, processing_stage, "
    "parser_used, chunk_count, extracted_char_count, error_message, "
    "processing_started_at, processing_completed_at, page_count, draft_generation_status, "
    "draft_generation_stage, draft_generation_error, draft_generated_count, last_generated_at"
)

DETAIL_SELECT = (
    "id, course_id, file_name, storage_path, indexed, created_at, processing_status, processing_stage, "
    "parser_used, chunk_count, extracted_char_count, error_message, "
    "processing_started_at, processing_completed_at, page_count, summary_text, detected_sections, "
    "draft_generation_status, draft_generation_stage, draft_generation_error, draft_generated_count, "
    "last_generated_at"
)


def list_course_materials(course_id: str) -> list[dict]:
    result = (
        supabase.table("materials")
        .select(LIST_SELECT)
        .eq("course_id", course_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data


def create_material_record(course_id: str, file_name: str) -> dict:
    timestamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    storage_path = f"uploads/{course_id}/{timestamp}_{uuid4().hex}_{file_name}"
    result = (
        supabase.table("materials")
        .insert(
            {
                "course_id": course_id,
                "file_name": file_name,
                "storage_path": storage_path,
                "indexed": False,
                "processing_status": "queued",
                "processing_stage": "업로드 완료, 처리 대기 중",
                "chunk_count": 0,
                "extracted_char_count": 0,
                "page_count": 0,
                "draft_generation_status": "idle",
                "draft_generated_count": 0,
            }
        )
        .execute()
    )
    return result.data[0]


def mark_material_indexed(material_id: str, indexed: bool = True) -> dict:
    result = (
        supabase.table("materials")
        .update({"indexed": indexed})
        .eq("id", material_id)
        .execute()
    )
    return result.data[0]


def replace_material_pages(material_id: str, page_rows: list[dict]) -> None:
    supabase.table("material_pages").delete().eq("material_id", material_id).execute()
    if not page_rows:
        return

    rows = [
        {
            "material_id": material_id,
            "page_number": int(row["page_number"]),
            "page_label": row.get("page_label"),
            "text_content": str(row.get("text") or "").strip(),
            "char_count": len(str(row.get("text") or "").strip()),
        }
        for row in page_rows
        if str(row.get("text") or "").strip()
    ]
    if not rows:
        return

    batch_size = max(1, settings.material_pages_insert_batch_size)
    for index in range(0, len(rows), batch_size):
        supabase.table("material_pages").insert(rows[index : index + batch_size]).execute()


def get_material_page_text(material_id: str, page_number: int) -> dict | None:
    result = (
        supabase.table("material_pages")
        .select("page_number, page_label, text_content")
        .eq("material_id", material_id)
        .eq("page_number", page_number)
        .execute()
    )
    return result.data[0] if result.data else None


def render_material_page_image(material_id: str, page_number: int) -> bytes | None:
    """pymupdf로 PDF 특정 페이지를 PNG 이미지로 렌더링합니다. 0-based가 아닌 1-based 페이지 번호를 받습니다."""
    pdf_path = _material_pdf_path(material_id)
    if not pdf_path.exists():
        return None
    doc = pymupdf.open(str(pdf_path))
    try:
        if page_number < 1 or page_number > len(doc):
            return None
        page = doc[page_number - 1]
        mat = pymupdf.Matrix(settings.material_page_image_dpi / 72, settings.material_page_image_dpi / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        return pix.tobytes("png")
    finally:
        doc.close()


def delete_material(material_id: str) -> None:
    supabase.table("material_pages").delete().eq("material_id", material_id).execute()
    supabase.table("materials").delete().eq("id", material_id).execute()
    _material_pdf_path(material_id).unlink(missing_ok=True)


def list_material_related_exams(material_id: str) -> list[dict]:
    exams = (
        supabase.table("exams")
        .select(
            "id, title, workflow_status, assignment_type, due_at, source_format, "
            "section_title, learning_objective"
        )
        .eq("material_id", material_id)
        .order("created_at", desc=True)
        .execute()
    ).data or []
    if not exams:
        return []

    exam_ids = [exam["id"] for exam in exams]
    questions = (
        supabase.table("exam_questions")
        .select("exam_id")
        .in_("exam_id", exam_ids)
        .execute()
    ).data or []
    question_count_by_exam: dict[str, int] = {}
    for question in questions:
        exam_id = question["exam_id"]
        question_count_by_exam[exam_id] = question_count_by_exam.get(exam_id, 0) + 1

    return [
        {
            **exam,
            "question_count": question_count_by_exam.get(exam["id"], 0),
        }
        for exam in exams
    ]


def get_material_detail(material_id: str) -> dict | None:
    result = (
        supabase.table("materials")
        .select(DETAIL_SELECT)
        .eq("id", material_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    material = rows[0] if rows else None
    if not material:
        return None
    return {
        **material,
        "related_exams": list_material_related_exams(material_id),
    }


def update_material_processing(material_id: str, **fields) -> dict:
    payload = {
        **fields,
        "processing_completed_at": fields.get("processing_completed_at"),
    }
    result = (
        supabase.table("materials")
        .update(payload)
        .eq("id", material_id)
        .execute()
    )
    return result.data[0]


def process_material_upload(
    *,
    material_id: str,
    course_id: str,
    file_name: str,
    source_path: str,
    cleanup_source: bool = True,
    parser_mode: str | None = None,
) -> None:
    update_material_processing(
        material_id,
        processing_status="parsing",
        processing_stage="교재 파싱중",
        processing_started_at=datetime.now(UTC).isoformat(),
        error_message=None,
    )

    try:
        page_rows, parser_used = parse_document_pages_from_path(file_name, source_path, parser_mode)
        extracted_char_count = sum(len(str(row.get("text") or "").strip()) for row in page_rows)
        update_material_processing(
            material_id,
            processing_status="indexing",
            processing_stage="지식 인덱싱중",
            parser_used=parser_used,
            extracted_char_count=extracted_char_count,
            page_count=len(page_rows),
        )

        replace_material_pages(material_id, page_rows)
        chunk_count = index_material_pages(course_id, material_id, page_rows)

        # 원본 PDF를 영구 경로로 보존해서 페이지 이미지 렌더링에 사용합니다.
        try:
            dest = _material_pdf_path(material_id)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, dest)
        except Exception:
            pass  # PDF 보존 실패는 치명적이지 않습니다.

        update_material_processing(
            material_id,
            indexed=True,
            processing_status="completed",
            processing_stage="AI 학습 완료",
            parser_used=parser_used,
            chunk_count=chunk_count,
            extracted_char_count=extracted_char_count,
            page_count=len(page_rows),
            processing_completed_at=datetime.now(UTC).isoformat(),
            error_message=None,
        )
        try:
            auto_generate_material_draft_exams(material_id)
        except Exception as draft_error:
            # 자료 학습 자체는 완료로 유지하고, 시험 초안 생성 실패는 별도 generation 상태에 기록합니다.
            update_material_generation_state(
                material_id,
                draft_generation_status="failed",
                draft_generation_stage="시험 초안 자동 생성 실패",
                draft_generation_error=str(draft_error),
            )
    except DocumentParsingError as error:
        update_material_processing(
            material_id,
            indexed=False,
            processing_status="failed",
            processing_stage="파싱 실패",
            error_message=str(error),
            processing_completed_at=datetime.now(UTC).isoformat(),
        )
    except Exception as error:
        update_material_processing(
            material_id,
            indexed=False,
            processing_status="failed",
            processing_stage="인덱싱 실패",
            error_message=str(error),
            processing_completed_at=datetime.now(UTC).isoformat(),
        )
    finally:
        if cleanup_source:
            Path(source_path).unlink(missing_ok=True)
