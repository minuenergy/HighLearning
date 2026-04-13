from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings
from app.services.textbook_exam_service import (
    TEXTBOOK_ROOT,
    get_manifest,
    get_sections,
    get_textbook_dir,
    slugify,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
UTC = timezone.utc
CHUNK_TARGET_LENGTH = 420
CHUNK_MAX_LENGTH = 640
CHUNK_PREVIEW_LENGTH = 220
AUTO_SECTION_OBJECTIVE = "원본 단원 구조 파일이 없어 페이지 범위를 기준으로 자동 생성했습니다."
AUTO_DRAFT_SECTION_OBJECTIVE = "원본 단원 구조 파일이 없어 기존 AI 초안 범위를 기준으로 자동 생성했습니다."


class TextbookCatalogError(ValueError):
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
        if get_api_error_code(error) in {"PGRST205", "PGRST204"}:
            return []
        raise

    return result.data or []


def safe_single(builder) -> dict | None:
    rows = safe_rows(builder)
    return rows[0] if rows else None


def catalog_tables_available() -> bool:
    try:
        supabase.table("textbooks").select("id").limit(1).execute()
        return True
    except APIError as error:
        if get_api_error_code(error) in {"42P01", "PGRST205", "PGRST204"}:
            return False
        raise


def stable_textbook_id(textbook_slug: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"socrateach:textbook:{textbook_slug}"))


def stable_toc_node_id(textbook_slug: str, title: str, page_start: int | None, page_end: int | None) -> str:
    page_range = f"{page_start or 0}:{page_end or 0}"
    return str(uuid5(NAMESPACE_URL, f"socrateach:textbook:{textbook_slug}:toc:{slugify(title)}:{page_range}"))


def stable_textbook_page_id(textbook_slug: str, page_number: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"socrateach:textbook:{textbook_slug}:page:{page_number}"))


def stable_textbook_chunk_id(textbook_slug: str, page_number: int, chunk_order: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"socrateach:textbook:{textbook_slug}:page:{page_number}:chunk:{chunk_order}"))


def normalize_space(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def clip_text(value: str | None, limit: int = CHUNK_PREVIEW_LENGTH) -> str:
    normalized = normalize_space(value)
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(0, limit - 1)].rstrip() + "…"


def tokenize_match_text(value: str | None) -> set[str]:
    normalized = normalize_space(value).lower()
    return {token for token in re.findall(r"[0-9A-Za-z가-힣]+", normalized) if len(token) >= 2}


def split_large_text_block(text: str) -> list[str]:
    normalized = normalize_space(text)
    if not normalized:
        return []

    chunks: list[str] = []
    remaining = normalized
    while len(remaining) > CHUNK_MAX_LENGTH:
        split_at = remaining.rfind(". ", 0, CHUNK_TARGET_LENGTH)
        if split_at < 120:
            split_at = remaining.rfind(" ", 0, CHUNK_TARGET_LENGTH)
        if split_at < 120:
            split_at = CHUNK_TARGET_LENGTH
        chunk = remaining[:split_at].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_at:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def split_textbook_chunks(text: str | None) -> list[str]:
    raw_text = str(text or "")
    if not raw_text.strip():
        return []

    blocks = [normalize_space(block) for block in re.split(r"\n{2,}", raw_text) if normalize_space(block)]
    if not blocks:
        blocks = [normalize_space(raw_text)]

    chunks: list[str] = []
    current = ""
    for block in blocks:
        candidate = f"{current}\n\n{block}".strip() if current else block
        if len(candidate) <= CHUNK_TARGET_LENGTH:
            current = candidate
            continue

        if current:
            chunks.extend(split_large_text_block(current))
        current = block

    if current:
        chunks.extend(split_large_text_block(current))
    return [chunk for chunk in chunks if chunk]


