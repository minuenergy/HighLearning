from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from html import unescape
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.utils.ocr_runtime import default_page_ocr_backend, is_macos, resolve_paddle_device


DEFAULT_CATALOG_URL = "https://thub.kumsung.co.kr/upfiles/thub/2020/middle.html"
DEFAULT_OUT_DIR = BACKEND_ROOT / "data" / "kumsung_middle"
VISION_OCR_SOURCE = Path(__file__).with_name("vision_ocr.swift")
VISION_OCR_BINARY = BACKEND_ROOT / ".vision-ocr" / "vision_ocr"
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
EPUB_NS = {"opf": "http://www.idpf.org/2007/opf", "dc": "http://purl.org/dc/elements/1.1/"}


@dataclass
class CatalogEntry:
    title: str
    short_url: str
    viewer_url: str
    subject_label: str
    slug: str


@dataclass
class PageAsset:
    page_number: int
    xhtml_href: str
    xhtml_url: str
    image_url: str
    image_path: str | None = None
    text_path: str | None = None
    text_preview: str | None = None


@dataclass
class BookManifest:
    title: str
    slug: str
    subject_label: str
    viewer_url: str
    short_url: str
    opf_url: str
    toc_url: str
    page_count: int
    pages: list[PageAsset]
    local_pdf_path: str | None = None


_WORKER_PIPELINE: Any | None = None


def chunked_paths(items: list[Path], batch_size: int) -> list[list[Path]]:
    safe_batch_size = max(1, batch_size)
    return [items[index : index + safe_batch_size] for index in range(0, len(items), safe_batch_size)]


def ensure_vision_ocr_binary() -> Path:
    binary = VISION_OCR_BINARY
    source = VISION_OCR_SOURCE
    if binary.exists() and binary.stat().st_mtime >= source.stat().st_mtime:
        return binary

    binary.parent.mkdir(parents=True, exist_ok=True)
    module_cache_dir = BACKEND_ROOT / ".swift-module-cache"
    module_cache_dir.mkdir(parents=True, exist_ok=True)
    compile_env = os.environ.copy()
    compile_env.setdefault("SWIFT_MODULECACHE_PATH", str(module_cache_dir))
    compile_env.setdefault("CLANG_MODULE_CACHE_PATH", str(module_cache_dir))
    subprocess.run(
        ["swiftc", "-O", str(source), "-o", str(binary)],
        check=True,
        env=compile_env,
    )
    return binary


class CatalogTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[dict[str, str | None]]] = []
        self._row: list[dict[str, str | None]] = []
        self._cell: dict[str, str | None] | None = None
        self._text_parts: list[str] = []
        self._in_td = False
        self._in_a = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        if tag == "tr":
            self._row = []
        elif tag == "td":
            self._in_td = True
            self._cell = {"text": "", "href": None, "title": None}
            self._text_parts = []
        elif tag == "a" and self._in_td and self._cell is not None:
            self._in_a = True
            self._cell["href"] = attr_map.get("href")
            self._cell["title"] = attr_map.get("title")

    def handle_data(self, data: str) -> None:
        if self._in_td:
            self._text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._in_a = False
        elif tag == "td":
            if self._cell is not None:
                text = normalize_space("".join(self._text_parts))
                self._cell["text"] = text
                self._row.append(self._cell)
            self._cell = None
            self._text_parts = []
            self._in_td = False
        elif tag == "tr":
            if any(cell.get("href") for cell in self._row):
                self.rows.append(self._row)
            self._row = []


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^\w\s-]", "", value.strip().lower())
    return re.sub(r"[-\s]+", "-", cleaned).strip("-") or "book"


def fetch_text(url: str) -> tuple[str, str]:
    try:
        request = Request(url, headers=REQUEST_HEADERS)
        with urlopen(request, timeout=60) as response:
            final_url = response.geturl()
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace"), final_url
    except Exception:
        return fetch_text_via_curl(url)


def fetch_bytes(url: str) -> bytes:
    try:
        request = Request(url, headers=REQUEST_HEADERS)
        with urlopen(request, timeout=60) as response:
            return response.read()
    except Exception:
        return fetch_bytes_via_curl(url)


def fetch_text_via_curl(url: str) -> tuple[str, str]:
    response = subprocess.run(
        ["curl", "-L", "-sS", url],
        check=True,
        capture_output=True,
        text=False,
    )
    payload = response.stdout
    return payload.decode("utf-8", errors="replace"), resolve_final_url_via_curl(url)


