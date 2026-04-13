from __future__ import annotations

import platform


def get_platform_kind() -> str:
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    if system == "windows":
        return "windows"
    return "linux"


def is_macos() -> bool:
    return get_platform_kind() == "macos"


def is_windows() -> bool:
    return get_platform_kind() == "windows"


def default_page_ocr_backend() -> str:
    return "vision" if is_macos() else "paddle"


def default_document_ocr_backend() -> str:
    return "visionocr" if is_macos() else "paddleocr"


def resolve_paddle_device(requested: str) -> str:
    normalized = requested.strip().lower()
    if normalized in {"", "auto"}:
        return "cpu"
    if is_macos() and normalized.startswith("gpu"):
        return "cpu"
    return normalized

