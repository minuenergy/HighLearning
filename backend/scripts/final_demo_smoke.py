from __future__ import annotations

import csv
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from supabase import create_client


ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = ROOT / "backend"
SEED_ROOT = BACKEND_ROOT / "supabase" / "seeds" / "generated"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def load_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def http_request(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    expected_status: int = 200,
    timeout_seconds: int = 30,
) -> Any:
    data = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            body = response.read().decode("utf-8", errors="replace")
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {url} -> HTTP {error.code}: {body[:300]}") from error
    except URLError as error:
        raise AssertionError(f"{method} {url} -> 연결 실패: {error}") from error

    if status != expected_status:
        raise AssertionError(f"{method} {url} -> 예상 {expected_status}, 실제 {status}: {body[:300]}")

    if not body:
        return None

    if "application/json" in content_type or body.lstrip().startswith(("{", "[")):
        return json.loads(body)
    return body


def wait_until(predicate, *, timeout_seconds: int = 15, interval_seconds: float = 1.0, message: str = ""):
    start = time.time()
    last_error: Exception | None = None
    while time.time() - start < timeout_seconds:
        try:
            value = predicate()
            if value:
                return value
        except Exception as error:  # pragma: no cover - smoke helper
            last_error = error
        time.sleep(interval_seconds)
    if last_error:
        raise AssertionError(message or str(last_error)) from last_error
    raise AssertionError(message or "조건이 시간 내 충족되지 않았습니다.")


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def cleanup_exam(supabase, exam_id: str) -> None:
    attempts = supabase.table("exam_attempts").select("id").eq("exam_id", exam_id).execute().data or []
    attempt_ids = [row["id"] for row in attempts]
    if attempt_ids:
        supabase.table("exam_answers").delete().in_("attempt_id", attempt_ids).execute()
    supabase.table("exam_attempts").delete().eq("exam_id", exam_id).execute()
    supabase.table("notifications").delete().eq("exam_id", exam_id).execute()
    supabase.table("exam_questions").delete().eq("exam_id", exam_id).execute()
    supabase.table("exams").delete().eq("id", exam_id).execute()