def fetch_bytes_via_curl(url: str) -> bytes:
    response = subprocess.run(
        ["curl", "-L", "-sS", url],
        check=True,
        capture_output=True,
        text=False,
    )
    return response.stdout


def resolve_final_url_via_curl(url: str) -> str:
    response = subprocess.run(
        ["curl", "-I", "-L", "-sS", "-o", "/dev/null", "-w", "%{url_effective}", url],
        check=True,
        capture_output=True,
        text=True,
    )
    return response.stdout.strip() or url


def parse_catalog_entries(html: str) -> list[CatalogEntry]:
    parser = CatalogTableParser()
    parser.feed(html)

    entries: list[CatalogEntry] = []
    for row in parser.rows:
        first_link = next((cell for cell in row if cell.get("href")), None)
        if not first_link or not first_link.get("href"):
            continue

        subject_label = next((cell["text"] for cell in row if cell.get("text") and cell["text"] != "바로가기"), "") or "중등 교재"
        title = first_link.get("title") or subject_label
        short_url = first_link["href"] or ""
        entries.append(
            CatalogEntry(
                title=title,
                short_url=short_url,
                viewer_url="",
                subject_label=subject_label,
                slug=slugify(title),
            )
        )

    deduped: list[CatalogEntry] = []
    seen: set[str] = set()
    for entry in entries:
        if entry.short_url in seen:
            continue
        seen.add(entry.short_url)
        deduped.append(entry)
    return deduped


def resolve_catalog(entries: list[CatalogEntry]) -> list[CatalogEntry]:
    resolved: list[CatalogEntry] = []
    for entry in entries:
        _, final_url = fetch_text(entry.short_url)
        viewer_url = final_url
        if not viewer_url.endswith("index.html"):
            viewer_url = viewer_url.rstrip("/") + "/index.html"

        slug_source = Path(urlparse(viewer_url).path).parts[-3] if len(Path(urlparse(viewer_url).path).parts) >= 3 else entry.slug
        resolved.append(
            CatalogEntry(
                title=entry.title,
                short_url=entry.short_url,
                viewer_url=viewer_url,
                subject_label=entry.subject_label,
                slug=slugify(slug_source or entry.slug),
            )
        )
    return resolved


def build_book_manifest(entry: CatalogEntry) -> BookManifest:
    viewer_base = entry.viewer_url.rsplit("/", 1)[0] + "/"
    container_text, _ = fetch_text(urljoin(viewer_base, "epub/META-INF/container.xml"))
    container_root = ET.fromstring(container_text)
    rootfile = container_root.find(".//{urn:oasis:names:tc:opendocument:xmlns:container}rootfile")
    if rootfile is None:
        raise RuntimeError(f"container.xml에서 rootfile을 찾지 못했습니다: {entry.title}")

    opf_relative = rootfile.attrib["full-path"]
    opf_url = urljoin(viewer_base, f"epub/{opf_relative}")
    toc_url = urljoin(viewer_base, "epub/OEBPS/toc.xhtml")
    opf_text, _ = fetch_text(opf_url)
    opf_root = ET.fromstring(opf_text)

    title = opf_root.findtext(".//dc:title", default=entry.title, namespaces=EPUB_NS) or entry.title
    manifest_items = {
        item.attrib["id"]: item.attrib
        for item in opf_root.findall(".//opf:manifest/opf:item", EPUB_NS)
        if "id" in item.attrib
    }

    page_assets: list[PageAsset] = []
    page_number = 0
    for itemref in opf_root.findall(".//opf:spine/opf:itemref", EPUB_NS):
        item_id = itemref.attrib.get("idref")
        manifest_item = manifest_items.get(item_id or "")
        if not manifest_item:
            continue

        href = manifest_item.get("href", "")
        media_type = manifest_item.get("media-type", "")
        if media_type != "application/xhtml+xml" or not href.endswith(".xhtml"):
            continue
        if href == "toc.xhtml":
            continue

        page_number += 1
        xhtml_url = urljoin(opf_url, href)
        image_url = infer_image_url(opf_url, href)
        page_assets.append(
            PageAsset(
                page_number=page_number,
                xhtml_href=href,
                xhtml_url=xhtml_url,
                image_url=image_url,
            )
        )

    return BookManifest(
        title=title,
        slug=entry.slug,
        subject_label=entry.subject_label,
        viewer_url=entry.viewer_url,
        short_url=entry.short_url,
        opf_url=opf_url,
        toc_url=toc_url,
        page_count=len(page_assets),
        pages=page_assets,
    )


