"""
어드민 초대코드 기반 회원가입 흐름 시드 스크립트

생성 대상
- 최초 어드민 교사 1명
- 어드민 초대코드로 가입한 교사 5명
- 각 교사가 학생 초대코드로 가입시킨 학생 150명(교사당 30명)

추가 작업
- 교사/학생 계정 CSV 내보내기
- 초대코드 CSV 내보내기

사용법:
  cd socrateach/backend
  ./.venv/bin/python supabase/seeds/seed_admin_invite_accounts.py
"""

from __future__ import annotations

import csv
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

ROOT_DIR = Path(__file__).resolve().parents[2]
OUTPUT_DIR = Path(__file__).resolve().parent / "generated"
ENV_PATH = ROOT_DIR / ".env"

load_dotenv(ENV_PATH)

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.config import settings  # noqa: E402
from app.services.verification_service import (  # noqa: E402
    finalize_student_signup,
    finalize_teacher_signup,
    issue_student_invite_code,
    issue_teacher_invite_code,
)

supabase = create_client(settings.supabase_url, settings.supabase_service_role_key)
NAMESPACE = uuid.UUID("5d6ab337-3be3-4e4d-8df8-6f1226827f7d")
ACADEMIC_YEAR = 2026
SCHOOL_NAME = "소크라중학교"
SCHOOL_DOMAIN = "socrateach.school"
ADMIN_PASSWORD = "SocraTeachAdmin!2026"
TEACHER_PASSWORD = "SocraTeachTeacher!2026"
STUDENT_PASSWORD = "SocraTeachStudent!2026"
STUDENTS_PER_TEACHER = 30


@dataclass(frozen=True)
class TeacherBlueprint:
    index: int
    full_name: str
    subject_name: str
    grade_level: str
    class_label: str
    phone_number: str


TEACHER_BLUEPRINTS: tuple[TeacherBlueprint, ...] = (
    TeacherBlueprint(1, "김서윤", "국어", "중1", "1반", "010-5100-0001"),
    TeacherBlueprint(2, "이도현", "수학", "중1", "2반", "010-5100-0002"),
    TeacherBlueprint(3, "박하린", "영어", "중2", "3반", "010-5100-0003"),
    TeacherBlueprint(4, "최준호", "과학", "중2", "4반", "010-5100-0004"),
    TeacherBlueprint(5, "정가은", "사회", "중3", "5반", "010-5100-0005"),
)

SURNAME_PARTS = ("김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "오", "한", "서", "권", "유")
NAME_FIRST_PARTS = ("서", "도", "하", "지", "민", "예", "수", "현", "가", "채")
NAME_SECOND_PARTS = ("윤", "준", "아", "현", "호", "린", "은", "우", "원", "율")


def seeded_uuid(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, slug))