def main() -> int:
    load_dotenv(BACKEND_ROOT / ".env")
    frontend_url = os.environ.get("SMOKE_FRONTEND_URL", "http://127.0.0.1:3000")
    backend_url = os.environ.get("SMOKE_BACKEND_URL", "http://127.0.0.1:8000")
    supabase_url = os.environ["SUPABASE_URL"]
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    supabase = create_client(supabase_url, service_role_key)

    teacher_rows = load_csv_rows(SEED_ROOT / "teacher_accounts.csv")
    student_rows = load_csv_rows(SEED_ROOT / "student_accounts.csv")
    teacher = next(row for row in teacher_rows if row["account_type"] == "teacher")
    student = next(row for row in student_rows if row["teacher_id"] == teacher["user_id"])

    results: list[tuple[str, str]] = []
    temporary_exam_id: str | None = None

    def run_step(name: str, fn) -> None:
        print(f"[RUN ] {name}")
        fn()
        results.append(("PASS", name))
        print(f"[PASS] {name}")

    def check_public_routes() -> None:
        for path in ["/", "/auth/login", "/auth/signup", "/teacher/dashboard", "/student/dashboard"]:
            body = http_request(f"{frontend_url}{path}", timeout_seconds=60)
            assert_true(isinstance(body, str) and "<html" in body.lower(), f"{path} 페이지 응답이 HTML이 아닙니다.")

    def check_student_workspace_flows() -> None:
        students_overview = http_request(f"{backend_url}/api/workspace/teacher/{teacher['user_id']}/students")
        assert_true(len(students_overview["classes"]) > 0, "학생 관리 overview에 반 데이터가 없습니다.")
        group = students_overview["classes"][0]
        student_detail = http_request(
            f"{backend_url}/api/workspace/teacher/{teacher['user_id']}/students/{student['user_id']}?group_id={group['id']}"
        )
        assert_true("llm_briefing" in student_detail, "학생 상세에 Gemini 브리핑이 없습니다.")
        assert_true(
            "executive_summary" in student_detail["llm_briefing"],
            "학생 상세 브리핑에 executive_summary가 없습니다.",
        )

    def check_exam_schedule_and_student_flow() -> None:
        nonlocal temporary_exam_id

        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        create_payload = {
            "course_id": teacher["course_id"],
            "teacher_id": teacher["user_id"],
            "title": f"[QA] 데모 시험 {timestamp}",
            "description": "최종 QA 자동 점검용 임시 시험",
            "exam_date": datetime.now(timezone.utc).date().isoformat(),
            "duration_minutes": 20,
            "workflow_status": "draft",
            "assignment_type": "homework",
            "source_format": "manual",
            "learning_objective": "학생이 핵심 개념을 스스로 설명하고 근거를 찾도록 돕는다.",
            "questions": [
                {
                    "concept": "국어 핵심 개념",
                    "prompt": "글의 중심 생각을 가장 잘 설명한 선택지를 고르세요.",
                    "choices": [
                        {"label": "A", "text": "세부 정보 하나만 고르면 된다."},
                        {"label": "B", "text": "글 전체를 관통하는 핵심 생각을 찾아야 한다."},
                        {"label": "C", "text": "가장 긴 문장을 고르면 된다."},
                    ],
                    "answer": "B",
                    "explanation": "중심 생각은 글 전체를 관통하는 핵심 내용입니다.",
                    "points": 10,
                    "source_pages": [1],
                    "evidence_excerpt": "중심 생각은 여러 문장을 묶는 핵심 의미다.",
                },
                {
                    "concept": "국어 근거 찾기",
                    "prompt": "주장을 뒷받침하는 근거를 고르는 태도로 가장 적절한 것은 무엇인가요?",
                    "choices": [
                        {"label": "A", "text": "느낌만으로 정한다."},
                        {"label": "B", "text": "지문에서 해당 주장을 직접 뒷받침하는 문장을 찾는다."},
                        {"label": "C", "text": "가장 짧은 문장을 고른다."},
                    ],
                    "answer": "B",
                    "explanation": "근거는 주장과 직접 연결되는 문장이나 자료입니다.",
                    "points": 10,
                    "source_pages": [2],
                    "evidence_excerpt": "근거는 주장과 직접 연결되는 문장이나 자료이다.",
                },
            ],
        }
        expected_answer_by_order = {
            index + 1: question["answer"]
            for index, question in enumerate(create_payload["questions"])
        }
        created = http_request(
            f"{backend_url}/api/exams/editor",
            method="POST",
            payload=create_payload,
        )
        temporary_exam_id = created["exam"]["id"]

        publish_at = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
        due_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        published = http_request(
            f"{backend_url}/api/exams/{temporary_exam_id}/publish",
            method="POST",
            payload={
                "publish_at": publish_at,
                "due_at": due_at,
                "assignment_type": "homework",
            },
        )
        assert_true(bool(published.get("scheduled")), "임시 시험이 예약 상태로 저장되지 않았습니다.")

        schedule_status = http_request(
            f"{backend_url}/api/exams/course/{teacher['course_id']}/schedule-status"
        )
        assert_true(schedule_status["scheduled_exams"] >= 1, "예약 시험 수가 반영되지 않았습니다.")

        def student_exam_visible():
            exams = http_request(f"{backend_url}/api/exams/student/{student['user_id']}/{teacher['course_id']}")
            return next((exam for exam in exams if exam["id"] == temporary_exam_id), None)

        visible_exam = wait_until(
            student_exam_visible,
            timeout_seconds=20,
            interval_seconds=2,
            message="예약 시험이 학생 시험 목록에 나타나지 않았습니다.",
        )
        assert_true(visible_exam.get("workflow_status") == "published", "예약 시험이 자동으로 published 전환되지 않았습니다.")

        notifications = http_request(
            f"{backend_url}/api/exams/student/{student['user_id']}/{teacher['course_id']}/notifications"
        )
        matching_notification = next((row for row in notifications if row.get("exam_id") == temporary_exam_id), None)
        assert_true(matching_notification is not None, "학생 알림에 예약 시험 공지가 없습니다.")
        assert_true(bool(matching_notification.get("exam_title")), "학생 알림에 시험 제목 메타데이터가 없습니다.")

        detail = http_request(
            f"{backend_url}/api/exams/{temporary_exam_id}?student_id={student['user_id']}"
        )
        assert_true(len(detail["questions"]) == 2, "학생 시험 상세 문항 수가 기대와 다릅니다.")

        first_question = detail["questions"][0]
        second_question = detail["questions"][1]
        submit_result = http_request(
            f"{backend_url}/api/exams/{temporary_exam_id}/submit",
            method="POST",
            payload={
                "student_id": student["user_id"],
                "answers": {
                    first_question["id"]: "A",
                    second_question["id"]: "B",
                },
                "duration_minutes": 7,
            },
        )
        wrong_question = next((question for question in submit_result["questions"] if question.get("is_correct") is False), None)
        assert_true(wrong_question is not None, "오답 복기 테스트용 오답 문항이 생성되지 않았습니다.")
        corrected_choice = expected_answer_by_order.get(wrong_question["question_order"])
        assert_true(bool(corrected_choice), "복기 제출용 정답 선택지를 찾지 못했습니다.")

        notifications_after_submit = http_request(
            f"{backend_url}/api/exams/student/{student['user_id']}/{teacher['course_id']}/notifications"
        )
        assert_true(
            all(row.get("exam_id") != temporary_exam_id for row in notifications_after_submit),
            "시험 제출 후에도 해당 시험 알림이 pending 상태로 남아 있습니다.",
        )

        review_result = http_request(
            f"{backend_url}/api/exams/answers/{wrong_question['answer_id']}/review",
            method="POST",
            payload={
                "student_id": student["user_id"],
                "corrected_choice": corrected_choice,
            },
        )
        reviewed_question = next(
            (question for question in review_result["questions"] if question.get("answer_id") == wrong_question["answer_id"]),
            None,
        )
        assert_true(
            bool(reviewed_question and reviewed_question.get("resolved_via_tutor")),
            "오답 복기 후 resolved_via_tutor 상태가 반영되지 않았습니다.",
        )

    def check_subject_workspace_flows() -> None:
        subjects_overview = http_request(f"{backend_url}/api/workspace/teacher/{teacher['user_id']}/subjects")
        assert_true(len(subjects_overview["subjects"]) > 0, "임시 시험 응시 후에도 과목 관리 overview 데이터가 없습니다.")
        subject_name = subjects_overview["subjects"][0]["subject"]
        subject_briefing = http_request(
            f"{backend_url}/api/workspace/teacher/{teacher['user_id']}/subjects/{quote(subject_name)}"
        )
        assert_true(
            bool(subject_briefing.get("executive_summary")),
            "과목 브리핑 executive_summary가 비어 있습니다.",
        )

    try:
        run_step("공개 프론트 페이지 응답 확인", check_public_routes)
        run_step("교사 학생 상세 Gemini 브리핑 API 확인", check_student_workspace_flows)
        run_step("예약 배포 -> 학생 알림 -> 제출 -> 오답 복기 플로우 확인", check_exam_schedule_and_student_flow)
        run_step("교사 과목 Gemini 브리핑 API 확인", check_subject_workspace_flows)
    finally:
        if temporary_exam_id:
            cleanup_exam(supabase, temporary_exam_id)

    print("\n=== FINAL SMOKE SUMMARY ===")
    for status, name in results:
        print(f"{status} - {name}")
    print(f"총 {len(results)}개 시나리오 통과")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