def infer_image_url(opf_url: str, xhtml_href: str) -> str:
    xhtml_path = Path(xhtml_href)
    stem = xhtml_path.stem
    base_dir = xhtml_path.parent
    image_relative = base_dir / "images" / stem / "backgnd.png"
    return urljoin(opf_url, image_relative.as_posix())


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def save_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def load_env(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        return {}

    result: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        result[key.strip()] = value.strip().strip("\"'")
    return result


def resolve_ocr_device(requested: str) -> str:
    resolved = resolve_paddle_device(requested)
    if is_macos() and resolved == "cpu" and requested.strip().lower().startswith("gpu"):
        print("macOS에서는 PaddleOCR GPU/Metal 가속이 공식 지원되지 않아 CPU로 대체합니다.", flush=True)
    return resolved


def resolve_ocr_backend(requested: str, ocr_mode: str) -> str:
    normalized = requested.strip().lower()
    if ocr_mode == "structure":
        return "paddle"
    if normalized in {"", "auto"}:
        return default_page_ocr_backend()
    if normalized == "vision" and not is_macos():
        print("Vision OCR는 macOS에서만 지원되어 paddle로 대체합니다.", flush=True)
        return "paddle"
    return normalized


def resolve_vision_languages(lang: str) -> list[str]:
    normalized = lang.strip().lower()
    if not normalized or normalized == "korean":
        return ["ko-KR", "en-US"]
    if normalized == "english":
        return ["en-US"]
    return [item.strip() for item in lang.split(",") if item.strip()]


def get_ppstructure_pipeline(lang: str = "korean", device: str = "cpu"):
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PPStructureV3

    return PPStructureV3(
        lang=lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device=device,
    )


def get_text_ocr_pipeline(lang: str = "korean", device: str = "cpu"):
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    from paddleocr import PaddleOCR

    return PaddleOCR(
        lang=lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device=device,
    )


def structure_result_field(result: Any, field_name: str) -> Any:
    if hasattr(result, field_name):
        return getattr(result, field_name)
    if isinstance(result, dict):
        return result.get(field_name)
    return None


def extract_text_from_image(image_path: Path, pipeline: Any) -> str:
    if hasattr(pipeline, "ocr"):
        return extract_text_with_plain_ocr(image_path, pipeline)
    output = pipeline.predict(input=str(image_path))
    markdown_pages: list[Any] = []
    fragments: list[str] = []

    for result in output:
        markdown = structure_result_field(result, "markdown")
        if markdown:
            markdown_pages.append(markdown)
            if isinstance(markdown, dict):
                markdown_text = markdown.get("text") or markdown.get("markdown_text")
                if markdown_text:
                    fragments.append(markdown_text)
            elif isinstance(markdown, str):
                fragments.append(markdown)

        parsing_blocks = structure_result_field(result, "parsing_res_list") or []
        for block in parsing_blocks:
            content = block.get("block_content")
            if content:
                fragments.append(content)

    if markdown_pages and hasattr(pipeline, "concatenate_markdown_pages"):
        merged = pipeline.concatenate_markdown_pages(markdown_pages)
        if isinstance(merged, str) and merged.strip():
            return merged.strip()

    return "\n\n".join(fragment.strip() for fragment in fragments if fragment and fragment.strip()).strip()


def extract_text_with_plain_ocr(image_path: Path, pipeline: Any) -> str:
    result = pipeline.predict(input=str(image_path))
    lines: list[str] = []
    for page_result in result or []:
        res = structure_result_field(page_result, "res") or {}
        rec_texts = res.get("rec_text") or res.get("rec_texts") or []
        if isinstance(rec_texts, str):
            rec_texts = [rec_texts]
        for text in rec_texts:
            normalized = normalize_space(str(text))
            if normalized:
                lines.append(normalized)
    return "\n".join(lines).strip()


def is_valid_image_bytes(payload: bytes) -> bool:
    try:
        from PIL import Image

        with Image.open(BytesIO(payload)) as image:
            image.verify()
        return True
    except Exception:
        return False


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


def write_blank_page_image(path: Path, size: tuple[int, int]) -> Path:
    from PIL import Image

    ensure_dir(path.parent)
    image = Image.new("RGB", size, "white")
    image.save(path, format="PNG")
    image.close()
    return path


def render_page_from_xhtml(page: PageAsset, image_path: Path, xhtml_text: str) -> Path | None:
    from PIL import Image

    viewport = parse_viewport_size(xhtml_text)
    if not viewport:
        return None
    if xhtml_body_is_blank(xhtml_text):
        return write_blank_page_image(image_path, viewport)

    css_match = re.search(r'href="(?P<href>css/[^"]+)"[^>]*id="page_css"|id="page_css"[^>]*href="(?P<href_alt>css/[^"]+)"', xhtml_text)
    css_href = (css_match.group("href") if css_match and css_match.groupdict().get("href") else None) or (
        css_match.group("href_alt") if css_match and css_match.groupdict().get("href_alt") else None
    )
    if not css_href:
        return None

    css_text, _ = fetch_text(urljoin(page.xhtml_url, css_href))
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
            payload = fetch_bytes(urljoin(page.xhtml_url, src))
            if not is_valid_image_bytes(payload):
                continue
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

    ensure_dir(image_path.parent)
    canvas.convert("RGB").save(image_path, format="PNG")
    canvas.close()
    return image_path


def download_page_image(page: PageAsset, book_dir: Path, skip_existing: bool) -> Path:
    images_dir = book_dir / "pages"
    ensure_dir(images_dir)
    image_path = images_dir / f"page{page.page_number:05d}.png"
    if image_path.exists() and skip_existing:
        if is_valid_image_bytes(image_path.read_bytes()):
            return image_path

    payload = fetch_bytes(page.image_url)
    if is_valid_image_bytes(payload):
        image_path.write_bytes(payload)
        return image_path

    xhtml_text, _ = fetch_text(page.xhtml_url)
    rendered = render_page_from_xhtml(page, image_path, xhtml_text)
    if rendered:
        return rendered

    raise RuntimeError(
        f"페이지 이미지를 정상적으로 생성하지 못했습니다: {page.page_number}p ({page.image_url})"
    )


def download_page_images(
    pages: list[PageAsset],
    book_dir: Path,
    skip_existing: bool,
    workers: int,
) -> dict[int, str]:
    if not pages:
        return {}

    results: dict[int, str] = {}
    worker_count = max(1, workers)
    if worker_count == 1:
        for page in pages:
            image_path = download_page_image(page, book_dir, skip_existing)
            results[page.page_number] = str(image_path.relative_to(book_dir))
        return results

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_map = {
            executor.submit(download_page_image, page, book_dir, skip_existing): page
            for page in pages
        }
        for future in as_completed(future_map):
            page = future_map[future]
            image_path = future.result()
            results[page.page_number] = str(image_path.relative_to(book_dir))
    return results


def maybe_export_book_pdf(book_dir: Path, manifest: BookManifest, max_pages: int | None = None) -> Path | None:
    try:
        from PIL import Image
    except ImportError:
        return None

    page_paths: list[Path] = []
    for page in manifest.pages[:max_pages]:
        candidate = book_dir / "pages" / f"page{page.page_number:05d}.png"
        if candidate.exists():
            page_paths.append(candidate)
    if not page_paths:
        return None

    opened_images = [Image.open(path).convert("RGB") for path in page_paths]
    pdf_path = book_dir / f"{manifest.slug}.pdf"
    try:
        head, tail = opened_images[0], opened_images[1:]
        head.save(pdf_path, save_all=True, append_images=tail)
    finally:
        for image in opened_images:
            image.close()
    return pdf_path


def init_ocr_worker(ocr_mode: str, lang: str, device: str) -> None:
    global _WORKER_PIPELINE
    resolved_device = resolve_ocr_device(device)
    if ocr_mode == "structure":
        _WORKER_PIPELINE = get_ppstructure_pipeline(lang=lang, device=resolved_device)
    else:
        _WORKER_PIPELINE = get_text_ocr_pipeline(lang=lang, device=resolved_device)


def ocr_page_worker(image_path_str: str) -> str:
    global _WORKER_PIPELINE
    if _WORKER_PIPELINE is None:
        raise RuntimeError("OCR worker pipeline이 초기화되지 않았습니다.")
    return extract_text_from_image(Path(image_path_str), _WORKER_PIPELINE)


def run_ocr_for_pages(
    pages: list[PageAsset],
    book_dir: Path,
    *,
    skip_existing: bool,
    ocr_backend: str,
    ocr_mode: str,
    ocr_lang: str,
    ocr_device: str,
    ocr_workers: int,
    pipeline: Any | None,
) -> list[dict[str, Any]]:
    ocr_rows: list[dict[str, Any]] = []
    tasks_to_run: list[tuple[PageAsset, Path, Path]] = []

    for page in pages:
        image_path = book_dir / (page.image_path or f"pages/page{page.page_number:05d}.png")
        text_path = book_dir / "ocr" / f"page{page.page_number:05d}.txt"
        ensure_dir(text_path.parent)

        if text_path.exists() and skip_existing:
            text = text_path.read_text(encoding="utf-8")
            preview = normalize_space(text[:160])
            page.text_path = str(text_path.relative_to(book_dir))
            page.text_preview = preview
            ocr_rows.append(
                {
                    "page_number": page.page_number,
                    "image_path": page.image_path,
                    "text_path": page.text_path,
                    "text": text,
                    "preview": preview,
                }
            )
            continue

        tasks_to_run.append((page, image_path, text_path))

    if tasks_to_run:
        if ocr_backend == "vision":
            texts = run_vision_ocr_batch(
                [image_path for _, image_path, _ in tasks_to_run],
                languages=resolve_vision_languages(ocr_lang),
                fast=False,
            )
            for page, image_path, text_path in tasks_to_run:
                text = texts.get(str(image_path), "")
                text_path.write_text(text, encoding="utf-8")
                preview = normalize_space(text[:160])
                page.text_path = str(text_path.relative_to(book_dir))
                page.text_preview = preview
                ocr_rows.append(
                    {
                        "page_number": page.page_number,
                        "image_path": page.image_path,
                        "text_path": page.text_path,
                        "text": text,
                        "preview": preview,
                    }
                )
        elif ocr_workers > 1 and ocr_mode == "text":
            with ProcessPoolExecutor(
                max_workers=ocr_workers,
                initializer=init_ocr_worker,
                initargs=(ocr_mode, ocr_lang, ocr_device),
            ) as executor:
                texts = list(executor.map(ocr_page_worker, [str(image_path) for _, image_path, _ in tasks_to_run]))
            for (page, _, text_path), text in zip(tasks_to_run, texts, strict=True):
                text_path.write_text(text, encoding="utf-8")
                preview = normalize_space(text[:160])
                page.text_path = str(text_path.relative_to(book_dir))
                page.text_preview = preview
                ocr_rows.append(
                    {
                        "page_number": page.page_number,
                        "image_path": page.image_path,
                        "text_path": page.text_path,
                        "text": text,
                        "preview": preview,
                    }
                )
        else:
            if pipeline is None:
                init_ocr_worker(ocr_mode, ocr_lang, ocr_device)
                pipeline = _WORKER_PIPELINE
            assert pipeline is not None
            for page, image_path, text_path in tasks_to_run:
                text = extract_text_from_image(image_path, pipeline)
                text_path.write_text(text, encoding="utf-8")
                preview = normalize_space(text[:160])
                page.text_path = str(text_path.relative_to(book_dir))
                page.text_preview = preview
                ocr_rows.append(
                    {
                        "page_number": page.page_number,
                        "image_path": page.image_path,
                        "text_path": page.text_path,
                        "text": text,
                        "preview": preview,
                    }
                )

    ocr_rows.sort(key=lambda row: int(row["page_number"]))
    return ocr_rows


def run_vision_ocr_batch(
    image_paths: list[Path],
    *,
    languages: list[str],
    fast: bool,
) -> dict[str, str]:
    results: dict[str, str] = {}
    for batch in chunked_paths(image_paths, 6):
        binary = ensure_vision_ocr_binary()
        with NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
            for path in batch:
                handle.write(str(path.resolve()) + "\n")
            input_list_path = Path(handle.name)

        try:
            command = [
                str(binary),
                "--input-list",
                str(input_list_path),
                "--langs",
                ",".join(languages),
            ]
            if fast:
                command.append("--fast")
            process = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
            )
        finally:
            input_list_path.unlink(missing_ok=True)

        for line in process.stdout.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            payload = json.loads(stripped)
            if payload.get("error"):
                raise RuntimeError(f"Vision OCR failed for {payload.get('path')}: {payload['error']}")
            results[payload["path"]] = payload.get("text", "")
    return results


