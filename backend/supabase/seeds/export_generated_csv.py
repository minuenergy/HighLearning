"""
현재 DB 상태를 읽어 generated/ CSV 3개를 재생성합니다.

사용법:
  cd socrateach/backend
  ./.venv/bin/python supabase/seeds/export_generated_csv.py
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(__file__).resolve().parent / "generated"
ENV_PATH = ROOT_DIR / ".env"

load_dotenv(ENV_PATH)

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.config import settings  # noqa: E402
from supabase import create_client  # noqa: E402

sb = create_client(settings.supabase_url, settings.supabase_service_role_key)


# ── 헬퍼 ──────────────────────────────────────────────

def fetch_all(table: str, select: str = "*", **filters) -> list[dict]:
    query = sb.table(table).select(select)
    for key, value in filters.items():
        query = query.eq(key, value)
    result = query.execute()
    return result.data or []


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  ✓ {path.name}  ({len(rows)}행)")


# ── 데이터 로드 ────────────────────────────────────────

profiles      = fetch_all("profiles", "id, email, full_name, role")
profile_by_id = {p["id"]: p for p in profiles}

courses       = fetch_all("courses", "id, title, teacher_id, description")
course_by_id  = {c["id"]: c for c in courses}

enrollments   = fetch_all("enrollments", "id, student_id, course_id, enrolled_at")

teacher_settings = fetch_all(
    "teacher_settings",
    "teacher_id, school_name, school_email, phone_number, "
    "verification_status, verification_method, subject_names, grade_levels, "
    "class_labels, invite_code_used, verified_at",
)
ts_by_id = {r["teacher_id"]: r for r in teacher_settings}

student_settings = fetch_all(
    "student_settings",
    "student_id, student_number, class_label, school_class_id, "
    "invite_code_used, verification_status, verification_method, verified_at",
)
ss_by_id = {r["student_id"]: r for r in student_settings}

invite_codes = fetch_all(
    "invite_codes",
    "code, role, purpose, created_by, label, school_class_id, course_id, "
    "subject_names, max_uses, used_count, active, expires_at",
)


# ── school_classes 테이블 존재 여부 확인 ──────────────

school_classes: list[dict] = []
try:
    school_classes = fetch_all("school_classes", "id, title, teacher_id")
except Exception:
    pass
sc_by_id = {c["id"]: c for c in school_classes}


# ── 1. teacher_accounts.csv ───────────────────────────

TEACHER_FIELDS = [
    "account_type", "user_id", "email", "password", "full_name", "role",
    "school_name", "school_email", "phone_number", "verification_status",
    "verification_method", "invite_code_used", "verified_at",
    "subject_names", "grade_levels", "class_labels",
    "class_id", "class_title", "course_id", "course_title",
]

teacher_rows: list[dict] = []
for p in sorted(profiles, key=lambda x: x["email"]):
    if p["role"] != "teacher":
        continue

    ts = ts_by_id.get(p["id"], {})

    # 이 선생님의 course
    teacher_course = next(
        (c for c in courses if c["teacher_id"] == p["id"]),
        None,
    )
    teacher_class = (
        sc_by_id.get(teacher_course["id"]) if teacher_course else None
    )

    subject_names_raw = ts.get("subject_names") or []
    grade_levels_raw  = ts.get("grade_levels") or []
    class_labels_raw  = ts.get("class_labels") or []

    account_type = "admin_teacher" if ts.get("verification_method") == "bootstrap_admin" else "teacher"

    teacher_rows.append({
        "account_type":        account_type,
        "user_id":             p["id"],
        "email":               p["email"],
        "password":            "SocraTeachAdmin!2026" if account_type == "admin_teacher" else "SocraTeachTeacher!2026",
        "full_name":           p["full_name"] or "",
        "role":                p["role"],
        "school_name":         ts.get("school_name") or "",
        "school_email":        ts.get("school_email") or "",
        "phone_number":        ts.get("phone_number") or "",
        "verification_status": ts.get("verification_status") or "",
        "verification_method": ts.get("verification_method") or "",
        "invite_code_used":    ts.get("invite_code_used") or "",
        "verified_at":         ts.get("verified_at") or "",
        "subject_names":       ",".join(subject_names_raw),
        "grade_levels":        ",".join(grade_levels_raw),
        "class_labels":        ",".join(class_labels_raw),
        "class_id":            teacher_class["id"] if teacher_class else "",
        "class_title":         teacher_class["title"] if teacher_class else "",
        "course_id":           teacher_course["id"] if teacher_course else "",
        "course_title":        teacher_course["title"] if teacher_course else "",
    })

write_csv(OUTPUT_DIR / "teacher_accounts.csv", teacher_rows, TEACHER_FIELDS)


# ── 2. student_accounts.csv ───────────────────────────

STUDENT_FIELDS = [
    "user_id", "email", "password", "full_name", "role",
    "phone_number", "student_number", "verification_status",
    "verification_method", "invite_code_used", "verified_at",
    "school_class_id", "class_label", "course_id",
    "teacher_id", "teacher_name", "teacher_email",
    "subject_name", "grade_level",
]

student_rows: list[dict] = []
for p in sorted(profiles, key=lambda x: x["email"]):
    if p["role"] != "student":
        continue

    ss = ss_by_id.get(p["id"], {})

    # enrollment → course → teacher
    enroll = next((e for e in enrollments if e["student_id"] == p["id"]), None)
    course = course_by_id.get(enroll["course_id"]) if enroll else None
    teacher = profile_by_id.get(course["teacher_id"]) if course else None
    teacher_ts = ts_by_id.get(teacher["id"]) if teacher else {}

    subject_names = teacher_ts.get("subject_names") or []
    grade_levels  = teacher_ts.get("grade_levels") or []

    student_rows.append({
        "user_id":             p["id"],
        "email":               p["email"],
        "password":            "SocraTeachStudent!2026",
        "full_name":           p["full_name"] or "",
        "role":                p["role"],
        "phone_number":        ss.get("phone_number") or "",
        "student_number":      ss.get("student_number") or "",
        "verification_status": ss.get("verification_status") or "",
        "verification_method": ss.get("verification_method") or "",
        "invite_code_used":    ss.get("invite_code_used") or "",
        "verified_at":         ss.get("verified_at") or "",
        "school_class_id":     ss.get("school_class_id") or "",
        "class_label":         ss.get("class_label") or "",
        "course_id":           course["id"] if course else "",
        "teacher_id":          teacher["id"] if teacher else "",
        "teacher_name":        teacher["full_name"] if teacher else "",
        "teacher_email":       teacher["email"] if teacher else "",
        "subject_name":        ",".join(subject_names),
        "grade_level":         ",".join(grade_levels),
    })

write_csv(OUTPUT_DIR / "student_accounts.csv", student_rows, STUDENT_FIELDS)


# ── 3. invite_codes.csv ───────────────────────────────

INVITE_FIELDS = [
    "code", "role", "purpose", "created_by", "created_by_name",
    "label", "school_class_id", "course_id",
    "subject_names", "max_uses", "used_count", "active", "expires_at",
]

invite_rows: list[dict] = []
for ic in sorted(invite_codes, key=lambda x: x["code"]):
    creator = profile_by_id.get(ic.get("created_by") or "", {})
    subject_raw = ic.get("subject_names") or []
    invite_rows.append({
        "code":             ic["code"],
        "role":             ic.get("role") or "",
        "purpose":          ic.get("purpose") or "",
        "created_by":       ic.get("created_by") or "",
        "created_by_name":  creator.get("full_name") or "",
        "label":            ic.get("label") or "",
        "school_class_id":  ic.get("school_class_id") or "",
        "course_id":        ic.get("course_id") or "",
        "subject_names":    ",".join(subject_raw) if isinstance(subject_raw, list) else str(subject_raw),
        "max_uses":         ic.get("max_uses") or "",
        "used_count":       ic.get("used_count") or 0,
        "active":           ic.get("active"),
        "expires_at":       ic.get("expires_at") or "",
    })

write_csv(OUTPUT_DIR / "invite_codes.csv", invite_rows, INVITE_FIELDS)

print("\n완료. generated/ 3개 CSV가 현재 DB 상태로 갱신됐습니다.")
