from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from typing import Any

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.ai_client import generate_json
from app.services.exam_authoring_service import (
    ExamImportError,
    create_exam_from_editor_payload,
    update_exam_from_editor_payload,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
UTC = timezone.utc


class MaterialGenerationError(RuntimeError):
    pass


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


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_json_response(raw_text: str) -> Any:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    return json.loads(cleaned)


def _check_ai_available() -> None:
    if settings.ai_provider == "openrouter" and not settings.openrouter_api_key:
        raise MaterialGenerationError("OPENROUTER_API_KEY가 없어 시험 초안을 자동 생성할 수 없습니다.")
    if settings.ai_provider != "openrouter" and not settings.gemini_api_key:
        raise MaterialGenerationError("GEMINI_API_KEY가 없어 시험 초안을 자동 생성할 수 없습니다.")


def get_material(material_id: str) -> dict | None:
    return safe_single(
        lambda: supabase.table("materials")
        .select(
            "id, course_id, file_name, indexed, page_count, summary_text, detected_sections, "
            "draft_generation_status, draft_generation_stage, draft_generation_error, draft_generated_count"
        )
        .eq("id", material_id)
    )


def list_material_pages(material_id: str) -> list[dict]:
    return safe_rows(
        lambda: supabase.table("material_pages")
        .select("page_number, page_label, text_content, char_count")
        .eq("material_id", material_id)
        .order("page_number")
    )


def update_material_generation_state(material_id: str, **fields) -> None:
    supabase.table("materials").update(fields).eq("id", material_id).execute()


def fallback_sections(file_name: str, page_count: int, *, max_sections: int = 3) -> list[dict[str, Any]]:
    if page_count <= 0:
        return []

    window_size = max(4, math.ceil(page_count / max_sections))
    sections: list[dict[str, Any]] = []
    start = 1
    order = 1
    while start <= page_count and len(sections) < max_sections:
        end = min(start + window_size - 1, page_count)
        sections.append(
            {
                "order": order,
                "title": f"{file_name} {start}-{end}p",
                "page_start": start,
                "page_end": end,
                "learning_objective": f"{start}-{end}페이지의 핵심 개념과 내용 이해를 점검합니다.",
            }
        )
        order += 1
        start = end + 1
    return sections


def sanitize_sections(
    raw_sections: Any,
    *,
    file_name: str,
    page_count: int,
    max_sections: int = 3,
) -> list[dict[str, Any]]:
    if not isinstance(raw_sections, list):
        return fallback_sections(file_name, page_count, max_sections=max_sections)

    sanitized: list[dict[str, Any]] = []
    for index, item in enumerate(raw_sections[:max_sections], start=1):
        if not isinstance(item, dict):
            continue
        title = normalize_space(item.get("title")) or f"{file_name} {index}"
        try:
            page_start = max(1, min(int(item.get("page_start", 1)), page_count))
            page_end = max(page_start, min(int(item.get("page_end", page_start)), page_count))
        except (TypeError, ValueError):
            continue
        learning_objective = normalize_space(item.get("learning_objective")) or f"{title} 범위의 핵심 개념을 점검합니다."
        sanitized.append(
            {
                "order": index,
                "title": title,
                "page_start": page_start,
                "page_end": page_end,
                "learning_objective": learning_objective,
            }
        )

    return sanitized or fallback_sections(file_name, page_count, max_sections=max_sections)


def infer_material_outline(
    material: dict,
    page_rows: list[dict],
    *,
    max_sections: int = 3,
) -> tuple[str, list[dict[str, Any]]]:
    page_count = max(material.get("page_count") or 0, len(page_rows))
    if page_count <= 0:
        return "", []

    # 전체 자료를 골고루 샘플링해서 AI가 모든 단원을 파악할 수 있게 합니다.
    sample_limit = max(max_sections * 8, 24)
    if len(page_rows) <= sample_limit:
        sampled_rows = page_rows
    else:
        # 앞·중간·뒤를 균등하게 샘플링합니다.
        indices = sorted(set(
            round(i * (len(page_rows) - 1) / (sample_limit - 1))
            for i in range(sample_limit)
        ))
        sampled_rows = [page_rows[i] for i in indices]

    page_dump = "\n\n".join(
        f"[페이지 {row['page_number']}]\n{str(row.get('text_content') or '')[:800]}"
        for row in sampled_rows
        if str(row.get("text_content") or "").strip()
    )
    if not page_dump.strip():
        return "", fallback_sections(material["file_name"], page_count, max_sections=max_sections)

    try:
        _check_ai_available()
    except MaterialGenerationError:
        return "", fallback_sections(material["file_name"], page_count, max_sections=max_sections)

    prompt = f"""
너는 교사용 학습 자료 분석기다.
아래는 교사가 업로드한 자료의 페이지 텍스트 샘플이다.

반드시 JSON 객체 하나만 반환해라.
형식:
{{
  "summary": "자료 전체를 교사가 빠르게 이해할 수 있는 2-3문장 요약",
  "sections": [
    {{
      "title": "단원/목차명",
      "page_start": 1,
      "page_end": 6,
      "learning_objective": "이 범위를 시험으로 확인하려는 교육 목적"
    }}
  ]
}}

제약:
- 자료에 존재하는 단원/문단을 빠짐없이 찾아라. sections는 정확히 자료의 단원 수만큼, 최대 {max_sections}개
- 단원이 {max_sections}개 미만이어도 실제로 구분되는 모든 단원을 포함해야 한다
- page_start/page_end는 1 이상 {page_count} 이하
- 전체 페이지 범위(1~{page_count})가 sections에 빠짐없이 커버되어야 한다
- supplied text 밖의 내용을 지어내지 말 것
- 제목이 애매하면 페이지 범위를 활용해도 됨

자료 파일명: {material['file_name']}
총 페이지 수: {page_count}

자료 텍스트 샘플:
{page_dump}
""".strip()

    try:
        payload = parse_json_response(generate_json(prompt, temperature=0.2))
        summary = normalize_space(payload.get("summary") if isinstance(payload, dict) else "")
        sections = sanitize_sections(
            payload.get("sections") if isinstance(payload, dict) else None,
            file_name=material["file_name"],
            page_count=page_count,
            max_sections=max_sections,
        )
        return summary, sections
    except Exception:
        return "", fallback_sections(material["file_name"], page_count, max_sections=max_sections)


def build_section_context(page_rows: list[dict], section: dict[str, Any], *, max_chars: int = 24000) -> str:
    relevant_rows = [
        row
        for row in page_rows
        if section["page_start"] <= int(row["page_number"]) <= section["page_end"]
        and str(row.get("text_content") or "").strip()
    ]
    context = "\n\n".join(
        f"[페이지 {row['page_number']}]\n{str(row['text_content'])[:1800]}"
        for row in relevant_rows
    )
    return context[:max_chars]


def generate_material_exam_draft(
    material: dict,
    section: dict[str, Any],
    page_rows: list[dict],
    *,
    questions_per_section: int = 10,
) -> dict[str, Any]:
    context = build_section_context(page_rows, section)
    if not context.strip():
        raise MaterialGenerationError(f"선택한 범위에 사용할 텍스트가 부족합니다: {section['title']}")

    _check_ai_available()
    prompt = f"""
너는 교사 보조용 객관식 시험 출제자다.
반드시 supplied context 안의 내용만 사용해서 시험 초안을 만들어라.

제약:
- 객관식 4지선다만 생성
- 총 {questions_per_section}문항
- 각 문항에 source_pages와 evidence_excerpt를 반드시 포함
- explanation은 교사용 해설처럼 짧고 분명하게 작성
- answer는 A/B/C/D 중 하나
- 응답은 반드시 JSON 객체 하나만 반환

JSON 형식:
{{
  "title": "시험 제목",
  "description": "시험 설명",
  "learning_objective": "이 범위를 평가하는 교육 목적",
  "questions": [
    {{
      "concept": "개념명",
      "prompt": "문항",
      "choices": [
        {{"label": "A", "text": "선택지"}},
        {{"label": "B", "text": "선택지"}},
        {{"label": "C", "text": "선택지"}},
        {{"label": "D", "text": "선택지"}}
      ],
      "answer": "A",
      "explanation": "해설",
      "source_pages": [1, 2],
      "evidence_excerpt": "근거 발췌"
    }}
  ]
}}

자료 파일명: {material['file_name']}
섹션 제목: {section['title']}
교육 목적: {section['learning_objective']}
페이지 범위: {section['page_start']}~{section['page_end']}

자료 텍스트:
{context}
""".strip()

    draft = parse_json_response(generate_json(prompt, temperature=0.3))
    if not isinstance(draft, dict) or not isinstance(draft.get("questions"), list):
        raise MaterialGenerationError(f"시험지 생성 응답을 이해하지 못했습니다: {section['title']}")
    return draft


def build_exam_payload(material: dict, section: dict[str, Any], draft: dict[str, Any]) -> dict[str, Any]:
    questions = draft.get("questions") or []
    return {
        "title": normalize_space(draft.get("title")) or f"{material['file_name']} - {section['title']}",
        "description": normalize_space(draft.get("description")) or f"{section['title']} 범위 자동 생성 시험 초안",
        "learning_objective": normalize_space(draft.get("learning_objective")) or section["learning_objective"],
        "exam_date": datetime.now(UTC).date().isoformat(),
        "duration_minutes": max(20, min(60, len(questions) * 3 if questions else 20)),
        "workflow_status": "draft",
        "assignment_type": "homework",
        "source_name": f"material:{material['id']}:section:{section['order']}",
        "source_format": "material_generated",
        "material_id": material["id"],
        "textbook_title": material["file_name"],
        "section_title": section["title"],
        "section_page_start": section["page_start"],
        "section_page_end": section["page_end"],
        "questions": [
            {
                "concept": normalize_space(question.get("concept")) or section["title"],
                "prompt": normalize_space(question.get("prompt")),
                "choices": question.get("choices") or [],
                "answer": str(question.get("answer") or "").strip().upper() or "A",
                "explanation": normalize_space(question.get("explanation")),
                "difficulty": "medium",
                "points": 10,
                "source_pages": question.get("source_pages") or [section["page_start"]],
                "evidence_excerpt": normalize_space(question.get("evidence_excerpt")),
            }
            for question in questions
        ],
    }


def upsert_material_section_exam(
    material: dict,
    section: dict[str, Any],
    draft: dict[str, Any],
    *,
    teacher_id: str | None = None,
) -> dict[str, Any]:
    payload = build_exam_payload(material, section, draft)
    existing_exam = safe_single(
        lambda: supabase.table("exams")
        .select("*")
        .eq("material_id", material["id"])
        .eq("source_format", "material_generated")
        .eq("source_name", payload["source_name"])
    )

    if existing_exam:
        existing_attempt = safe_single(
            lambda: supabase.table("exam_attempts")
            .select("id")
            .eq("exam_id", existing_exam["id"])
            .limit(1)
        )
        if existing_attempt:
            return {"status": "locked", "exam": existing_exam}

        result = update_exam_from_editor_payload(
            existing_exam["id"],
            payload,
            updated_by=teacher_id,
        )
        return {"status": "updated", "exam": result["exam"]}

    result = create_exam_from_editor_payload(
        material["course_id"],
        payload,
        created_by=teacher_id,
    )
    return {"status": "created", "exam": result["exam"]}


def auto_generate_material_draft_exams(
    material_id: str,
    *,
    teacher_id: str | None = None,
    max_sections: int = 3,
    questions_per_section: int = 10,
) -> dict[str, Any]:
    material = get_material(material_id)
    if not material:
        raise MaterialGenerationError("자료를 찾지 못했습니다.")
    if not material.get("indexed"):
        raise MaterialGenerationError("AI 학습이 완료된 자료에서만 시험 초안을 생성할 수 있습니다.")

    page_rows = list_material_pages(material_id)
    if not page_rows:
        raise MaterialGenerationError("자료 페이지 텍스트가 없어 시험 초안을 생성할 수 없습니다.")

    summary = ""
    sections: list[dict[str, Any]] = []
    try:
        update_material_generation_state(
            material_id,
            draft_generation_status="analyzing",
            draft_generation_stage="목차와 교육 목적 분석중",
            draft_generation_error=None,
            draft_generated_count=0,
        )
        summary, sections = infer_material_outline(material, page_rows, max_sections=max_sections)
        update_material_generation_state(
            material_id,
            summary_text=summary or None,
            detected_sections=sections,
            draft_generation_status="generating",
            draft_generation_stage="단원별 시험 초안 생성중",
            draft_generation_error=None,
        )

        results: list[dict[str, Any]] = []
        created_count = 0
        for index, section in enumerate(sections, start=1):
            progress_label = f"시험 초안 생성중 ({index}/{len(sections)})"
            update_material_generation_state(material_id, draft_generation_stage=progress_label)
            try:
                draft = generate_material_exam_draft(
                    material,
                    section,
                    page_rows,
                    questions_per_section=questions_per_section,
                )
                result = upsert_material_section_exam(material, section, draft, teacher_id=teacher_id)
                results.append(
                    {
                        "section": section,
                        "status": result["status"],
                        "exam": result["exam"],
                    }
                )
                if result["status"] in {"created", "updated"}:
                    created_count += 1
            except (MaterialGenerationError, ExamImportError, APIError, json.JSONDecodeError) as section_error:
                results.append(
                    {
                        "section": section,
                        "status": "failed",
                        "error": str(section_error),
                    }
                )

        update_material_generation_state(
            material_id,
            summary_text=summary or None,
            detected_sections=sections,
            draft_generation_status="completed",
            draft_generation_stage=f"단원별 draft {created_count}개 생성 완료",
            draft_generated_count=created_count,
            last_generated_at=datetime.now(UTC).isoformat(),
            draft_generation_error=None,
        )
        return {
            "summary": summary,
            "sections": sections,
            "results": results,
            "generated_count": created_count,
        }
    except (MaterialGenerationError, ExamImportError, APIError, json.JSONDecodeError) as error:
        update_material_generation_state(
            material_id,
            summary_text=summary or None,
            detected_sections=sections,
            draft_generation_status="failed",
            draft_generation_stage="시험 초안 자동 생성 실패",
            draft_generation_error=str(error),
        )
        if isinstance(error, MaterialGenerationError):
            raise
        raise MaterialGenerationError(str(error)) from error