def init_genai_client(env: dict[str, str]):
    api_key = env.get("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY가 없어 시험지 자동 생성을 진행할 수 없습니다.")

    from google import genai

    return genai.Client(api_key=api_key), env.get("GEMINI_MODEL", "gemini-2.5-flash-lite")


def parse_json_response(raw_text: str) -> Any:
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    return json.loads(cleaned)


def infer_sections(client: Any, model: str, manifest: BookManifest, ocr_rows: list[dict[str, Any]], max_sections: int) -> list[dict[str, Any]]:
    from google.genai import types

    available_page_count = max((int(row["page_number"]) for row in ocr_rows), default=manifest.page_count)
    visible_rows = ocr_rows[: min(len(ocr_rows), 40)]
    page_dump = "\n\n".join(
        f"[페이지 {row['page_number']}]\n{row['text'][:1200]}"
        for row in visible_rows
        if row.get("text")
    )
    if not page_dump.strip():
        return fallback_sections(manifest, max_sections, page_count=available_page_count)

    prompt = f"""
다음은 중학교 교재 OCR 일부입니다.
교재 제목: {manifest.title}
현재 확보한 페이지 수: {available_page_count}

가능하면 목차나 큰 단원을 추론해 주세요. 응답은 반드시 JSON 배열만 반환하세요.
각 원소 형식:
{{
  "title": "단원명",
  "page_start": 1,
  "page_end": 10
}}

제약:
- 최대 {max_sections}개까지만 반환
- page_start/page_end는 1 이상 {available_page_count} 이하
- 확실하지 않으면 추측이라고 제목에 쓰지 말고 가장 가능성 높은 구조를 반환
- 전혀 판단이 안 되면 빈 배열 [] 반환

    OCR 텍스트:
{page_dump}
""".strip()

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )
    data = parse_json_response(response.text or "[]")
    if not isinstance(data, list) or not data:
        return fallback_sections(manifest, max_sections)

    sanitized: list[dict[str, Any]] = []
    for item in data[:max_sections]:
        if not isinstance(item, dict):
            continue
        title = normalize_space(str(item.get("title", "")))
        start = max(1, min(int(item.get("page_start", 1)), available_page_count))
        end = max(start, min(int(item.get("page_end", start)), available_page_count))
        if not title:
            title = f"{manifest.title} {start}-{end}p"
        sanitized.append({"title": title, "page_start": start, "page_end": end})
    return sanitized or fallback_sections(manifest, max_sections, page_count=available_page_count)


