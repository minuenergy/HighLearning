from __future__ import annotations

import json
import re
import subprocess
from io import BytesIO
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from uuid import uuid4

from postgrest.exceptions import APIError
from PIL import Image
from supabase import create_client

from app.config import settings

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)

TEXTBOOK_ROOT = Path(__file__).resolve().parents[2] / "data" / "kumsung_middle"
SLUG_RE = re.compile(r"[^a-z0-9]+")
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}


class TextbookDraftError(ValueError):
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


def exam_question_chunk_column_available() -> bool:
    try:
        supabase.table("exam_questions").select("source_chunk_ids").limit(1).execute()
        return True
    except APIError as error:
        if get_api_error_code(error) in {"42703", "PGRST204", "PGRST205"}:
            return False
        raise


def slugify(value: str) -> str:
    lowered = value.strip().lower()
    cleaned = SLUG_RE.sub("-", lowered)
    return cleaned.strip("-") or "section"


def make_draft_id(textbook_slug: str, draft_slug: str) -> str:
    return f"{textbook_slug}:{draft_slug}"


def split_draft_id(draft_id: str) -> tuple[str, str]:
    if ":" not in draft_id:
        raise TextbookDraftError(f"교재 초안 ID 형식을 이해하지 못했습니다: {draft_id}")
    textbook_slug, draft_slug = draft_id.split(":", 1)
    return textbook_slug, draft_slug


