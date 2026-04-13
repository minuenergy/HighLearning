from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

from postgrest.exceptions import APIError
from supabase import create_client

from app.config import settings

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
UTC = timezone.utc

FREE_EMAIL_DOMAINS = {
    "gmail.com",
    "naver.com",
    "daum.net",
    "hanmail.net",
    "kakao.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "yahoo.com",
}

ADMIN_VERIFICATION_METHOD = "bootstrap_admin"


def get_api_error_code(error: APIError) -> str | None:
    code = getattr(error, "code", None)
    if code:
        return str(code)

    if error.args and isinstance(error.args[0], dict):
        return error.args[0].get("code")

    return None


def is_missing_profiles_phone_number(error: APIError) -> bool:
    if get_api_error_code(error) != "42703":
        return False

    if error.args and isinstance(error.args[0], dict):
        message = str(error.args[0].get("message") or "")
    else:
        message = str(error)

    return "profiles.phone_number" in message


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


def update_profile_record(user_id: str, *, full_name: str, phone_number: str | None) -> None:
    payload = {
        "full_name": full_name,
        "phone_number": phone_number,
    }
    try:
        supabase.table("profiles").update(payload).eq("id", user_id).execute()
    except APIError as error:
        if not is_missing_profiles_phone_number(error):
            raise
        supabase.table("profiles").update({"full_name": full_name}).eq("id", user_id).execute()