def fallback_sections(
    manifest: BookManifest,
    max_sections: int,
    *,
    page_count: int | None = None,
    window_size: int = 24,
) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    effective_page_count = page_count or manifest.page_count
    start = 1
    while start <= effective_page_count and len(sections) < max_sections:
        end = min(start + window_size - 1, effective_page_count)
        sections.append(
            {
                "title": f"{manifest.title} {start}-{end}p",
                "page_start": start,
                "page_end": end,
            }
        )
        start = end + 1
    return sections


def generate_exam_draft(
    client: Any,
    model: str,
    manifest: BookManifest,
    section: dict[str, Any],
    ocr_rows: list[dict[str, Any]],
    questions_per_section: int,
) -> dict[str, Any]:
    from google.genai import types

    section_pages = [
        row for row in ocr_rows
        if section["page_start"] <= int(row["page_number"]) <= section["page_end"] and row.get("text")
    ]
    if not section_pages:
        raise RuntimeError(f"OCR 텍스트가 없어 시험지 생성이 불가능합니다: {section['title']}")

    context = "\n\n".join(
        f"[페이지 {row['page_number']}]\n{row['text'][:1800]}"
        for row in section_pages
    )[:24000]

    prompt = f"""
너는 교재 근거 기반 중학교 시험 출제자다.
다음 제약을 반드시 지켜라.

- supplied context 밖의 정보는 사용하지 말 것
- 학생이 교재를 학습하면 충분히 풀 수 있는 객관식 4지선다 문제만 만들 것
- 총 {questions_per_section}문항
- 각 문항에는 반드시 근거 페이지와 짧은 evidence_excerpt를 포함할 것
- explanation은 교사용 해설처럼 간단하지만 분명하게 쓸 것
- 정답은 A/B/C/D 중 하나
- 응답은 반드시 JSON 객체 하나만 반환

JSON 형식:
{{
  "title": "{manifest.title} - {section['title']}",
  "description": "설명",
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
      "source_pages": [10, 11],
      "evidence_excerpt": "교재에서 직접 확인 가능한 짧은 근거"
    }}
  ]
}}

교재 제목: {manifest.title}
섹션 제목: {section['title']}
페이지 범위: {section['page_start']}~{section['page_end']}

교재 OCR 텍스트:
{context}
""".strip()

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.3,
        ),
    )
    draft = parse_json_response(response.text or "{}")
    if not isinstance(draft, dict) or not isinstance(draft.get("questions"), list):
        raise RuntimeError(f"시험지 생성 응답을 이해하지 못했습니다: {section['title']}")
    return draft


