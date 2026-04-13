#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"
BACKEND_ENV_PATH = BACKEND_DIR / ".env"
FRONTEND_ENV_PATH = FRONTEND_DIR / ".env.local"
LOCAL_SUPABASE_BIN = ROOT_DIR / "node_modules" / ".bin" / "supabase"

LOCAL_HOSTS = ("127.0.0.1", "localhost")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env_file(path: Path, header: str, values: dict[str, str], order: list[str]) -> None:
    lines = [header.rstrip(), ""]
    written: set[str] = set()

    for key in order:
        if key in values:
            lines.append(f"{key}={values[key]}")
            written.add(key)

    remaining = [key for key in values if key not in written]
    if remaining:
        lines.append("")
        for key in remaining:
            lines.append(f"{key}={values[key]}")

    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def run_supabase_command(args: list[str]) -> str:
    supabase_cmd: list[str]
    if LOCAL_SUPABASE_BIN.exists():
        supabase_cmd = [str(LOCAL_SUPABASE_BIN)]
    else:
        resolved = shutil.which("supabase")
        if resolved:
            supabase_cmd = [resolved]
        else:
            raise RuntimeError(
                "Supabase CLI를 찾지 못했습니다. `cd socrateach && npm install` 로 프로젝트 로컬 CLI를 설치하거나, 전역 Supabase CLI를 설치한 뒤 다시 실행해주세요."
            )

    try:
        result = subprocess.run(
            [*supabase_cmd, *args],
            cwd=BACKEND_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        raise RuntimeError(f"Supabase CLI 실행에 실패했습니다: {detail or 'unknown error'}") from error
    return result.stdout


def parse_status_env(output: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or "=" not in line or line.startswith("Stopped services:"):
            continue
        key, value = line.split("=", 1)
        cleaned = value.strip()
        if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {'"', "'"}:
            cleaned = cleaned[1:-1]
        values[key.strip()] = cleaned
    return values


def ensure_local_url(url: str, label: str) -> None:
    if not url:
        raise RuntimeError(f"{label} 값이 비어 있습니다.")
    if not any(host in url for host in LOCAL_HOSTS):
        raise RuntimeError(f"{label} 값이 로컬 주소가 아닙니다: {url}")


def sync_env_files(*, backend_api_url: str, start_stack: bool) -> None:
    if start_stack:
        print("로컬 Supabase 스택을 시작합니다...")
        run_supabase_command(["start"])

    status_output = run_supabase_command(["status", "-o", "env"])
    status_values = parse_status_env(status_output)

    api_url = status_values.get("API_URL") or status_values.get("SUPABASE_URL")
    anon_key = status_values.get("ANON_KEY") or status_values.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    service_role_key = status_values.get("SERVICE_ROLE_KEY") or status_values.get("SUPABASE_SERVICE_ROLE_KEY")

    if not api_url or not anon_key or not service_role_key:
        raise RuntimeError(
            "supabase status -o env 결과에서 API_URL, ANON_KEY, SERVICE_ROLE_KEY를 읽지 못했습니다."
        )

    ensure_local_url(api_url, "Supabase API URL")
    ensure_local_url(backend_api_url, "Backend API URL")

    backend_existing = parse_env_file(BACKEND_ENV_PATH)
    frontend_existing = parse_env_file(FRONTEND_ENV_PATH)

    backend_values = {
        "SUPABASE_URL": api_url,
        "SUPABASE_SERVICE_ROLE_KEY": service_role_key,
        "GEMINI_API_KEY": backend_existing.get("GEMINI_API_KEY", ""),
        "GEMINI_MODEL": backend_existing.get("GEMINI_MODEL", "gemini-2.5-flash-lite"),
        "DOCUMENT_PARSER": backend_existing.get("DOCUMENT_PARSER", "auto"),
        "PADDLEOCR_LANG": backend_existing.get("PADDLEOCR_LANG", "korean"),
        "PADDLEOCR_DEVICE": backend_existing.get("PADDLEOCR_DEVICE", "cpu"),
        "PADDLEOCR_USE_DOC_ORIENTATION_CLASSIFY": backend_existing.get(
            "PADDLEOCR_USE_DOC_ORIENTATION_CLASSIFY", "false"
        ),
        "PADDLEOCR_USE_DOC_UNWARPING": backend_existing.get("PADDLEOCR_USE_DOC_UNWARPING", "false"),
        "PADDLEOCR_USE_TEXTLINE_ORIENTATION": backend_existing.get(
            "PADDLEOCR_USE_TEXTLINE_ORIENTATION", "false"
        ),
        "VISION_OCR_LANGUAGES": backend_existing.get("VISION_OCR_LANGUAGES", "ko-KR,en-US"),
        "VISION_OCR_FAST": backend_existing.get("VISION_OCR_FAST", "false"),
        "VISION_OCR_PDF_DPI": backend_existing.get("VISION_OCR_PDF_DPI", "160"),
    }
    write_env_file(
        BACKEND_ENV_PATH,
        "# Auto-generated for local-only Supabase development.",
        backend_values,
        [
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "GEMINI_API_KEY",
            "GEMINI_MODEL",
            "DOCUMENT_PARSER",
            "PADDLEOCR_LANG",
            "PADDLEOCR_DEVICE",
            "PADDLEOCR_USE_DOC_ORIENTATION_CLASSIFY",
            "PADDLEOCR_USE_DOC_UNWARPING",
            "PADDLEOCR_USE_TEXTLINE_ORIENTATION",
            "VISION_OCR_LANGUAGES",
            "VISION_OCR_FAST",
            "VISION_OCR_PDF_DPI",
        ],
    )

    frontend_values = {
        "NEXT_PUBLIC_SUPABASE_URL": api_url,
        "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon_key,
        "NEXT_PUBLIC_API_URL": backend_api_url,
        "NEXT_PUBLIC_POSTHOG_KEY": frontend_existing.get("NEXT_PUBLIC_POSTHOG_KEY", ""),
        "NEXT_PUBLIC_POSTHOG_HOST": frontend_existing.get(
            "NEXT_PUBLIC_POSTHOG_HOST", "https://app.posthog.com"
        ),
    }
    write_env_file(
        FRONTEND_ENV_PATH,
        "# Auto-generated for local-only Supabase development.",
        frontend_values,
        [
            "NEXT_PUBLIC_SUPABASE_URL",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            "NEXT_PUBLIC_API_URL",
            "NEXT_PUBLIC_POSTHOG_KEY",
            "NEXT_PUBLIC_POSTHOG_HOST",
        ],
    )

    print(f"Updated {BACKEND_ENV_PATH}")
    print(f"Updated {FRONTEND_ENV_PATH}")
    print("Local-only env sync completed.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync backend/.env and frontend/.env.local to the local Supabase stack."
    )
    parser.add_argument(
        "--start",
        action="store_true",
        help="Run `supabase start` before reading local stack env values.",
    )
    parser.add_argument(
        "--backend-api-url",
        default="http://localhost:8000",
        help="Backend API URL to write into frontend/.env.local",
    )
    args = parser.parse_args()

    try:
        sync_env_files(backend_api_url=args.backend_api_url, start_stack=args.start)
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