def upsert_workspace_settings(table_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    lookup_column = "teacher_id" if "teacher_id" in payload else "student_id" if "student_id" in payload else None
    lookup_value = payload.get(lookup_column) if lookup_column else None
    try:
        supabase.table(table_name).upsert(payload).execute()
    except APIError as error:
        if get_api_error_code(error) not in {"42P01", "PGRST205", "PGRST204"}:
            raise
        raise ValueError(
            "워크스페이스 설정 테이블이 없습니다. `006_workspace_domain_and_settings.sql` 마이그레이션을 적용해주세요."
        ) from error

    if not lookup_column or lookup_value is None:
        return payload

    result = (
        supabase.table(table_name)
        .select("*")
        .eq(lookup_column, lookup_value)
        .single()
        .execute()
    )
    return result.data or payload


def normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def extract_email_domain(email: str) -> str:
    normalized = normalize_email(email)
    return normalized.split("@", 1)[1] if "@" in normalized else ""


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def is_admin_teacher_settings(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    return (
        str(row.get("verification_status") or "").strip().lower() == "verified"
        and str(row.get("verification_method") or "").strip().lower() == ADMIN_VERIFICATION_METHOD
    )


def admin_teacher_exists() -> bool:
    admin = safe_single(
        lambda: supabase.table("teacher_settings")
        .select("teacher_id")
        .eq("verification_status", "verified")
        .eq("verification_method", ADMIN_VERIFICATION_METHOD)
        .limit(1)
    )
    return admin is not None


def require_verified_teacher_settings(teacher_id: str) -> dict[str, Any]:
    teacher_settings = safe_single(
        lambda: supabase.table("teacher_settings")
        .select("*")
        .eq("teacher_id", teacher_id)
    )
    if not teacher_settings:
        raise ValueError("교사 설정이 없어 초대코드를 발급할 수 없습니다.")
    if str(teacher_settings.get("verification_status") or "").strip().lower() != "verified":
        raise ValueError("최종 인증이 완료된 교사만 학생 초대코드를 발급할 수 있습니다.")
    return teacher_settings


def require_admin_teacher_settings(teacher_id: str) -> dict[str, Any]:
    teacher_settings = require_verified_teacher_settings(teacher_id)
    if not is_admin_teacher_settings(teacher_settings):
        raise ValueError("어드민 교사만 교사용 초대코드를 발급하고 승인 큐를 관리할 수 있습니다.")
    return teacher_settings


def is_school_email_candidate(email: str, school_email: str) -> bool:
    email_domain = extract_email_domain(email)
    school_domain = extract_email_domain(school_email)
    if not email_domain or not school_domain:
        return False
    if email_domain != school_domain:
        return False
    return email_domain not in FREE_EMAIL_DOMAINS


def resolve_teacher_invite_context(invite: dict | None) -> dict[str, Any]:
    if not invite:
        return {}

    creator_id = invite.get("created_by")
    if not creator_id:
        return {}

    creator_settings = safe_single(
        lambda: supabase.table("teacher_settings")
        .select("*")
        .eq("teacher_id", creator_id)
    ) or {}

    creator_profile = safe_single(
        lambda: supabase.table("profiles")
        .select("id, email, full_name")
        .eq("id", creator_id)
    ) or {}

    return {
        "teacher_id": creator_id,
        "school_name": creator_settings.get("school_name") or "",
        "school_email": creator_settings.get("school_email") or creator_profile.get("email") or "",
        "teacher_name": creator_profile.get("full_name") or "",
    }


def generate_invite_code(prefix: str) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return f"{prefix}-{''.join(secrets.choice(alphabet) for _ in range(8))}"


def resolve_active_invite_code(code: str, *, role: str) -> dict | None:
    normalized_code = (code or "").strip().upper()
    if not normalized_code:
        return None

    invite = safe_single(
        lambda: supabase.table("invite_codes")
        .select("*")
        .eq("code", normalized_code)
        .eq("role", role)
        .eq("active", True)
    )
    if not invite:
        return None

    expires_at = invite.get("expires_at")
    if expires_at:
        expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expires_dt < datetime.now(UTC):
            return None

    if int(invite.get("used_count", 0) or 0) >= int(invite.get("max_uses", 1) or 1):
        return None

    return invite


def consume_invite_code(code: str) -> dict | None:
    """초대코드를 소비합니다.

    optimistic concurrency control로 동시 가입 시 max_uses 초과를 방지합니다.
    - update WHERE used_count = 현재값 → 다른 사용자가 먼저 업데이트하면 조건 불일치 → 재시도
    - 최대 5회 재시도, 모두 실패하면 None 반환 (코드 소진으로 처리)
    """
    import time

    normalized = (code or "").strip().upper()
    if not normalized:
        return None

    try:
        rpc_result = supabase.rpc("consume_invite_code_atomic", {"p_code": normalized}).execute()
        rows = rpc_result.data or []
        if rows:
            row = rows[0]
            return row if row.get("consumed") else None
    except APIError:
        pass

    for attempt in range(5):
        invite = resolve_active_invite_code(normalized, role="teacher") or resolve_active_invite_code(normalized, role="student")
        if not invite:
            return None

        current_used = int(invite.get("used_count", 0) or 0)
        max_uses = int(invite.get("max_uses", 1) or 1)
        next_used = current_used + 1

        # 조건부 update: used_count가 아직 current_used인 경우에만 성공
        supabase.table("invite_codes").update(
            {
                "used_count": next_used,
                "active": next_used < max_uses,
                "updated_at": now_iso(),
            }
        ).eq("id", invite["id"]).eq("used_count", current_used).execute()

        refreshed = safe_single(
            lambda: supabase.table("invite_codes")
            .select("*")
            .eq("id", invite["id"])
        )
        if refreshed and int(refreshed.get("used_count", 0) or 0) == next_used:
            return refreshed

        # 다른 사용자가 먼저 업데이트함 → 잠시 후 재시도
        time.sleep(0.05 * (attempt + 1))

    return None


def issue_student_invite_code(
    *,
    teacher_id: str,
    label: str,
    course_id: str | None = None,
    school_class_id: str | None = None,
    subject_names: list[str] | None = None,
    max_uses: int = 30,
    expires_days: int = 30,
) -> dict[str, Any]:
    require_verified_teacher_settings(teacher_id)

    if course_id:
        course = safe_single(
            lambda: supabase.table("courses")
            .select("id, teacher_id, title, school_class_id")
            .eq("id", course_id)
            .eq("teacher_id", teacher_id)
        )
        if not course:
            raise ValueError("초대코드를 생성할 수업을 찾지 못했습니다.")
        if not school_class_id:
            school_class_id = course.get("school_class_id")

    if school_class_id:
        school_class = safe_single(
            lambda: supabase.table("school_classes")
            .select("id, teacher_id, title")
            .eq("id", school_class_id)
            .eq("teacher_id", teacher_id)
        )
        if not school_class:
            raise ValueError("초대코드를 생성할 반을 찾지 못했습니다.")

    invite_payload = {
        "code": generate_invite_code("STD"),
        "role": "student",
        "purpose": "student_onboarding",
        "created_by": teacher_id,
        "school_class_id": school_class_id,
        "course_id": course_id,
        "label": label,
        "subject_names": subject_names or [],
        "max_uses": max_uses,
        "used_count": 0,
        "active": True,
        "expires_at": (datetime.now(UTC) + timedelta(days=expires_days)).isoformat(),
        "updated_at": now_iso(),
    }
    supabase.table("invite_codes").insert(invite_payload).execute()
    return (
        supabase.table("invite_codes")
        .select("*")
        .eq("code", invite_payload["code"])
        .single()
        .execute()
        .data
    )


def issue_teacher_invite_code(
    *,
    teacher_id: str,
    label: str,
    subject_names: list[str] | None = None,
    max_uses: int = 5,
    expires_days: int = 30,
) -> dict[str, Any]:
    teacher_settings = require_admin_teacher_settings(teacher_id)

    invite_payload = {
        "code": generate_invite_code("TCH"),
        "role": "teacher",
        "purpose": "teacher_onboarding",
        "created_by": teacher_id,
        "label": label,
        "subject_names": subject_names or teacher_settings.get("subject_names") or [],
        "max_uses": max(max_uses, 1),
        "used_count": 0,
        "active": True,
        "expires_at": (datetime.now(UTC) + timedelta(days=max(expires_days, 1))).isoformat(),
        "updated_at": now_iso(),
    }
    supabase.table("invite_codes").insert(invite_payload).execute()
    return (
        supabase.table("invite_codes")
        .select("*")
        .eq("code", invite_payload["code"])
        .single()
        .execute()
        .data
    )


def list_invite_codes(
    teacher_id: str,
    *,
    role: str | None = None,
    course_id: str | None = None,
    school_class_id: str | None = None,
) -> list[dict]:
    def build():
        query = (
            supabase.table("invite_codes")
            .select("*")
            .eq("created_by", teacher_id)
            .order("created_at", desc=True)
        )
        if role:
            query = query.eq("role", role)
        if course_id:
            query = query.eq("course_id", course_id)
        if school_class_id:
            query = query.eq("school_class_id", school_class_id)
        return query

    return safe_rows(build)


def is_same_teacher_scope(requester: dict[str, Any], target: dict[str, Any]) -> bool:
    requester_school_name = str(requester.get("school_name") or "").strip().lower()
    target_school_name = str(target.get("school_name") or "").strip().lower()
    if requester_school_name and target_school_name:
        return requester_school_name == target_school_name

    requester_domain = extract_email_domain(str(requester.get("school_email") or ""))
    target_domain = extract_email_domain(str(target.get("school_email") or ""))
    if requester_domain and target_domain:
        return requester_domain == target_domain

    return True


def list_teacher_verification_requests(
    teacher_id: str,
    *,
    status: str | None = None,
) -> list[dict[str, Any]]:
    requester = require_admin_teacher_settings(teacher_id)

    rows = safe_rows(
        lambda: supabase.table("teacher_settings")
        .select("*")
        .neq("teacher_id", teacher_id)
        .order("updated_at", desc=True)
    )
    if not rows:
        return []

    allowed_statuses = {"pending", "manual_review"} if not status or status == "open" else {status}
    filtered_rows = [
        row
        for row in rows
        if row.get("verification_status") in allowed_statuses
        and is_same_teacher_scope(requester, row)
        and not is_admin_teacher_settings(row)
    ]
    if not filtered_rows:
        return []

    teacher_ids = [row["teacher_id"] for row in filtered_rows]
    profiles = safe_rows(
        lambda: supabase.table("profiles")
        .select("id, email, full_name, created_at")
        .in_("id", teacher_ids)
    )
    profile_by_id = {profile["id"]: profile for profile in profiles}

    return [
        {
            **row,
            "is_admin": is_admin_teacher_settings(row),
            "email": profile_by_id.get(row["teacher_id"], {}).get("email"),
            "full_name": profile_by_id.get(row["teacher_id"], {}).get("full_name"),
            "joined_at": profile_by_id.get(row["teacher_id"], {}).get("created_at"),
        }
        for row in filtered_rows
    ]


def update_teacher_verification_request(
    *,
    teacher_id: str,
    target_teacher_id: str,
    verification_status: str,
    verification_note: str | None = None,
) -> dict[str, Any]:
    if verification_status not in {"pending", "verified", "manual_review"}:
        raise ValueError("지원하지 않는 verification_status 입니다.")

    requester = require_admin_teacher_settings(teacher_id)
    if teacher_id == target_teacher_id:
        raise ValueError("본인 계정의 인증 상태는 여기서 변경할 수 없습니다.")

    target = safe_single(
        lambda: supabase.table("teacher_settings")
        .select("*")
        .eq("teacher_id", target_teacher_id)
    )
    if not target:
        raise ValueError("변경할 교사 요청을 찾지 못했습니다.")
    if is_admin_teacher_settings(target):
        raise ValueError("최초 어드민 교사 계정은 여기서 변경할 수 없습니다.")
    if not is_same_teacher_scope(requester, target):
        raise ValueError("같은 학교 범위의 교사 요청만 관리할 수 있습니다.")

    default_note = {
        "pending": "관리자 검토 대기",
        "verified": "관리 승인 완료",
        "manual_review": "추가 증빙 또는 수동 검토 필요",
    }[verification_status]
    payload: dict[str, Any] = {
        "verification_status": verification_status,
        "verification_note": (verification_note or "").strip() or default_note,
        "updated_at": now_iso(),
    }
    payload["verified_at"] = now_iso() if verification_status == "verified" else None

    supabase.table("teacher_settings").update(payload).eq("teacher_id", target_teacher_id).execute()
    updated = (
        supabase.table("teacher_settings")
        .select("*")
        .eq("teacher_id", target_teacher_id)
        .single()
        .execute()
        .data
    )

    profile = safe_single(
        lambda: supabase.table("profiles")
        .select("id, email, full_name, created_at")
        .eq("id", target_teacher_id)
    ) or {}
    return {
        **updated,
        "is_admin": is_admin_teacher_settings(updated),
        "email": profile.get("email"),
        "full_name": profile.get("full_name"),
        "joined_at": profile.get("created_at"),
    }


def validate_teacher_signup(
    *,
    email: str,
    school_email: str | None,
    verification_method: str,
    invite_code: str | None = None,
) -> dict[str, Any]:
    normalized_email = normalize_email(email)
    normalized_school_email = normalize_email(school_email) or normalized_email

    if verification_method == "invite_code":
        invite = resolve_active_invite_code(invite_code or "", role="teacher")
        if not invite or invite.get("purpose") != "teacher_onboarding":
            raise ValueError("유효한 교사 초대코드를 찾지 못했습니다.")
        invite_context = resolve_teacher_invite_context(invite)
        return {
            "verification_status": "verified",
            "verification_method": "invite_code",
            "invite_code_used": invite["code"],
            "verified_at": now_iso(),
            "verification_note": invite.get("label") or "어드민 교사 초대코드 인증 완료",
            "school_email": normalize_email(invite_context.get("school_email")) or normalized_school_email,
            "school_name": invite_context.get("school_name") or "",
            "invited_by_teacher_id": invite_context.get("teacher_id"),
        }

    if admin_teacher_exists():
        raise ValueError("교사 회원가입은 어드민 교사가 발급한 초대코드로만 가능합니다.")

    if not is_school_email_candidate(normalized_email, normalized_school_email):
        raise ValueError("학교 이메일 인증을 사용하려면 가입 이메일과 학교 이메일의 도메인이 같고, 일반 메일 도메인이 아니어야 합니다.")

    return {
        "verification_status": "verified",
        "verification_method": ADMIN_VERIFICATION_METHOD,
        "invite_code_used": None,
        "verified_at": now_iso(),
        "verification_note": "최초 어드민 교사 계정으로 부트스트랩되었습니다.",
        "school_email": normalized_school_email,
        "school_name": "",
        "invited_by_teacher_id": None,
    }


def resolve_student_invite_context(invite: dict | None) -> tuple[str | None, str]:
    if not invite:
        return None, ""

    class_label = invite.get("label") or ""
    school_class_id = invite.get("school_class_id")
    if school_class_id:
        school_class = safe_single(
            lambda: supabase.table("school_classes")
            .select("id, title, class_label")
            .eq("id", school_class_id)
        )
        if school_class:
            return school_class.get("id"), school_class.get("title") or school_class.get("class_label") or class_label

    course_id = invite.get("course_id")
    if course_id:
        course = safe_single(
            lambda: supabase.table("courses")
            .select("id, title, class_label")
            .eq("id", course_id)
        )
        if course:
            return None, course.get("class_label") or course.get("title") or class_label

    return None, class_label


def validate_student_signup(*, invite_code: str, student_number: str) -> dict[str, Any]:
    if not (student_number or "").strip():
        raise ValueError("학생 번호를 입력해주세요.")

    invite = resolve_active_invite_code(invite_code, role="student")
    if not invite or invite.get("purpose") != "student_onboarding":
        raise ValueError("유효한 반 초대코드를 찾지 못했습니다.")

    school_class_id, class_label = resolve_student_invite_context(invite)
    return {
        "verification_status": "verified",
        "verification_method": "invite_code",
        "invite_code_used": invite["code"],
        "verified_at": now_iso(),
        "school_class_id": school_class_id,
        "class_label": class_label,
        "course_id": invite.get("course_id"),
        "invited_by_teacher_id": invite.get("created_by"),
    }


def ensure_enrollment(*, course_id: str | None, student_id: str) -> None:
    if not course_id:
        return

    existing = safe_single(
        lambda: supabase.table("enrollments")
        .select("id")
        .eq("course_id", course_id)
        .eq("student_id", student_id)
        .limit(1)
    )
    if existing:
        return

    supabase.table("enrollments").insert(
        {
            "course_id": course_id,
            "student_id": student_id,
        }
    ).execute()


def finalize_teacher_signup(
    *,
    user_id: str,
    email: str,
    full_name: str,
    phone_number: str | None,
    school_name: str | None,
    school_email: str | None,
    verification_method: str,
    invite_code: str | None = None,
    subject_names: list[str] | None = None,
    grade_levels: list[str] | None = None,
    class_labels: list[str] | None = None,
) -> dict[str, Any]:
    verification = validate_teacher_signup(
        email=email,
        school_email=school_email,
        verification_method=verification_method,
        invite_code=invite_code,
    )
    existing = safe_single(
        lambda: supabase.table("teacher_settings")
        .select("*")
        .eq("teacher_id", user_id)
    ) or {}

    update_profile_record(
        user_id,
        full_name=full_name,
        phone_number=phone_number,
    )

    if verification_method == "invite_code" and verification.get("invite_code_used") and existing.get("invite_code_used") != verification.get("invite_code_used"):
        consume_invite_code(str(verification["invite_code_used"]))

    payload = {
        "teacher_id": user_id,
        "school_name": school_name or str(verification.get("school_name") or ""),
        "school_email": verification.get("school_email") or normalize_email(school_email) or normalize_email(email),
        "phone_number": phone_number or "",
        "verification_status": verification["verification_status"],
        "verification_method": verification["verification_method"],
        "verified_at": verification.get("verified_at"),
        "invite_code_used": verification.get("invite_code_used"),
        "verification_note": verification.get("verification_note"),
        "subject_names": subject_names or [],
        "grade_levels": grade_levels or [],
        "class_labels": class_labels or [],
        "updated_at": now_iso(),
    }
    return upsert_workspace_settings("teacher_settings", payload)


def finalize_student_signup(
    *,
    user_id: str,
    email: str,
    full_name: str,
    phone_number: str | None,
    student_number: str,
    invite_code: str,
) -> dict[str, Any]:
    verification = validate_student_signup(invite_code=invite_code, student_number=student_number)
    existing = safe_single(
        lambda: supabase.table("student_settings")
        .select("*")
        .eq("student_id", user_id)
    ) or {}

    update_profile_record(
        user_id,
        full_name=full_name,
        phone_number=phone_number,
    )

    if verification.get("invite_code_used") and existing.get("invite_code_used") != verification.get("invite_code_used"):
        consume_invite_code(str(verification["invite_code_used"]))

    payload = {
        "student_id": user_id,
        "phone_number": phone_number or "",
        "student_number": student_number,
        "school_class_id": verification.get("school_class_id"),
        "class_label": verification.get("class_label") or "",
        "verification_status": verification["verification_status"],
        "verification_method": verification["verification_method"],
        "verified_at": verification.get("verified_at"),
        "invite_code_used": verification.get("invite_code_used"),
        "updated_at": now_iso(),
    }
    result = upsert_workspace_settings("student_settings", payload)
    ensure_enrollment(course_id=verification.get("course_id"), student_id=user_id)
    return {
        **result,
        "course_id": verification.get("course_id"),
        "email": email,
        "full_name": full_name,
    }