def resolve_textbook_catalog_scope(
    *,
    textbook_slug: str | None,
    section_title: str | None = None,
    page_start: int | None = None,
    page_end: int | None = None,
) -> dict[str, str | None]:
    if not textbook_slug or not catalog_tables_available():
        return {
            "textbook_id": None,
            "textbook_toc_node_id": None,
        }

    textbook = safe_single(
        lambda: supabase.table("textbooks")
        .select("id, slug")
        .eq("slug", textbook_slug)
    )
    if not textbook:
        return {
            "textbook_id": None,
            "textbook_toc_node_id": None,
        }

    toc_node_id: str | None = None
    nodes = safe_rows(
        lambda: supabase.table("textbook_toc_nodes")
        .select("id, title, slug, page_start, page_end")
        .eq("textbook_id", textbook["id"])
        .order("node_order")
    )
    normalized_title = str(section_title or "").strip()
    normalized_slug = slugify(normalized_title) if normalized_title else None

    if normalized_title:
        exact_title_match = next((node for node in nodes if str(node.get("title") or "").strip() == normalized_title), None)
        if exact_title_match:
            toc_node_id = exact_title_match["id"]

    if not toc_node_id and normalized_slug:
        slug_match = next((node for node in nodes if node.get("slug") == normalized_slug), None)
        if slug_match:
            toc_node_id = slug_match["id"]

    if not toc_node_id and page_start is not None and page_end is not None:
        exact_range_match = next(
            (
                node
                for node in nodes
                if node.get("page_start") == page_start and node.get("page_end") == page_end
            ),
            None,
        )
        if exact_range_match:
            toc_node_id = exact_range_match["id"]

    if not toc_node_id and page_start is not None:
        overlapping_match = next(
            (
                node
                for node in nodes
                if isinstance(node.get("page_start"), int)
                and isinstance(node.get("page_end"), int)
                and node["page_start"] <= page_start <= node["page_end"]
            ),
            None,
        )
        if overlapping_match:
            toc_node_id = overlapping_match["id"]

    return {
        "textbook_id": textbook["id"],
        "textbook_toc_node_id": toc_node_id,
    }


def textbook_chunk_column_available() -> bool:
    try:
        supabase.table("textbook_chunks").select("id").limit(1).execute()
        return True
    except APIError as error:
        if get_api_error_code(error) in {"42P01", "PGRST205", "PGRST204"}:
            return False
        raise


def exam_question_chunk_column_available() -> bool:
    try:
        supabase.table("exam_questions").select("source_chunk_ids").limit(1).execute()
        return True
    except APIError as error:
        if get_api_error_code(error) in {"42703", "PGRST204", "PGRST205"}:
            return False
        raise


def list_textbook_slugs() -> list[str]:
    return sorted(
        path.name
        for path in TEXTBOOK_ROOT.iterdir()
        if path.is_dir() and (path / "manifest.json").exists()
    )


def read_ocr_page_map(textbook_slug: str) -> dict[int, dict[str, Any]]:
    textbook_dir = get_textbook_dir(textbook_slug)
    ocr_path = textbook_dir / "ocr_pages.jsonl"
    if not ocr_path.exists():
        return {}

    rows: dict[int, dict[str, Any]] = {}
    for line in ocr_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
            page_number = int(payload.get("page_number") or 0)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if page_number <= 0:
            continue
        rows[page_number] = payload
    return rows


