from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "kumsung_middle" / "catalog.json"
SUMMARY_PATH = ROOT / "data" / "kumsung_middle" / "batch_summary.json"
PIPELINE_SCRIPT = ROOT / "scripts" / "kumsung_middle_pipeline.py"


def resolve_ocr_python_bin() -> Path:
    if sys.platform == "win32":
        return ROOT / ".ocr-venv" / "Scripts" / "python.exe"
    return ROOT / ".ocr-venv" / "bin" / "python"


def load_catalog(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise RuntimeError(f"catalog 파일이 없습니다: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def build_command(entry: dict[str, Any], args: argparse.Namespace) -> list[str]:
    command = [
        str(resolve_ocr_python_bin()),
        str(PIPELINE_SCRIPT),
        "--book-filter",
        entry["slug"],
        "--max-books",
        "1",
        "--download-pages",
        "--ocr",
        "--ocr-backend",
        args.ocr_backend,
        "--ocr-mode",
        args.ocr_mode,
        "--ocr-workers",
        str(args.ocr_workers),
        "--download-workers",
        str(args.download_workers),
        "--skip-existing",
    ]
    if args.generate_exams:
        command.append("--generate-exams")
    if args.max_pages_per_book:
        command.extend(["--max-pages-per-book", str(args.max_pages_per_book)])
    if args.max_sections_per_book:
        command.extend(["--max-sections-per-book", str(args.max_sections_per_book)])
    if args.questions_per_section:
        command.extend(["--questions-per-section", str(args.questions_per_section)])
    if args.export_pdf:
        command.append("--export-pdf")
    return command


def run_one(entry: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    command = build_command(entry, args)
    process = subprocess.run(
        command,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    return {
        "title": entry["title"],
        "slug": entry["slug"],
        "returncode": process.returncode,
        "stdout": process.stdout[-8000:],
        "stderr": process.stderr[-8000:],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the Kumsung textbook pipeline across multiple books.")
    parser.add_argument("--catalog", default=str(CATALOG_PATH))
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--download-workers", type=int, default=3)
    parser.add_argument("--ocr-workers", type=int, default=1)
    parser.add_argument("--ocr-backend", choices=("auto", "paddle", "vision"), default="auto")
    parser.add_argument("--ocr-mode", choices=("text", "structure"), default="text")
    parser.add_argument("--max-books", type=int)
    parser.add_argument("--max-pages-per-book", type=int)
    parser.add_argument("--max-sections-per-book", type=int, default=3)
    parser.add_argument("--questions-per-section", type=int, default=10)
    parser.add_argument("--generate-exams", action="store_true")
    parser.add_argument("--export-pdf", action="store_true")
    parser.add_argument("--summary-path", default=str(SUMMARY_PATH))
    args = parser.parse_args()

    catalog = load_catalog(Path(args.catalog))
    if args.max_books:
        catalog = catalog[: args.max_books]

    print(f"batch_books={len(catalog)}", flush=True)
    results: list[dict[str, Any]] = []
    worker_count = max(1, args.workers)

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_map = {executor.submit(run_one, entry, args): entry for entry in catalog}
        for future in as_completed(future_map):
            entry = future_map[future]
            result = future.result()
            results.append(result)
            status = "ok" if result["returncode"] == 0 else "failed"
            print(f"[{status}] {entry['title']}", flush=True)

    summary_path = Path(args.summary_path)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    failures = [result for result in results if result["returncode"] != 0]
    print(f"failures={len(failures)}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