def load_json(path: Path) -> Any:
    if not path.exists():
        raise TextbookDraftError(f"파일을 찾지 못했습니다: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def get_textbook_dir(textbook_slug: str) -> Path:
    textbook_dir = TEXTBOOK_ROOT / textbook_slug
    if not textbook_dir.exists():
        raise TextbookDraftError(f"교재 디렉터리를 찾지 못했습니다: {textbook_slug}")
    return textbook_dir


def is_valid_image_file(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except Exception:
        return False


def fetch_remote_text(url: str) -> str:
    try:
        request = Request(url, headers=REQUEST_HEADERS)
        with urlopen(request, timeout=30) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")
    except Exception:
        response = subprocess.run(
            ["curl", "-L", "-sS", url],
            check=True,
            capture_output=True,
            text=False,
        )
        return response.stdout.decode("utf-8", errors="replace")


def parse_viewport_size(xhtml_text: str) -> tuple[int, int] | None:
    viewport_match = re.search(r'content="width=(\d+),\s*height=(\d+)"', xhtml_text)
    if viewport_match:
        return int(viewport_match.group(1)), int(viewport_match.group(2))

    style_match = re.search(r'body[^>]*width:(\d+)px;\s*height:(\d+)px', xhtml_text)
    if style_match:
        return int(style_match.group(1)), int(style_match.group(2))

    return None


def xhtml_body_is_blank(xhtml_text: str) -> bool:
    body_match = re.search(r"<body[^>]*>(.*?)</body>", xhtml_text, flags=re.IGNORECASE | re.DOTALL)
    if not body_match:
        return False
    body = body_match.group(1)
    stripped = re.sub(r"<[^>]+>", "", body)
    return not stripped.strip()


def parse_css_boxes(css_text: str) -> dict[str, tuple[int, int, int, int]]:
    boxes: dict[str, tuple[int, int, int, int]] = {}
    for match in re.finditer(
        r"\.(?P<name>[A-Za-z0-9_-]+)\s*\{[^}]*left:(?P<left>\d+)px;[^}]*top:(?P<top>\d+)px;[^}]*width:(?P<width>\d+)px;[^}]*height:(?P<height>\d+)px;[^}]*\}",
        css_text,
    ):
        boxes[match.group("name")] = (
            int(match.group("left")),
            int(match.group("top")),
            int(match.group("width")),
            int(match.group("height")),
        )
    return boxes


def parse_xhtml_fragments(xhtml_text: str) -> list[tuple[str, str]]:
    fragments: list[tuple[str, str]] = []
    for match in re.finditer(
        r'<div[^>]*class="(?P<class_name>[^"]+)"[^>]*>\s*<img[^>]*src="(?P<src>[^"]+)"',
        xhtml_text,
        flags=re.IGNORECASE,
    ):
        fragments.append((match.group("class_name"), match.group("src")))
    return fragments


def fetch_remote_bytes(url: str) -> bytes:
    try:
        request = Request(url, headers=REQUEST_HEADERS)
        with urlopen(request, timeout=30) as response:
            return response.read()
    except Exception:
        response = subprocess.run(
            ["curl", "-L", "-sS", url],
            check=True,
            capture_output=True,
            text=False,
        )
        return response.stdout


def render_page_from_xhtml(textbook_slug: str, page_number: int, page_path: Path, page_meta: dict[str, Any]) -> Path | None:
    xhtml_url = str(page_meta.get("xhtml_url") or "")
    if not xhtml_url:
        return None

    xhtml_text = fetch_remote_text(xhtml_url)
    viewport = parse_viewport_size(xhtml_text)
    if not viewport:
        return None

    if xhtml_body_is_blank(xhtml_text):
        return write_blank_page_image(page_path, viewport)

    css_match = re.search(r'href="(?P<href>css/[^"]+)"[^>]*id="page_css"|id="page_css"[^>]*href="(?P<href_alt>css/[^"]+)"', xhtml_text)
    css_href = (css_match.group("href") if css_match and css_match.groupdict().get("href") else None) or (
        css_match.group("href_alt") if css_match and css_match.groupdict().get("href_alt") else None
    )
    if not css_href:
        return None

    css_text = fetch_remote_text(urljoin(xhtml_url, css_href))
    boxes = parse_css_boxes(css_text)
    fragments = parse_xhtml_fragments(xhtml_text)
    if not boxes or not fragments:
        return None

    canvas = Image.new("RGBA", viewport, (255, 255, 255, 255))
    pasted = 0
    for class_name, src in fragments:
        box = boxes.get(class_name)
        if not box:
            continue
        left, top, width, height = box
        try:
            payload = fetch_remote_bytes(urljoin(xhtml_url, src))
            with Image.open(BytesIO(payload)) as fragment:
                fragment_image = fragment.convert("RGBA")
                if fragment_image.size != (width, height):
                    fragment_image = fragment_image.resize((width, height))
                canvas.alpha_composite(fragment_image, (left, top))
            pasted += 1
        except Exception:
            continue

    if pasted == 0:
        return None

    page_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(page_path, format="PNG")
    canvas.close()
    return page_path


def infer_neighbor_page_size(textbook_dir: Path, page_number: int) -> tuple[int, int]:
    for offset in (1, -1, 2, -2, 3, -3):
        neighbor = textbook_dir / "pages" / f"page{page_number + offset:05d}.png"
        if not is_valid_image_file(neighbor):
            continue
        with Image.open(neighbor) as image:
            return image.size
    return 1240, 1623


def write_blank_page_image(path: Path, size: tuple[int, int]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", size, "white")
    image.save(path, format="PNG")
    image.close()
    return path


def repair_textbook_page_asset(textbook_slug: str, page_number: int) -> Path | None:
    textbook_dir = get_textbook_dir(textbook_slug)
    page_path = textbook_dir / "pages" / f"page{page_number:05d}.png"
    manifest = get_manifest(textbook_slug)
    page_meta = next(
        (
            page
            for page in manifest.get("pages", [])
            if int(page.get("page_number") or 0) == int(page_number)
        ),
        None,
    )
    if not page_meta:
        return None

    try:
        rendered = render_page_from_xhtml(textbook_slug, page_number, page_path, page_meta)
        if rendered:
            return rendered
    except Exception:
        pass

    blank_split_page = str(page_meta.get("xhtml_href") or "").endswith("_2.xhtml")
    if blank_split_page:
        size = infer_neighbor_page_size(textbook_dir, page_number)
        return write_blank_page_image(page_path, size)

    return None


def get_textbook_page_path(textbook_slug: str, page_number: int) -> Path:
    textbook_dir = get_textbook_dir(textbook_slug)
    page_path = textbook_dir / "pages" / f"page{page_number:05d}.png"
    if page_path.exists() and is_valid_image_file(page_path):
        return page_path

    repaired = repair_textbook_page_asset(textbook_slug, page_number)
    if repaired and is_valid_image_file(repaired):
        return repaired

    if not page_path.exists():
        raise TextbookDraftError(f"교재 페이지 이미지를 찾지 못했습니다: {textbook_slug} {page_number}p")
    raise TextbookDraftError(f"교재 페이지 이미지가 손상되었습니다: {textbook_slug} {page_number}p")
    return page_path


def get_textbook_pdf_path(textbook_slug: str) -> Path:
    textbook_dir = get_textbook_dir(textbook_slug)
    manifest = get_manifest(textbook_slug)
    local_pdf_path = manifest.get("local_pdf_path")
    if not local_pdf_path:
        raise TextbookDraftError(f"교재 PDF를 찾지 못했습니다: {textbook_slug}")

    pdf_path = textbook_dir / str(local_pdf_path)
    if not pdf_path.exists():
        raise TextbookDraftError(f"교재 PDF 파일이 존재하지 않습니다: {textbook_slug}")
    return pdf_path


def get_manifest(textbook_slug: str) -> dict[str, Any]:
    return load_json(get_textbook_dir(textbook_slug) / "manifest.json")


def get_sections(textbook_slug: str) -> list[dict[str, Any]]:
    sections_path = get_textbook_dir(textbook_slug) / "sections.json"
    if not sections_path.exists():
        return []
    data = load_json(sections_path)
    return data if isinstance(data, list) else []


def get_draft_path(textbook_slug: str, draft_slug: str) -> Path:
    textbook_dir = get_textbook_dir(textbook_slug)
    exact = textbook_dir / "exam_drafts" / f"{draft_slug}.json"
    if exact.exists():
        return exact

    matches = sorted((textbook_dir / "exam_drafts").glob("*.json"))
    for path in matches:
        if slugify(path.stem) == slugify(draft_slug):
            return path
    raise TextbookDraftError(f"교재 초안 파일을 찾지 못했습니다: {textbook_slug}/{draft_slug}")


def normalize_due_at(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    value = raw_value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return f"{value}T23:59:00+09:00"
    return value


def normalize_publish_at(raw_value: str | None) -> str | None:
    if not raw_value:
        return None
    value = raw_value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return f"{value}T09:00:00+09:00"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value):
        return f"{value}:00+09:00"
    return value


def build_page_asset_urls(textbook_slug: str, source_pages: list[int]) -> list[str]:
    unique_pages = sorted({int(page) for page in source_pages if isinstance(page, int) or str(page).isdigit()})
    return [f"/api/exams/textbooks/{textbook_slug}/pages/{page_number}" for page_number in unique_pages]


def pick_section_meta(textbook_slug: str, draft_title: str, source_pages: list[int]) -> tuple[str | None, int | None, int | None]:
    sections = get_sections(textbook_slug)
    if sections:
        normalized_title = draft_title.strip()
        for section in sections:
            if section.get("title") == normalized_title:
                return section.get("title"), section.get("page_start"), section.get("page_end")

    if source_pages:
        ordered = sorted({int(page) for page in source_pages})
        return draft_title, ordered[0], ordered[-1]
    return draft_title, None, None


def draft_to_markdown(draft: dict[str, Any], *, section_title: str | None = None) -> str:
    title = draft.get("title") or "교재 기반 시험"
    description = draft.get("description") or ""
    questions = draft.get("questions") or []
    total_points = len(questions) * 10 if questions else 0
    lines = [
        f"TITLE: {title}",
        f"DESCRIPTION: {description}",
        f"DATE: {datetime.now(timezone.utc).date().isoformat()}",
        "DURATION: 30",
        f"TOTAL_POINTS: {total_points}",
    ]

    for question in questions:
        lines.extend(
            [
                "",
                "---",
                f"CONCEPT: {question.get('concept', section_title or '교재 기반 학습')}",
                "DIFFICULTY: medium",
                "POINTS: 10",
                f"QUESTION: {question.get('prompt', '')}",
            ]
        )
        for choice in question.get("choices", []):
            lines.append(f"{choice.get('label', 'A')}. {choice.get('text', '')}")
        lines.append(f"ANSWER: {question.get('answer', '')}")
        explanation = question.get("explanation")
        if explanation:
            lines.append(f"EXPLANATION: {explanation}")

    return "\n".join(lines).strip() + "\n"


def list_textbook_drafts() -> list[dict[str, Any]]:
    drafts: list[dict[str, Any]] = []
    for draft_path in sorted(TEXTBOOK_ROOT.glob("*/exam_drafts/*.json")):
        textbook_slug = draft_path.parent.parent.name
        manifest = get_manifest(textbook_slug)
        if not manifest.get("local_pdf_path"):
            continue
        payload = load_json(draft_path)
        questions = payload.get("questions") or []
        source_pages = sorted(
            {
                int(page)
                for question in questions
                for page in question.get("source_pages", [])
                if isinstance(page, int) or str(page).isdigit()
            }
        )
        section_title, page_start, page_end = pick_section_meta(textbook_slug, draft_path.stem.replace("-", " "), source_pages)
        drafts.append(
            {
                "id": make_draft_id(textbook_slug, draft_path.stem),
                "draft_slug": draft_path.stem,
                "textbook_slug": textbook_slug,
                "textbook_title": manifest.get("subject_label") or manifest.get("title") or textbook_slug,
                "book_title": manifest.get("title") or textbook_slug,
                "title": payload.get("title") or draft_path.stem,
                "description": payload.get("description") or "",
                "section_title": section_title or payload.get("title") or draft_path.stem,
                "question_count": len(questions),
                "source_pages": source_pages,
                "page_start": page_start,
                "page_end": page_end,
                "has_local_pdf": bool(manifest.get("local_pdf_path")),
                "generated_markdown": draft_to_markdown(payload, section_title=section_title),
            }
        )
    return drafts


def get_textbook_draft_detail(draft_id: str) -> dict[str, Any]:
    textbook_slug, draft_slug = split_draft_id(draft_id)
    draft_path = get_draft_path(textbook_slug, draft_slug)
    manifest = get_manifest(textbook_slug)
    payload = load_json(draft_path)
    questions = payload.get("questions") or []
    all_source_pages = sorted(
        {
            int(page)
            for question in questions
            for page in question.get("source_pages", [])
            if isinstance(page, int) or str(page).isdigit()
        }
    )
    section_title, page_start, page_end = pick_section_meta(textbook_slug, draft_path.stem.replace("-", " "), all_source_pages)

    question_rows: list[dict[str, Any]] = []
    for index, question in enumerate(questions, start=1):
        source_pages = [
            int(page)
            for page in question.get("source_pages", [])
            if isinstance(page, int) or str(page).isdigit()
        ]
        source_chunk_ids: list[str] = []
        source_chunk_previews: list[dict[str, Any]] = []
        try:
            from app.services.textbook_catalog_service import list_chunk_previews, resolve_question_chunk_ids

            source_chunk_ids = resolve_question_chunk_ids(
                textbook_slug=textbook_slug,
                source_pages=source_pages,
                evidence_excerpt=question.get("evidence_excerpt"),
                section_title=section_title,
            )
            source_chunk_previews = list_chunk_previews(source_chunk_ids)
        except Exception:  # noqa: BLE001
            source_chunk_ids = []
            source_chunk_previews = []
        question_rows.append(
            {
                "id": f"{draft_id}:{index}",
                "question_order": index,
                "concept_tag": question.get("concept") or section_title or payload.get("title") or "교재 기반 학습",
                "prompt": question.get("prompt") or "",
                "choices": question.get("choices") or [],
                "correct_choice": question.get("answer"),
                "explanation": question.get("explanation"),
                "source_pages": source_pages,
                "evidence_excerpt": question.get("evidence_excerpt"),
                "source_chunk_ids": source_chunk_ids,
                "source_chunk_previews": source_chunk_previews,
                "page_asset_urls": build_page_asset_urls(textbook_slug, source_pages),
            }
        )

    return {
        "draft": {
            "id": draft_id,
            "draft_slug": draft_path.stem,
            "textbook_slug": textbook_slug,
            "textbook_title": manifest.get("subject_label") or manifest.get("title") or textbook_slug,
            "book_title": manifest.get("title") or textbook_slug,
            "title": payload.get("title") or draft_path.stem,
            "description": payload.get("description") or "",
            "section_title": section_title or payload.get("title") or draft_path.stem,
            "page_start": page_start,
            "page_end": page_end,
            "source_pages": all_source_pages,
            "local_pdf_path": manifest.get("local_pdf_path"),
            "generated_markdown": draft_to_markdown(payload, section_title=section_title),
        },
        "questions": question_rows,
    }


def create_exam_notifications_for_published_exam(exam: dict[str, Any]) -> int:
    enrollments = safe_rows(
        lambda: supabase.table("enrollments")
        .select("student_id")
        .eq("course_id", exam["course_id"])
    )
    if not enrollments:
        return 0

    try:
        existing = safe_rows(
            lambda: supabase.table("notifications")
            .select("student_id, notification_type")
            .eq("exam_id", exam["id"])
        )
    except APIError as error:
        if get_api_error_code(error) == "PGRST205":
            return 0
        raise
    existing_keys = {(row["student_id"], row["notification_type"]) for row in existing}

    rows = []
    for enrollment in enrollments:
        key = (enrollment["student_id"], "assignment_assigned")
        if key in existing_keys:
            continue
        rows.append(
            {
                "course_id": exam["course_id"],
                "student_id": enrollment["student_id"],
                "exam_id": exam["id"],
                "notification_type": "assignment_assigned",
                "message": f"'{exam['title']}' 과제가 배포되었습니다. 마감 전에 응시해보세요.",
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


def import_textbook_draft_to_exam(
    course_id: str,
    draft_id: str,
    *,
    created_by: str | None = None,
    workflow_status: str = "draft",
    assignment_type: str = "homework",
    publish_at: str | None = None,
    due_at: str | None = None,
    assignment_note: str | None = None,
) -> dict[str, Any]:
    detail = get_textbook_draft_detail(draft_id)
    draft = detail["draft"]
    questions = detail["questions"]
    catalog_scope = {
        "textbook_id": None,
        "textbook_toc_node_id": None,
    }
    chunk_column_available = exam_question_chunk_column_available()
    resolve_chunk_ids = None

    try:
        from app.services.textbook_catalog_service import resolve_question_chunk_ids, resolve_textbook_catalog_scope

        resolve_chunk_ids = resolve_question_chunk_ids
        catalog_scope = resolve_textbook_catalog_scope(
            textbook_slug=draft["textbook_slug"],
            section_title=draft["section_title"],
            page_start=draft.get("page_start"),
            page_end=draft.get("page_end"),
        )
    except Exception:  # noqa: BLE001
        catalog_scope = {
            "textbook_id": None,
            "textbook_toc_node_id": None,
        }

    if workflow_status not in {"draft", "reviewed", "scheduled", "published", "archived"}:
        raise TextbookDraftError(f"지원하지 않는 workflow_status 입니다: {workflow_status}")
    if assignment_type not in {"exam", "homework"}:
        raise TextbookDraftError(f"지원하지 않는 assignment_type 입니다: {assignment_type}")

    exam_id = str(uuid4())
    created_at = datetime.now(timezone.utc)
    normalized_due_at = normalize_due_at(due_at)
    normalized_publish_at = normalize_publish_at(publish_at)
    published_at = (
        normalized_publish_at
        if workflow_status == "scheduled"
        else created_at.isoformat() if workflow_status == "published" else None
    )
    total_points = len(questions) * 10
    exam_row = {
        "id": exam_id,
        "course_id": course_id,
        "title": draft["title"],
        "description": draft["description"],
        "exam_date": created_at.isoformat(),
        "duration_minutes": max(20, min(60, len(questions) * 3)),
        "total_points": total_points,
        "source_name": draft["draft_slug"],
        "source_format": "textbook_generated",
        "created_by": created_by,
        "created_at": created_at.isoformat(),
        "workflow_status": workflow_status,
        "assignment_type": assignment_type,
        "due_at": normalized_due_at,
        "published_at": published_at,
        "textbook_slug": draft["textbook_slug"],
        "textbook_title": draft["textbook_title"],
        "textbook_id": catalog_scope["textbook_id"],
        "textbook_toc_node_id": catalog_scope["textbook_toc_node_id"],
        "section_title": draft["section_title"],
        "section_page_start": draft.get("page_start"),
        "section_page_end": draft.get("page_end"),
        "assignment_note": assignment_note,
    }
    question_rows = []
    for question in questions:
        question_rows.append(
            {
                "id": str(uuid4()),
                "exam_id": exam_id,
                "question_order": question["question_order"],
                "concept_tag": question["concept_tag"],
                "prompt": question["prompt"],
                "choices": question["choices"],
                "correct_choice": question["correct_choice"],
                "explanation": question.get("explanation"),
                "difficulty": "medium",
                "points": 10,
                "created_at": created_at.isoformat(),
                "source_pages": question.get("source_pages", []),
                "evidence_excerpt": question.get("evidence_excerpt"),
                "source_textbook_slug": draft["textbook_slug"],
                "source_section_title": draft["section_title"],
                **(
                    {
                        "source_chunk_ids": resolve_chunk_ids(
                            textbook_slug=draft["textbook_slug"],
                            source_pages=question.get("source_pages", []),
                            evidence_excerpt=question.get("evidence_excerpt"),
                            section_title=draft["section_title"],
                        )
                    }
                    if chunk_column_available and resolve_chunk_ids
                    else {}
                ),
            }
        )

    try:
        supabase.table("exams").insert(exam_row).execute()
        if question_rows:
            supabase.table("exam_questions").insert(question_rows).execute()
    except APIError as error:
        raise TextbookDraftError(
            "교재 기반 시험용 DB 스키마가 아직 준비되지 않았습니다. "
            "backend/supabase/migrations/005_textbook_assignment_pipeline.sql 을 먼저 적용해주세요."
        ) from error

    notifications_created = 0
    if workflow_status == "published":
        notifications_created = create_exam_notifications_for_published_exam(exam_row)

    return {
        "exam": exam_row,
        "question_count": len(question_rows),
        "notifications_created": notifications_created,
    }


def import_all_textbook_drafts(
    course_id: str,
    *,
    created_by: str | None = None,
    workflow_status: str = "draft",
    assignment_type: str = "homework",
    publish_at: str | None = None,
    due_at: str | None = None,
) -> dict[str, Any]:
    created: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for draft in list_textbook_drafts():
        try:
            result = import_textbook_draft_to_exam(
                course_id,
                draft["id"],
                created_by=created_by,
                workflow_status=workflow_status,
                assignment_type=assignment_type,
                publish_at=publish_at,
                due_at=due_at,
            )
            created.append(result["exam"])
        except Exception as error:  # noqa: BLE001
            failed.append({"draft_id": draft["id"], "error": str(error)})

    return {
        "created": created,
        "failed": failed,
    }


def default_due_at(days: int = 7) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