def build_textbook_row(textbook_slug: str) -> dict[str, Any]:
    manifest = get_manifest(textbook_slug)
    if not manifest.get("local_pdf_path"):
        raise TextbookCatalogError(f"PDF 원본이 없는 교재는 카탈로그에 연결할 수 없습니다: {textbook_slug}")
    return {
        "id": stable_textbook_id(textbook_slug),
        "slug": textbook_slug,
        "title": manifest.get("title") or textbook_slug,
        "book_title": manifest.get("title") or textbook_slug,
        "subject_label": manifest.get("subject_label") or textbook_slug,
        "viewer_url": manifest.get("viewer_url"),
        "short_url": manifest.get("short_url"),
        "local_pdf_path": manifest.get("local_pdf_path"),
        "page_count": int(manifest.get("page_count") or 0),
        "source_type": "filesystem",
        "metadata": {
            "opf_url": manifest.get("opf_url"),
            "toc_url": manifest.get("toc_url"),
        },
        "synced_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


def build_generated_toc_sections_from_drafts(textbook_slug: str) -> list[dict[str, Any]]:
    draft_dir = get_textbook_dir(textbook_slug) / "exam_drafts"
    if not draft_dir.exists():
        return []

    sections: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for draft_path in sorted(draft_dir.glob("*.json")):
        try:
            payload = json.loads(draft_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        source_pages = sorted(
            {
                int(page)
                for question in (payload.get("questions") or [])
                for page in (question.get("source_pages") or [])
                if isinstance(page, int) or str(page).isdigit()
            }
        )
        if not source_pages:
            continue

        title = normalize_space(payload.get("title") or draft_path.stem.replace("-", " "))
        page_start = source_pages[0]
        page_end = source_pages[-1]
        section_key = (title or f"자동 생성 단원 {len(sections) + 1}", page_start, page_end)
        if section_key in seen:
            continue
        seen.add(section_key)
        sections.append(
            {
                "title": section_key[0],
                "page_start": page_start,
                "page_end": page_end,
                "learning_objective": AUTO_DRAFT_SECTION_OBJECTIVE,
                "metadata": {
                    "generated": True,
                    "strategy": "exam_drafts",
                },
            }
        )

    return sorted(sections, key=lambda row: (int(row["page_start"]), int(row["page_end"]), str(row["title"])))


def build_generated_toc_sections_from_page_ranges(textbook_slug: str) -> list[dict[str, Any]]:
    manifest = get_manifest(textbook_slug)
    page_numbers = sorted(
        {
            int(page.get("page_number") or 0)
            for page in (manifest.get("pages") or [])
            if int(page.get("page_number") or 0) > 0
        }
    )
    if not page_numbers:
        return []

    total_pages = len(page_numbers)
    if total_pages <= 24:
        target_size = total_pages
    elif total_pages <= 80:
        target_size = 16
    elif total_pages <= 160:
        target_size = 20
    else:
        target_size = 24

    sections: list[dict[str, Any]] = []
    for index, start in enumerate(range(0, total_pages, target_size), start=1):
        page_slice = page_numbers[start : start + target_size]
        if not page_slice:
            continue
        title = "전체 범위" if total_pages <= 24 else f"자동 생성 단원 {index}"
        sections.append(
            {
                "title": title,
                "page_start": page_slice[0],
                "page_end": page_slice[-1],
                "learning_objective": AUTO_SECTION_OBJECTIVE,
                "metadata": {
                    "generated": True,
                    "strategy": "page_windows",
                },
            }
        )

    return sections


def resolve_toc_sections(textbook_slug: str) -> list[dict[str, Any]]:
    explicit_sections = get_sections(textbook_slug)
    if explicit_sections:
        return explicit_sections

    generated_from_drafts = build_generated_toc_sections_from_drafts(textbook_slug)
    if generated_from_drafts:
        return generated_from_drafts

    return build_generated_toc_sections_from_page_ranges(textbook_slug)


def build_toc_rows(textbook_slug: str) -> list[dict[str, Any]]:
    textbook_id = stable_textbook_id(textbook_slug)
    rows: list[dict[str, Any]] = []
    for index, section in enumerate(resolve_toc_sections(textbook_slug), start=1):
        title = str(section.get("title") or "").strip()
        if not title:
            continue
        page_start = int(section.get("page_start") or 0) or None
        page_end = int(section.get("page_end") or 0) or None
        rows.append(
            {
                "id": stable_toc_node_id(textbook_slug, title, page_start, page_end),
                "textbook_id": textbook_id,
                "parent_id": None,
                "depth": 1,
                "node_order": index,
                "title": title,
                "slug": slugify(title),
                "page_start": page_start,
                "page_end": page_end,
                "learning_objective": section.get("learning_objective"),
                "metadata": section.get("metadata") or {},
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )
    return rows


def build_page_rows(textbook_slug: str) -> list[dict[str, Any]]:
    manifest = get_manifest(textbook_slug)
    textbook_id = stable_textbook_id(textbook_slug)
    ocr_page_map = read_ocr_page_map(textbook_slug)
    rows: list[dict[str, Any]] = []

    for page in manifest.get("pages") or []:
        try:
            page_number = int(page.get("page_number") or 0)
        except (TypeError, ValueError):
            continue
        if page_number <= 0:
            continue

        ocr_page = ocr_page_map.get(page_number, {})
        rows.append(
            {
                "id": stable_textbook_page_id(textbook_slug, page_number),
                "textbook_id": textbook_id,
                "page_number": page_number,
                "page_label": f"{page_number}p",
                "image_path": page.get("image_path"),
                "text_path": page.get("text_path"),
                "text_preview": (ocr_page.get("preview") or page.get("text_preview") or "")[:240] or None,
                "text_content": ocr_page.get("text"),
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )
    return rows


def build_chunk_rows(textbook_slug: str) -> list[dict[str, Any]]:
    if not textbook_chunk_column_available():
        return []

    textbook_id = stable_textbook_id(textbook_slug)
    toc_rows = build_toc_rows(textbook_slug)
    page_rows = build_page_rows(textbook_slug)
    rows: list[dict[str, Any]] = []

    for page_row in page_rows:
        page_number = int(page_row.get("page_number") or 0)
        if page_number <= 0:
            continue

        toc_node_id = next(
            (
                row["id"]
                for row in toc_rows
                if row.get("page_start") is not None
                and row.get("page_end") is not None
                and int(row["page_start"]) <= page_number <= int(row["page_end"])
            ),
            None,
        )
        text_chunks = split_textbook_chunks(page_row.get("text_content") or page_row.get("text_preview"))
        for chunk_order, chunk in enumerate(text_chunks, start=1):
            rows.append(
                {
                    "id": stable_textbook_chunk_id(textbook_slug, page_number, chunk_order),
                    "textbook_id": textbook_id,
                    "page_id": page_row["id"],
                    "toc_node_id": toc_node_id,
                    "chunk_order": chunk_order,
                    "content": chunk,
                    "metadata": {
                        "page_number": page_number,
                        "page_label": page_row.get("page_label") or f"{page_number}p",
                        "preview": clip_text(chunk),
                    },
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
    return rows


def score_chunk_match(content: str, evidence_excerpt: str | None) -> float:
    if not evidence_excerpt:
        return 1.0

    normalized_content = normalize_space(content).lower()
    normalized_excerpt = normalize_space(evidence_excerpt).lower()
    if not normalized_excerpt:
        return 1.0

    score = 0.0
    if normalized_excerpt in normalized_content:
        score += 5.0
    if normalized_content in normalized_excerpt and normalized_content:
        score += 2.0

    excerpt_tokens = tokenize_match_text(normalized_excerpt)
    if excerpt_tokens:
        content_tokens = tokenize_match_text(normalized_content)
        overlap = len(excerpt_tokens & content_tokens)
        score += overlap / max(1, len(excerpt_tokens))
    return score


def resolve_question_chunk_ids(
    *,
    textbook_slug: str | None,
    source_pages: list[int] | None,
    evidence_excerpt: str | None = None,
    section_title: str | None = None,
) -> list[str]:
    if not textbook_slug or not textbook_chunk_column_available():
        return []

    scope = resolve_textbook_catalog_scope(textbook_slug=textbook_slug, section_title=section_title)
    textbook_id = scope.get("textbook_id")
    if not textbook_id:
        return []

    page_numbers = sorted({int(page) for page in (source_pages or []) if isinstance(page, int) or str(page).isdigit()})
    rows: list[dict[str, Any]]
    if page_numbers:
        page_ids = [stable_textbook_page_id(textbook_slug, page_number) for page_number in page_numbers]
        rows = safe_rows(
            lambda: supabase.table("textbook_chunks")
            .select("id, page_id, toc_node_id, chunk_order, content, metadata")
            .in_("page_id", page_ids)
            .order("chunk_order")
        )
    elif scope.get("textbook_toc_node_id"):
        rows = safe_rows(
            lambda: supabase.table("textbook_chunks")
            .select("id, page_id, toc_node_id, chunk_order, content, metadata")
            .eq("textbook_id", textbook_id)
            .eq("toc_node_id", scope["textbook_toc_node_id"])
            .order("chunk_order")
            .limit(8)
        )
    else:
        rows = safe_rows(
            lambda: supabase.table("textbook_chunks")
            .select("id, page_id, toc_node_id, chunk_order, content, metadata")
            .eq("textbook_id", textbook_id)
            .order("chunk_order")
            .limit(8)
        )

    if not rows:
        return []

    scored = sorted(
        (
            (
                score_chunk_match(str(row.get("content") or ""), evidence_excerpt),
                int((row.get("metadata") or {}).get("page_number") or 0),
                int(row.get("chunk_order") or 0),
                row["id"],
            )
            for row in rows
        ),
        key=lambda item: (-item[0], item[1], item[2]),
    )

    matched_ids = [row_id for score, _, _, row_id in scored if score > 0][:3]
    if matched_ids:
        return matched_ids

    return [row["id"] for row in rows[: min(3, len(rows))]]


def list_chunk_previews(chunk_ids: list[str] | None) -> list[dict[str, Any]]:
    normalized_ids = [str(chunk_id) for chunk_id in (chunk_ids or []) if str(chunk_id).strip()]
    if not normalized_ids or not textbook_chunk_column_available():
        return []

    rows = safe_rows(
        lambda: supabase.table("textbook_chunks")
        .select("id, content, metadata")
        .in_("id", normalized_ids)
    )
    row_by_id = {row["id"]: row for row in rows}

    previews: list[dict[str, Any]] = []
    for chunk_id in normalized_ids:
        row = row_by_id.get(chunk_id)
        if not row:
            continue
        metadata = row.get("metadata") or {}
        previews.append(
            {
                "id": row["id"],
                "page_number": metadata.get("page_number"),
                "page_label": metadata.get("page_label"),
                "content": clip_text(row.get("content"), 320),
            }
        )
    return previews


def sync_textbook_catalog(*, textbook_slug: str | None = None) -> dict[str, Any]:
    if not catalog_tables_available():
        raise TextbookCatalogError(
            "교재 카탈로그 테이블이 없습니다. `009_textbook_catalog.sql` 마이그레이션을 적용해주세요."
        )

    if textbook_slug:
        textbook_slugs = [textbook_slug]
    else:
        textbook_slugs = [slug for slug in list_textbook_slugs() if get_manifest(slug).get("local_pdf_path")]
    synced: list[dict[str, Any]] = []

    for slug in textbook_slugs:
        if slug not in list_textbook_slugs():
            raise TextbookCatalogError(f"교재 슬러그를 찾지 못했습니다: {slug}")

        textbook_row = build_textbook_row(slug)
        toc_rows = build_toc_rows(slug)
        page_rows = build_page_rows(slug)
        chunk_rows = build_chunk_rows(slug)

        supabase.table("textbooks").upsert(textbook_row).execute()
        supabase.table("textbook_toc_nodes").delete().eq("textbook_id", textbook_row["id"]).execute()
        supabase.table("textbook_pages").delete().eq("textbook_id", textbook_row["id"]).execute()
        if textbook_chunk_column_available():
            supabase.table("textbook_chunks").delete().eq("textbook_id", textbook_row["id"]).execute()
        if toc_rows:
            supabase.table("textbook_toc_nodes").insert(toc_rows).execute()
        if page_rows:
            supabase.table("textbook_pages").insert(page_rows).execute()
        if chunk_rows:
            supabase.table("textbook_chunks").insert(chunk_rows).execute()

        synced.append(
            {
                "slug": slug,
                "textbook_id": textbook_row["id"],
                "section_count": len(toc_rows),
                "page_count": len(page_rows),
                "chunk_count": len(chunk_rows),
            }
        )

    return {
        "synced_count": len(synced),
        "textbooks": synced,
    }


def backfill_exam_catalog_scope(*, textbook_slug: str | None = None) -> dict[str, Any]:
    if not catalog_tables_available():
        raise TextbookCatalogError(
            "교재 카탈로그 테이블이 없습니다. `009_textbook_catalog.sql` 마이그레이션을 적용해주세요."
        )

    exams = safe_rows(
        lambda: supabase.table("exams")
        .select(
            "id, title, textbook_slug, section_title, section_page_start, section_page_end, "
            "textbook_id, textbook_toc_node_id"
        )
        .order("created_at", desc=True)
    )

    updated: list[dict[str, Any]] = []
    checked_count = 0
    updated_question_count = 0
    supports_question_chunks = exam_question_chunk_column_available()
    for exam in exams:
        slug = str(exam.get("textbook_slug") or "").strip() or None
        if not slug:
            continue
        if textbook_slug and slug != textbook_slug:
            continue

        checked_count += 1
        scope = resolve_textbook_catalog_scope(
            textbook_slug=slug,
            section_title=exam.get("section_title"),
            page_start=exam.get("section_page_start"),
            page_end=exam.get("section_page_end"),
        )

        update_payload: dict[str, Any] = {}
        if scope["textbook_id"] != exam.get("textbook_id"):
            update_payload["textbook_id"] = scope["textbook_id"]
        if scope["textbook_toc_node_id"] != exam.get("textbook_toc_node_id"):
            update_payload["textbook_toc_node_id"] = scope["textbook_toc_node_id"]
        if update_payload:
            supabase.table("exams").update(update_payload).eq("id", exam["id"]).execute()
            updated.append(
                {
                    "exam_id": exam["id"],
                    "title": exam.get("title") or "시험",
                    "textbook_slug": slug,
                    "section_title": exam.get("section_title"),
                    "textbook_id": update_payload.get("textbook_id", exam.get("textbook_id")),
                    "textbook_toc_node_id": update_payload.get("textbook_toc_node_id", exam.get("textbook_toc_node_id")),
                }
            )

        if supports_question_chunks:
            questions = safe_rows(
                lambda: supabase.table("exam_questions")
                .select("id, source_pages, evidence_excerpt, source_textbook_slug, source_section_title, source_chunk_ids")
                .eq("exam_id", exam["id"])
                .order("question_order")
            )
            for question in questions:
                next_chunk_ids = resolve_question_chunk_ids(
                    textbook_slug=question.get("source_textbook_slug") or slug,
                    source_pages=question.get("source_pages") or [],
                    evidence_excerpt=question.get("evidence_excerpt"),
                    section_title=question.get("source_section_title") or exam.get("section_title"),
                )
                current_chunk_ids = [str(chunk_id) for chunk_id in (question.get("source_chunk_ids") or []) if str(chunk_id).strip()]
                if next_chunk_ids == current_chunk_ids:
                    continue
                supabase.table("exam_questions").update({"source_chunk_ids": next_chunk_ids}).eq("id", question["id"]).execute()
                updated_question_count += 1

    return {
        "checked_count": checked_count,
        "updated_count": len(updated),
        "updated_question_count": updated_question_count,
        "updated": updated[:20],
    }


def list_textbook_catalog() -> list[dict[str, Any]]:
    if not catalog_tables_available():
        return [
            {
                "id": stable_textbook_id(slug),
                "slug": slug,
                "title": (get_manifest(slug).get("title") or slug),
                "book_title": (get_manifest(slug).get("title") or slug),
                "subject_label": get_manifest(slug).get("subject_label") or slug,
                "page_count": int(get_manifest(slug).get("page_count") or 0),
                "section_count": len(resolve_toc_sections(slug)),
                "source_type": "filesystem",
                "synced_at": None,
                "has_local_pdf": bool(get_manifest(slug).get("local_pdf_path")),
            }
            for slug in list_textbook_slugs()
            if get_manifest(slug).get("local_pdf_path")
        ]

    textbooks = safe_rows(
        lambda: supabase.table("textbooks")
        .select("id, slug, title, book_title, subject_label, page_count, source_type, synced_at, local_pdf_path")
        .order("subject_label")
        .order("title")
    )
    if not textbooks:
        return []

    textbook_ids = [row["id"] for row in textbooks]
    toc_rows = safe_rows(
        lambda: supabase.table("textbook_toc_nodes")
        .select("id, textbook_id")
        .in_("textbook_id", textbook_ids)
    )
    section_count_by_textbook: dict[str, int] = {}
    for row in toc_rows:
        section_count_by_textbook[row["textbook_id"]] = section_count_by_textbook.get(row["textbook_id"], 0) + 1

    return [
        {
            **row,
            "section_count": section_count_by_textbook.get(row["id"], 0),
            "has_local_pdf": bool(row.get("local_pdf_path")),
        }
        for row in textbooks
        if row.get("local_pdf_path")
    ]


def get_textbook_catalog_detail(textbook_slug: str) -> dict[str, Any]:
    if not catalog_tables_available():
        manifest = get_manifest(textbook_slug)
        if not manifest.get("local_pdf_path"):
            raise TextbookCatalogError(f"PDF 원본이 없는 교재는 카탈로그 상세를 열 수 없습니다: {textbook_slug}")
        return {
            "textbook": {
                "id": stable_textbook_id(textbook_slug),
                "slug": textbook_slug,
                "title": manifest.get("title") or textbook_slug,
                "book_title": manifest.get("title") or textbook_slug,
                "subject_label": manifest.get("subject_label") or textbook_slug,
                "page_count": int(manifest.get("page_count") or 0),
                "source_type": "filesystem",
                "synced_at": None,
                "has_local_pdf": bool(manifest.get("local_pdf_path")),
            },
            "sections": build_toc_rows(textbook_slug),
            "pages": build_page_rows(textbook_slug)[:12],
        }

    textbook = safe_single(
        lambda: supabase.table("textbooks")
        .select("*")
        .eq("slug", textbook_slug)
    )
    if not textbook:
        raise TextbookCatalogError(f"교재 카탈로그에서 찾지 못했습니다: {textbook_slug}")
    if not textbook.get("local_pdf_path"):
        raise TextbookCatalogError(f"PDF 원본이 없는 교재는 카탈로그 상세를 열 수 없습니다: {textbook_slug}")

    sections = safe_rows(
        lambda: supabase.table("textbook_toc_nodes")
        .select("*")
        .eq("textbook_id", textbook["id"])
        .order("node_order")
    )
    pages = safe_rows(
        lambda: supabase.table("textbook_pages")
        .select("id, textbook_id, page_number, page_label, image_path, text_preview")
        .eq("textbook_id", textbook["id"])
        .order("page_number")
        .limit(12)
    )

    return {
        "textbook": {
            **textbook,
            "has_local_pdf": bool(textbook.get("local_pdf_path")),
        },
        "sections": sections,
        "pages": pages,
    }