def build_student_name(index: int) -> str:
    surname = SURNAME_PARTS[index % len(SURNAME_PARTS)]
    first = NAME_FIRST_PARTS[(index // len(SURNAME_PARTS)) % len(NAME_FIRST_PARTS)]
    second = NAME_SECOND_PARTS[(index // (len(SURNAME_PARTS) * len(NAME_FIRST_PARTS))) % len(NAME_SECOND_PARTS)]
    return f"{surname}{first}{second}"


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def safe_delete(table_name: str, column_name: str, values: list[str]) -> None:
    if not values:
        return
    try:
        supabase.table(table_name).delete().in_(column_name, values).execute()
    except Exception:
        pass


def create_auth_user(*, user_id: str, email: str, password: str, role: str) -> None:
    supabase.auth.admin.create_user(
        {
            "id": user_id,
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"role": role},
        }
    )


def insert_profile(*, user_id: str, email: str, full_name: str, role: str) -> None:
    supabase.table("profiles").insert(
        {
            "id": user_id,
            "email": email,
            "full_name": full_name,
            "role": role,
        }
    ).execute()


def cleanup_existing_seed_data() -> None:
    admin_id = seeded_uuid("seed-admin")
    teacher_ids = [seeded_uuid(f"seed-teacher-{item.index}") for item in TEACHER_BLUEPRINTS]
    student_ids = [
        seeded_uuid(f"seed-student-{teacher.index}-{student_number}")
        for teacher in TEACHER_BLUEPRINTS
        for student_number in range(1, STUDENTS_PER_TEACHER + 1)
    ]
    class_ids = [seeded_uuid(f"seed-class-{item.index}") for item in TEACHER_BLUEPRINTS]
    course_ids = [seeded_uuid(f"seed-course-{item.index}") for item in TEACHER_BLUEPRINTS]
    all_teacher_ids = [admin_id, *teacher_ids]
    all_profile_ids = [*all_teacher_ids, *student_ids]

    print("기존 어드민/초대코드 시드 데이터 정리 중...")

    conversation_rows = []
    try:
        conversation_rows = (
            supabase.table("tutor_conversations")
            .select("id")
            .in_("student_id", student_ids)
            .execute()
            .data
            or []
        )
    except Exception:
        conversation_rows = []
    conversation_ids = [row["id"] for row in conversation_rows]
    safe_delete("tutor_messages", "conversation_id", conversation_ids)
    safe_delete("tutor_conversations", "id", conversation_ids)

    safe_delete("notifications", "course_id", course_ids)
    safe_delete("teacher_notes", "teacher_id", all_teacher_ids)
    safe_delete("teacher_notes", "student_id", student_ids)
    safe_delete("concept_stats", "course_id", course_ids)
    safe_delete("concept_stats", "student_id", student_ids)

    attempt_rows = []
    try:
        attempt_rows = (
            supabase.table("exam_attempts")
            .select("id")
            .in_("course_id", course_ids)
            .execute()
            .data
            or []
        )
    except Exception:
        attempt_rows = []
    attempt_ids = [row["id"] for row in attempt_rows]
    safe_delete("exam_answers", "attempt_id", attempt_ids)
    safe_delete("exam_attempts", "id", attempt_ids)

    exam_rows = []
    try:
        exam_rows = (
            supabase.table("exams")
            .select("id")
            .in_("course_id", course_ids)
            .execute()
            .data
            or []
        )
    except Exception:
        exam_rows = []
    exam_ids = [row["id"] for row in exam_rows]
    safe_delete("exam_questions", "exam_id", exam_ids)
    safe_delete("exams", "id", exam_ids)

    safe_delete("materials", "course_id", course_ids)
    safe_delete("enrollments", "course_id", course_ids)
    safe_delete("enrollments", "student_id", student_ids)
    safe_delete("invite_codes", "created_by", all_teacher_ids)
    safe_delete("student_settings", "student_id", student_ids)
    safe_delete("teacher_settings", "teacher_id", all_teacher_ids)
    safe_delete("courses", "id", course_ids)
    safe_delete("school_classes", "id", class_ids)
    safe_delete("profiles", "id", all_profile_ids)

    for user_id in all_profile_ids:
        try:
            supabase.auth.admin.delete_user(user_id)
        except Exception:
            pass

    print("  완료")


def fetch_subject_map() -> dict[str, str]:
    subject_names = [item.subject_name for item in TEACHER_BLUEPRINTS]
    rows = (
        supabase.table("subjects")
        .select("id, name")
        .in_("name", subject_names)
        .execute()
        .data
        or []
    )
    subject_map = {row["name"]: row["id"] for row in rows}
    missing = [name for name in subject_names if name not in subject_map]
    if missing:
        raise RuntimeError(
            "subjects 테이블에 일부 과목이 없습니다. `006_workspace_domain_and_settings.sql` 마이그레이션 적용 여부를 확인해주세요: "
            + ", ".join(missing)
        )
    return subject_map


def create_school_class(*, class_id: str, teacher_id: str, blueprint: TeacherBlueprint) -> dict[str, Any]:
    title = f"{blueprint.grade_level} {blueprint.class_label}"
    payload = {
        "id": class_id,
        "teacher_id": teacher_id,
        "title": title,
        "grade_level": blueprint.grade_level,
        "class_label": blueprint.class_label,
        "academic_year": ACADEMIC_YEAR,
        "class_code": f"SEED-{blueprint.index:02d}",
    }
    supabase.table("school_classes").insert(payload).execute()
    return (
        supabase.table("school_classes")
        .select("*")
        .eq("id", class_id)
        .single()
        .execute()
        .data
    )


def create_course(
    *,
    course_id: str,
    teacher_id: str,
    class_id: str,
    subject_id: str,
    blueprint: TeacherBlueprint,
) -> dict[str, Any]:
    title = f"{blueprint.grade_level} {blueprint.class_label} {blueprint.subject_name}"
    payload = {
        "id": course_id,
        "teacher_id": teacher_id,
        "title": title,
        "description": f"{ACADEMIC_YEAR}학년도 {blueprint.grade_level} {blueprint.class_label} {blueprint.subject_name} 수업",
        "school_class_id": class_id,
        "subject_id": subject_id,
        "academic_year": ACADEMIC_YEAR,
        "grade_level": blueprint.grade_level,
        "class_label": blueprint.class_label,
        "subject_name": blueprint.subject_name,
    }
    supabase.table("courses").insert(payload).execute()
    return (
        supabase.table("courses")
        .select("*")
        .eq("id", course_id)
        .single()
        .execute()
        .data
    )


def seed_accounts() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    subject_map = fetch_subject_map()

    teacher_exports: list[dict[str, Any]] = []
    student_exports: list[dict[str, Any]] = []
    invite_exports: list[dict[str, Any]] = []

    admin_id = seeded_uuid("seed-admin")
    admin_email = f"admin@{SCHOOL_DOMAIN}"
    admin_name = "한도윤"
    admin_phone = "010-5100-0000"

    print("어드민 교사 계정 생성 중...")
    create_auth_user(user_id=admin_id, email=admin_email, password=ADMIN_PASSWORD, role="teacher")
    insert_profile(user_id=admin_id, email=admin_email, full_name=admin_name, role="teacher")
    admin_settings = finalize_teacher_signup(
        user_id=admin_id,
        email=admin_email,
        full_name=admin_name,
        phone_number=admin_phone,
        school_name=SCHOOL_NAME,
        school_email=admin_email,
        verification_method="school_email",
        subject_names=["운영", "국어", "수학", "영어", "과학", "사회"],
        grade_levels=["중1", "중2", "중3"],
        class_labels=[blueprint.class_label for blueprint in TEACHER_BLUEPRINTS],
    )
    teacher_exports.append(
        {
            "account_type": "admin_teacher",
            "user_id": admin_id,
            "email": admin_email,
            "password": ADMIN_PASSWORD,
            "full_name": admin_name,
            "role": "teacher",
            "school_name": admin_settings.get("school_name"),
            "school_email": admin_settings.get("school_email"),
            "phone_number": admin_settings.get("phone_number"),
            "verification_status": admin_settings.get("verification_status"),
            "verification_method": admin_settings.get("verification_method"),
            "invite_code_used": admin_settings.get("invite_code_used"),
            "verified_at": admin_settings.get("verified_at"),
            "subject_names": ",".join(admin_settings.get("subject_names") or []),
            "grade_levels": ",".join(admin_settings.get("grade_levels") or []),
            "class_labels": ",".join(admin_settings.get("class_labels") or []),
            "class_id": "",
            "class_title": "",
            "course_id": "",
            "course_title": "",
        }
    )

    print("초대코드 기반 교사/학생 계정 생성 중...")
    global_student_index = 1
    for blueprint in TEACHER_BLUEPRINTS:
        teacher_id = seeded_uuid(f"seed-teacher-{blueprint.index}")
        teacher_email = f"teacher{blueprint.index:02d}@{SCHOOL_DOMAIN}"
        class_id = seeded_uuid(f"seed-class-{blueprint.index}")
        course_id = seeded_uuid(f"seed-course-{blueprint.index}")

        teacher_invite = issue_teacher_invite_code(
            teacher_id=admin_id,
            label=f"{SCHOOL_NAME} {blueprint.subject_name} 교사 초대 {blueprint.index}",
            subject_names=[blueprint.subject_name],
            max_uses=1,
            expires_days=180,
        )
        invite_exports.append(
            {
                "code": teacher_invite["code"],
                "role": teacher_invite["role"],
                "purpose": teacher_invite["purpose"],
                "created_by": admin_id,
                "created_by_name": admin_name,
                "label": teacher_invite.get("label"),
                "school_class_id": teacher_invite.get("school_class_id"),
                "course_id": teacher_invite.get("course_id"),
                "subject_names": ",".join(teacher_invite.get("subject_names") or []),
                "max_uses": teacher_invite.get("max_uses"),
                "used_count": teacher_invite.get("used_count"),
                "active": teacher_invite.get("active"),
                "expires_at": teacher_invite.get("expires_at"),
            }
        )

        create_auth_user(user_id=teacher_id, email=teacher_email, password=TEACHER_PASSWORD, role="teacher")
        insert_profile(user_id=teacher_id, email=teacher_email, full_name=blueprint.full_name, role="teacher")
        teacher_settings = finalize_teacher_signup(
            user_id=teacher_id,
            email=teacher_email,
            full_name=blueprint.full_name,
            phone_number=blueprint.phone_number,
            school_name="",
            school_email="",
            verification_method="invite_code",
            invite_code=teacher_invite["code"],
            subject_names=[blueprint.subject_name],
            grade_levels=[blueprint.grade_level],
            class_labels=[blueprint.class_label],
        )

        class_row = create_school_class(
            class_id=class_id,
            teacher_id=teacher_id,
            blueprint=blueprint,
        )
        course_row = create_course(
            course_id=course_id,
            teacher_id=teacher_id,
            class_id=class_id,
            subject_id=subject_map[blueprint.subject_name],
            blueprint=blueprint,
        )

        teacher_exports.append(
            {
                "account_type": "teacher",
                "user_id": teacher_id,
                "email": teacher_email,
                "password": TEACHER_PASSWORD,
                "full_name": blueprint.full_name,
                "role": "teacher",
                "school_name": teacher_settings.get("school_name"),
                "school_email": teacher_settings.get("school_email"),
                "phone_number": teacher_settings.get("phone_number"),
                "verification_status": teacher_settings.get("verification_status"),
                "verification_method": teacher_settings.get("verification_method"),
                "invite_code_used": teacher_settings.get("invite_code_used"),
                "verified_at": teacher_settings.get("verified_at"),
                "subject_names": ",".join(teacher_settings.get("subject_names") or []),
                "grade_levels": ",".join(teacher_settings.get("grade_levels") or []),
                "class_labels": ",".join(teacher_settings.get("class_labels") or []),
                "class_id": class_row.get("id"),
                "class_title": class_row.get("title"),
                "course_id": course_row.get("id"),
                "course_title": course_row.get("title"),
            }
        )

        student_invite = issue_student_invite_code(
            teacher_id=teacher_id,
            label=class_row.get("title") or blueprint.class_label,
            course_id=course_id,
            school_class_id=class_id,
            subject_names=[blueprint.subject_name],
            max_uses=STUDENTS_PER_TEACHER + 5,
            expires_days=180,
        )
        invite_exports.append(
            {
                "code": student_invite["code"],
                "role": student_invite["role"],
                "purpose": student_invite["purpose"],
                "created_by": teacher_id,
                "created_by_name": blueprint.full_name,
                "label": student_invite.get("label"),
                "school_class_id": student_invite.get("school_class_id"),
                "course_id": student_invite.get("course_id"),
                "subject_names": ",".join(student_invite.get("subject_names") or []),
                "max_uses": student_invite.get("max_uses"),
                "used_count": student_invite.get("used_count"),
                "active": student_invite.get("active"),
                "expires_at": student_invite.get("expires_at"),
            }
        )

        for student_number in range(1, STUDENTS_PER_TEACHER + 1):
            student_slug = f"seed-student-{blueprint.index}-{student_number}"
            student_id = seeded_uuid(student_slug)
            student_email = f"student{global_student_index:03d}@{SCHOOL_DOMAIN}"
            student_name = build_student_name(global_student_index - 1)
            phone_number = f"010-6200-{global_student_index:04d}"

            create_auth_user(
                user_id=student_id,
                email=student_email,
                password=STUDENT_PASSWORD,
                role="student",
            )
            insert_profile(
                user_id=student_id,
                email=student_email,
                full_name=student_name,
                role="student",
            )
            student_settings = finalize_student_signup(
                user_id=student_id,
                email=student_email,
                full_name=student_name,
                phone_number=phone_number,
                student_number=f"{student_number:02d}",
                invite_code=student_invite["code"],
            )

            student_exports.append(
                {
                    "user_id": student_id,
                    "email": student_email,
                    "password": STUDENT_PASSWORD,
                    "full_name": student_name,
                    "role": "student",
                    "phone_number": phone_number,
                    "student_number": student_settings.get("student_number"),
                    "verification_status": student_settings.get("verification_status"),
                    "verification_method": student_settings.get("verification_method"),
                    "invite_code_used": student_settings.get("invite_code_used"),
                    "verified_at": student_settings.get("verified_at"),
                    "school_class_id": student_settings.get("school_class_id"),
                    "class_label": student_settings.get("class_label"),
                    "course_id": student_settings.get("course_id"),
                    "teacher_id": teacher_id,
                    "teacher_name": blueprint.full_name,
                    "teacher_email": teacher_email,
                    "subject_name": blueprint.subject_name,
                    "grade_level": blueprint.grade_level,
                }
            )
            global_student_index += 1

    return teacher_exports, student_exports, invite_exports


def export_seed_csvs(
    teacher_rows: list[dict[str, Any]],
    student_rows: list[dict[str, Any]],
    invite_rows: list[dict[str, Any]],
) -> None:
    teacher_fields = [
        "account_type",
        "user_id",
        "email",
        "password",
        "full_name",
        "role",
        "school_name",
        "school_email",
        "phone_number",
        "verification_status",
        "verification_method",
        "invite_code_used",
        "verified_at",
        "subject_names",
        "grade_levels",
        "class_labels",
        "class_id",
        "class_title",
        "course_id",
        "course_title",
    ]
    student_fields = [
        "user_id",
        "email",
        "password",
        "full_name",
        "role",
        "phone_number",
        "student_number",
        "verification_status",
        "verification_method",
        "invite_code_used",
        "verified_at",
        "school_class_id",
        "class_label",
        "course_id",
        "teacher_id",
        "teacher_name",
        "teacher_email",
        "subject_name",
        "grade_level",
    ]
    invite_fields = [
        "code",
        "role",
        "purpose",
        "created_by",
        "created_by_name",
        "label",
        "school_class_id",
        "course_id",
        "subject_names",
        "max_uses",
        "used_count",
        "active",
        "expires_at",
    ]

    write_csv(OUTPUT_DIR / "teacher_accounts.csv", teacher_rows, teacher_fields)
    write_csv(OUTPUT_DIR / "student_accounts.csv", student_rows, student_fields)
    write_csv(OUTPUT_DIR / "invite_codes.csv", invite_rows, invite_fields)


def verify_seed_counts() -> None:
    teacher_count = (
        supabase.table("profiles")
        .select("id", count="exact")
        .eq("role", "teacher")
        .in_("email", [f"admin@{SCHOOL_DOMAIN}", *[f"teacher{item.index:02d}@{SCHOOL_DOMAIN}" for item in TEACHER_BLUEPRINTS]])
        .execute()
        .count
    )
    student_count = (
        supabase.table("profiles")
        .select("id", count="exact")
        .eq("role", "student")
        .like("email", f"%@{SCHOOL_DOMAIN}")
        .execute()
        .count
    )
    enrollment_count = (
        supabase.table("enrollments")
        .select("id", count="exact")
        .in_("course_id", [seeded_uuid(f"seed-course-{item.index}") for item in TEACHER_BLUEPRINTS])
        .execute()
        .count
    )

    print(f"검증: 교사 {teacher_count}명, 학생 {student_count}명, 수강 등록 {enrollment_count}건")


def main() -> None:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.")

    cleanup_existing_seed_data()
    teacher_rows, student_rows, invite_rows = seed_accounts()
    export_seed_csvs(teacher_rows, student_rows, invite_rows)
    verify_seed_counts()

    print("")
    print("생성 완료")
    print(f"- 교사 CSV: {OUTPUT_DIR / 'teacher_accounts.csv'}")
    print(f"- 학생 CSV: {OUTPUT_DIR / 'student_accounts.csv'}")
    print(f"- 초대코드 CSV: {OUTPUT_DIR / 'invite_codes.csv'}")
    print(f"- 어드민 로그인: admin@{SCHOOL_DOMAIN} / {ADMIN_PASSWORD}")
    print(f"- 교사 공용 비밀번호: {TEACHER_PASSWORD}")
    print(f"- 학생 공용 비밀번호: {STUDENT_PASSWORD}")


if __name__ == "__main__":
    main()