def exam_draft_to_markdown(draft: dict[str, Any]) -> str:
    questions = draft.get("questions", [])
    total_points = len(questions) * 10
    lines = [
        f"TITLE: {draft.get('title', 'Generated Exam')}",
        f"DESCRIPTION: {draft.get('description', '교재 기반 자동 생성 시험지')}",
        "DATE: 2026-04-09",
        "DURATION: 30",
        f"TOTAL_POINTS: {total_points}",
        "",
    ]

    for question in questions:
        lines.append("---")
        lines.append(f"CONCEPT: {question.get('concept', '교재 기반 개념')}")
        lines.append("DIFFICULTY: medium")
        lines.append("POINTS: 10")
        lines.append(f"QUESTION: {question.get('prompt', '').strip()}")
        for choice in question.get("choices", []):
            label = choice.get("label", "").strip() or "A"
            text = choice.get("text", "").strip()
            lines.append(f"{label}. {text}")
        lines.append(f"ANSWER: {question.get('answer', 'A')}")

        explanation = normalize_space(question.get("explanation", ""))
        pages = ",".join(str(page) for page in question.get("source_pages", []))
        evidence = normalize_space(question.get("evidence_excerpt", ""))
        if pages or evidence:
            detail = []
            if explanation:
                detail.append(explanation)
            if pages:
                detail.append(f"근거 페이지: {pages}")
            if evidence:
                detail.append(f"근거 발췌: {evidence}")
            lines.append(f"EXPLANATION: {' | '.join(detail)}")
        elif explanation:
            lines.append(f"EXPLANATION: {explanation}")
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def run_pipeline(args: argparse.Namespace) -> None:
    out_dir = Path(args.out_dir).resolve()
    ensure_dir(out_dir)
    filtered_run = bool(args.book_filter or args.max_books)
    resolved_ocr_device = resolve_ocr_device(args.ocr_device)
    resolved_ocr_backend = resolve_ocr_backend(args.ocr_backend, args.ocr_mode)
    should_export_pdf = args.export_pdf or args.download_pages or args.ocr or args.generate_exams

    catalog_html, _ = fetch_text(args.catalog_url)
    raw_entries = parse_catalog_entries(catalog_html)
    resolved_entries = resolve_catalog(raw_entries)

    if args.book_filter:
        lowered = args.book_filter.lower()
        resolved_entries = [entry for entry in resolved_entries if lowered in entry.title.lower() or lowered in entry.slug.lower()]

    if args.max_books:
        resolved_entries = resolved_entries[: args.max_books]

    catalog_path = out_dir / ("catalog.filtered.json" if filtered_run else "catalog.json")
    save_json(catalog_path, [asdict(entry) for entry in resolved_entries])
    print(f"catalog_books={len(resolved_entries)}", flush=True)

    client = None
    model = None
    if args.generate_exams:
        env = load_env(Path(args.env_file))
        client, model = init_genai_client(env)

    ocr_pipeline = None
    if args.ocr or args.generate_exams:
        if resolved_ocr_backend == "paddle" and args.ocr_mode == "structure":
            ocr_pipeline = get_ppstructure_pipeline(args.ocr_lang, resolved_ocr_device)
        elif resolved_ocr_backend == "paddle" and args.ocr_workers <= 1:
            ocr_pipeline = get_text_ocr_pipeline(args.ocr_lang, resolved_ocr_device)

    failures: list[dict[str, str]] = []
    for index, entry in enumerate(resolved_entries, start=1):
        print(f"[{index}/{len(resolved_entries)}] {entry.title}", flush=True)
        try:
            manifest = build_book_manifest(entry)
            book_dir = out_dir / entry.slug
            ensure_dir(book_dir)
            save_json(book_dir / "manifest.json", asdict(manifest))

            page_cap = args.max_pages_per_book or manifest.page_count
            selected_pages = manifest.pages[:page_cap]
            should_download_assets = args.download_pages or args.ocr or args.generate_exams or should_export_pdf
            if should_download_assets:
                image_paths = download_page_images(
                    selected_pages,
                    book_dir,
                    args.skip_existing,
                    args.download_workers,
                )
                for page in selected_pages:
                    page.image_path = image_paths.get(page.page_number, page.image_path)

            if should_export_pdf:
                pdf_path = maybe_export_book_pdf(book_dir, manifest, max_pages=page_cap)
                if pdf_path is not None:
                    manifest.local_pdf_path = str(pdf_path.relative_to(book_dir))
                    print(f"  pdf={pdf_path.name}", flush=True)

            ocr_rows: list[dict[str, Any]] = []
            if args.ocr or args.generate_exams:
                ocr_rows = run_ocr_for_pages(
                    selected_pages,
                    book_dir,
                    skip_existing=args.skip_existing,
                    ocr_backend=resolved_ocr_backend,
                    ocr_mode=args.ocr_mode,
                    ocr_lang=args.ocr_lang,
                    ocr_device=resolved_ocr_device,
                    ocr_workers=args.ocr_workers,
                    pipeline=ocr_pipeline,
                )

            save_json(book_dir / "manifest.json", asdict(manifest))
            if ocr_rows:
                save_jsonl(book_dir / "ocr_pages.jsonl", ocr_rows)
                print(f"  ocr_pages={len(ocr_rows)}", flush=True)

            if args.generate_exams:
                assert client is not None and model is not None
                sections = infer_sections(client, model, manifest, ocr_rows, args.max_sections_per_book)
                save_json(book_dir / "sections.json", sections)

                exams_dir = book_dir / "exam_drafts"
                ensure_dir(exams_dir)
                for section_index, section in enumerate(sections, start=1):
                    draft = generate_exam_draft(
                        client,
                        model,
                        manifest,
                        section,
                        ocr_rows,
                        args.questions_per_section,
                    )
                    section_slug = slugify(section["title"]) or f"section-{section_index}"
                    save_json(exams_dir / f"{section_index:02d}_{section_slug}.json", draft)
                    markdown = exam_draft_to_markdown(draft)
                    (exams_dir / f"{section_index:02d}_{section_slug}.exam.md").write_text(markdown, encoding="utf-8")
                print(f"  exam_sections={len(sections)}", flush=True)
        except Exception as error:
            failures.append({"title": entry.title, "slug": entry.slug, "error": str(error)})
            print(f"  failed={error}", flush=True)

    if failures:
        failure_path = out_dir / ("failures.filtered.json" if filtered_run else "failures.json")
        save_json(failure_path, failures)
        print(f"failures={len(failures)}", flush=True)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Download Kumsung middle-school eBook manifests, page images, OCR text, and grounded exam drafts.",
    )
    parser.add_argument("--catalog-url", default=DEFAULT_CATALOG_URL)
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--env-file", default=str(Path(__file__).resolve().parents[1] / ".env"))
    parser.add_argument("--book-filter", default="")
    parser.add_argument("--max-books", type=int)
    parser.add_argument("--max-pages-per-book", type=int)
    parser.add_argument("--max-sections-per-book", type=int, default=3)
    parser.add_argument("--questions-per-section", type=int, default=10)
    parser.add_argument("--ocr-lang", default="korean")
    parser.add_argument("--ocr-backend", choices=("auto", "paddle", "vision"), default="auto")
    parser.add_argument("--ocr-mode", choices=("text", "structure"), default="text")
    parser.add_argument("--ocr-device", default="auto")
    parser.add_argument("--download-workers", type=int, default=3)
    parser.add_argument("--ocr-workers", type=int, default=1)
    parser.add_argument("--skip-existing", action="store_true")
    parser.add_argument("--download-pages", action="store_true")
    parser.add_argument("--ocr", action="store_true")
    parser.add_argument("--generate-exams", action="store_true")
    parser.add_argument("--export-pdf", action="store_true")
    return parser


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    if not any((args.download_pages, args.ocr, args.generate_exams, args.export_pdf)):
        print("No heavy step selected. Saving catalog + book manifests only.")

    try:
        run_pipeline(args)
    except KeyboardInterrupt:
        print("Interrupted.")
        return 130
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
