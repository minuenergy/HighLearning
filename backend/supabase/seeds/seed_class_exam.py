"""
반 시험 현황 대시보드 테스트용 시딩 스크립트
학생 30명 전원 시험 완료 데이터를 Supabase에 삽입합니다.

사용법:
  cd socrateach/backend
  python supabase/seeds/seed_class_exam.py

환경 변수 (.env):
  SUPABASE_URL=...
  SUPABASE_SERVICE_ROLE_KEY=...
"""

import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ────────────────────────────────────────
# 고정 UUID 상수
# ────────────────────────────────────────
TEACHER_ID   = "00000000-0000-0000-0000-000000000001"
COURSE_ID    = "00000000-0000-0000-0100-000000000001"
EXAM_ID      = "00000000-0000-0000-0200-000000000001"

STUDENT_IDS  = [f"00000000-0000-0000-0001-{i:012d}" for i in range(1, 31)]
QUESTION_IDS = [f"00000000-0000-0000-0300-{i:012d}" for i in range(1, 11)]

STUDENT_NAMES = [
    "김지수","이민준","박서연","최현우","정수아",
    "강민재","조예진","윤도현","장하은","임준혁",
    "오소희","한지민","서태양","권나연","유승현",
    "신채원","배준영","전지우","고예슬","문서준",
    "남하늘","양소현","방민호","성지현","홍태훈",
    "변예원","노승민","황지안","구민서","엄태경",
]

# Q1~Q10 정답 라벨
CORRECT_CHOICES = ["A","C","B","A","B","C","D","A","C","B"]
CONCEPTS        = ["일차함수","일차함수","일차함수","일차함수",
                   "연립방정식","연립방정식","도형","도형","비례식","비례식"]
DIFFICULTIES    = ["easy","medium","easy","medium","hard","hard","medium","medium","easy","medium"]

# 학생별 정답 패턴 (각 자리 = Q1~Q10, '1'=정답, '0'=오답)
PATTERNS = [
    "1111001111",  # 01 김지수   80점
    "1110001111",  # 02 이민준   70점
    "1111100111",  # 03 박서연   80점 (Q5=연립방정식 정답!)
    "1100001111",  # 04 최현우   60점
    "1100001011",  # 05 정수아   50점
    "1111011111",  # 06 강민재   90점 (Q6=연립방정식 정답!)
    "1101001111",  # 07 조예진   70점
    "1111001111",  # 08 윤도현   80점
    "1110010111",  # 09 장하은   70점 (Q6=정답, Q4/Q7=오답)
    "1000000011",  # 10 임준혁   30점
    "1111001110",  # 11 오소희   70점
    "1110001111",  # 12 한지민   70점
    "0100001011",  # 13 서태양   40점
    "1111011111",  # 14 권나연   90점 (Q6=정답!)
    "1100001111",  # 15 유승현   60점
    "1110001111",  # 16 신채원   70점
    "1000000001",  # 17 배준영   20점
    "1111001111",  # 18 전지우   80점
    "1110001011",  # 19 고예슬   60점
    "1100001111",  # 20 문서준   60점
    "1111011111",  # 21 남하늘   90점 (Q6=정답!)
    "0100001011",  # 22 양소현   40점
    "1110001111",  # 23 방민호   70점
    "1111001111",  # 24 성지현   80점
    "1100001011",  # 25 홍태훈   50점
    "1101001111",  # 26 변예원   70점
    "0000000011",  # 27 노승민   20점
    "1111001111",  # 28 황지안   80점
    "1100000111",  # 29 구민서   50점
    "1110001111",  # 30 엄태경   70점
]

EXAM_DATE = datetime(2026, 4, 3, 9, 0, tzinfo=timezone(timedelta(hours=9)))
DUE_DATE  = datetime(2026, 4, 3, 10, 0, tzinfo=timezone(timedelta(hours=9)))


def delete_existing():
    """기존 테스트 데이터 정리 (재실행 안전)"""
    print("기존 테스트 데이터 정리 중...")

    # tutor_messages → tutor_conversations
    conv_rows = supabase.table("tutor_conversations") \
        .select("id").eq("course_id", COURSE_ID).execute().data or []
    conv_ids = [r["id"] for r in conv_rows]
    if conv_ids:
        supabase.table("tutor_messages").delete().in_("conversation_id", conv_ids).execute()
    supabase.table("tutor_conversations").delete().eq("course_id", COURSE_ID).execute()

    # concept_stats
    supabase.table("concept_stats").delete().eq("course_id", COURSE_ID).execute()

    # notifications
    try:
        supabase.table("notifications").delete().eq("course_id", COURSE_ID).execute()
    except Exception:
        pass

    # exam_answers → exam_attempts
    attempt_rows = supabase.table("exam_attempts") \
        .select("id").eq("course_id", COURSE_ID).execute().data or []
    attempt_ids = [r["id"] for r in attempt_rows]
    if attempt_ids:
        supabase.table("exam_answers").delete().in_("attempt_id", attempt_ids).execute()
    supabase.table("exam_attempts").delete().eq("course_id", COURSE_ID).execute()

    # exam_questions → exams
    supabase.table("exam_questions").delete().eq("exam_id", EXAM_ID).execute()
    supabase.table("exams").delete().eq("course_id", COURSE_ID).execute()

    # enrollments
    supabase.table("enrollments").delete().eq("course_id", COURSE_ID).execute()

    # courses
    supabase.table("courses").delete().eq("id", COURSE_ID).execute()

    # profiles (students + teacher)
    all_ids = [TEACHER_ID] + STUDENT_IDS
    supabase.table("profiles").delete().in_("id", all_ids).execute()

    # auth users
    for uid in all_ids:
        try:
            supabase.auth.admin.delete_user(uid)
        except Exception:
            pass

    print("  완료")


def create_users():
    """Auth 유저 생성 (교사 + 학생 30명)"""
    print("Auth 유저 생성 중...")

    # 교사
    supabase.auth.admin.create_user({
        "user_metadata": {"role": "teacher"},
        "email": "teacher01@socrateach.test",
        "password": "testpass123",
        "email_confirm": True,
        "id": TEACHER_ID,
    })
    supabase.table("profiles").insert({
        "id": TEACHER_ID,
        "email": "teacher01@socrateach.test",
        "full_name": "김선생",
        "role": "teacher",
    }).execute()

    # 학생 30명
    for i, (sid, name) in enumerate(zip(STUDENT_IDS, STUDENT_NAMES), start=1):
        email = f"s{i:02d}@socrateach.test"
        supabase.auth.admin.create_user({
            "user_metadata": {"role": "student"},
            "email": email,
            "password": "testpass123",
            "email_confirm": True,
            "id": sid,
        })
        supabase.table("profiles").insert({
            "id": sid,
            "email": email,
            "full_name": name,
            "role": "student",
        }).execute()

    print(f"  교사 1명 + 학생 {len(STUDENT_IDS)}명 생성 완료")


def create_course_and_enrollments():
    """수업 생성 + 학생 등록"""
    print("수업 및 수강 등록 중...")

    supabase.table("courses").insert({
        "id": COURSE_ID,
        "teacher_id": TEACHER_ID,
        "title": "중학교 2학년 수학 (2반)",
        "description": "2026학년도 1학기 중학교 2학년 수학 수업입니다.",
    }).execute()

    enrollments = [{"course_id": COURSE_ID, "student_id": sid} for sid in STUDENT_IDS]
    supabase.table("enrollments").insert(enrollments).execute()

    print(f"  수업 1개 + 등록 {len(STUDENT_IDS)}명 완료")


def create_exam_and_questions():
    """시험 + 10문항 생성"""
    print("시험 및 문항 생성 중...")

    supabase.table("exams").insert({
        "id": EXAM_ID,
        "course_id": COURSE_ID,
        "title": "1학기 중간고사 – 일차함수와 연립방정식",
        "description": "일차함수, 연립방정식, 도형, 비례식 단원 종합 평가",
        "exam_date": EXAM_DATE.isoformat(),
        "duration_minutes": 40,
        "total_points": 100,
        "source_format": "manual",
        "workflow_status": "published",
        "assignment_type": "exam",
        "due_at": DUE_DATE.isoformat(),
        "published_at": datetime(2026, 4, 1, 12, 0, tzinfo=timezone(timedelta(hours=9))).isoformat(),
        "created_by": TEACHER_ID,
    }).execute()

    questions = [
        {
            "id": QUESTION_IDS[0],
            "exam_id": EXAM_ID, "question_order": 1,
            "concept_tag": "일차함수", "difficulty": "easy", "points": 10,
            "prompt": "다음 중 일차함수인 것은?",
            "choices": [
                {"label": "A", "text": "y = 2x + 3"},
                {"label": "B", "text": "y = x² + 1"},
                {"label": "C", "text": "y = 1/x"},
                {"label": "D", "text": "xy = 4"},
            ],
            "correct_choice": "A",
            "explanation": "y = 2x + 3은 x의 최고차항이 1차이므로 일차함수입니다.",
        },
        {
            "id": QUESTION_IDS[1],
            "exam_id": EXAM_ID, "question_order": 2,
            "concept_tag": "일차함수", "difficulty": "medium", "points": 10,
            "prompt": "일차함수 y = -3x + 2의 기울기는?",
            "choices": [
                {"label": "A", "text": "2"},
                {"label": "B", "text": "-2"},
                {"label": "C", "text": "-3"},
                {"label": "D", "text": "3"},
            ],
            "correct_choice": "C",
            "explanation": "y = ax + b에서 기울기는 x의 계수 a입니다. 따라서 기울기는 -3입니다.",
        },
        {
            "id": QUESTION_IDS[2],
            "exam_id": EXAM_ID, "question_order": 3,
            "concept_tag": "일차함수", "difficulty": "easy", "points": 10,
            "prompt": "일차함수 y = 4x - 5의 y절편은?",
            "choices": [
                {"label": "A", "text": "4"},
                {"label": "B", "text": "-5"},
                {"label": "C", "text": "5"},
                {"label": "D", "text": "-4"},
            ],
            "correct_choice": "B",
            "explanation": "y절편은 x = 0일 때의 y값입니다. y = 4(0) - 5 = -5",
        },
        {
            "id": QUESTION_IDS[3],
            "exam_id": EXAM_ID, "question_order": 4,
            "concept_tag": "일차함수", "difficulty": "medium", "points": 10,
            "prompt": "기울기가 2이고 점 (1, 3)을 지나는 일차함수의 식은?",
            "choices": [
                {"label": "A", "text": "y = 2x + 1"},
                {"label": "B", "text": "y = 2x + 3"},
                {"label": "C", "text": "y = 2x - 1"},
                {"label": "D", "text": "y = 2x - 3"},
            ],
            "correct_choice": "A",
            "explanation": "y = 2x + b에 점 (1, 3) 대입: 3 = 2(1) + b → b = 1. 따라서 y = 2x + 1",
        },
        {
            "id": QUESTION_IDS[4],
            "exam_id": EXAM_ID, "question_order": 5,
            "concept_tag": "연립방정식", "difficulty": "hard", "points": 10,
            "prompt": "연립방정식 2x + y = 5, x - y = 1의 해는?",
            "choices": [
                {"label": "A", "text": "x=1, y=3"},
                {"label": "B", "text": "x=2, y=1"},
                {"label": "C", "text": "x=3, y=-1"},
                {"label": "D", "text": "x=1, y=2"},
            ],
            "correct_choice": "B",
            "explanation": "두 식을 더하면 3x = 6 → x = 2. x를 첫 식에 대입: 4 + y = 5 → y = 1",
        },
        {
            "id": QUESTION_IDS[5],
            "exam_id": EXAM_ID, "question_order": 6,
            "concept_tag": "연립방정식", "difficulty": "hard", "points": 10,
            "prompt": "두 수의 합이 10이고 차가 4일 때, 큰 수는?",
            "choices": [
                {"label": "A", "text": "5"},
                {"label": "B", "text": "6"},
                {"label": "C", "text": "7"},
                {"label": "D", "text": "8"},
            ],
            "correct_choice": "C",
            "explanation": "x+y=10, x-y=4 → 2x=14 → x=7 (큰 수), y=3 (작은 수)",
        },
        {
            "id": QUESTION_IDS[6],
            "exam_id": EXAM_ID, "question_order": 7,
            "concept_tag": "도형", "difficulty": "medium", "points": 10,
            "prompt": "밑변이 6cm, 높이가 4cm인 삼각형의 넓이는?",
            "choices": [
                {"label": "A", "text": "24cm²"},
                {"label": "B", "text": "10cm²"},
                {"label": "C", "text": "20cm²"},
                {"label": "D", "text": "12cm²"},
            ],
            "correct_choice": "D",
            "explanation": "삼각형 넓이 = 밑변 × 높이 ÷ 2 = 6 × 4 ÷ 2 = 12cm²",
        },
        {
            "id": QUESTION_IDS[7],
            "exam_id": EXAM_ID, "question_order": 8,
            "concept_tag": "도형", "difficulty": "medium", "points": 10,
            "prompt": "직각삼각형에서 두 직각변이 3cm, 4cm일 때 빗변의 길이는?",
            "choices": [
                {"label": "A", "text": "5cm"},
                {"label": "B", "text": "6cm"},
                {"label": "C", "text": "7cm"},
                {"label": "D", "text": "4.5cm"},
            ],
            "correct_choice": "A",
            "explanation": "피타고라스 정리: c² = 3² + 4² = 9 + 16 = 25 → c = 5cm",
        },
        {
            "id": QUESTION_IDS[8],
            "exam_id": EXAM_ID, "question_order": 9,
            "concept_tag": "비례식", "difficulty": "easy", "points": 10,
            "prompt": "비례식 3:4 = x:12에서 x의 값은?",
            "choices": [
                {"label": "A", "text": "4"},
                {"label": "B", "text": "8"},
                {"label": "C", "text": "9"},
                {"label": "D", "text": "16"},
            ],
            "correct_choice": "C",
            "explanation": "외항의 곱 = 내항의 곱: 3 × 12 = 4 × x → 36 = 4x → x = 9",
        },
        {
            "id": QUESTION_IDS[9],
            "exam_id": EXAM_ID, "question_order": 10,
            "concept_tag": "비례식", "difficulty": "medium", "points": 10,
            "prompt": "어떤 수와 3의 비가 4:1일 때, 그 수는?",
            "choices": [
                {"label": "A", "text": "3"},
                {"label": "B", "text": "12"},
                {"label": "C", "text": "6"},
                {"label": "D", "text": "9"},
            ],
            "correct_choice": "B",
            "explanation": "x:3 = 4:1 → x = 3 × 4 = 12",
        },
    ]

    supabase.table("exam_questions").insert(questions).execute()
    print("  시험 1개 + 문항 10개 생성 완료")


def create_attempts_and_answers():
    """시험 응시 + 답안 생성 (30명 전원)"""
    print("시험 응시 및 답안 생성 중...")

    wrong_choice_map = {}
    for i, correct in enumerate(CORRECT_CHOICES):
        wrong_choice_map[i] = "C" if correct in ("B", "D") else "B"

    for idx, (student_id, pattern) in enumerate(zip(STUDENT_IDS, PATTERNS)):
        correct_count = pattern.count("1")
        submit_time = EXAM_DATE + timedelta(minutes=20 + (idx * 7 % 18))

        attempt_resp = supabase.table("exam_attempts").insert({
            "exam_id": EXAM_ID,
            "course_id": COURSE_ID,
            "student_id": student_id,
            "attempt_number": 1,
            "score": correct_count * 10,
            "max_score": 100,
            "duration_minutes": 20 + (idx * 7 % 18),
            "status": "graded",
            "submitted_at": submit_time.isoformat(),
        }).execute()

        attempt_id = attempt_resp.data[0]["id"]

        answers = []
        for q_idx, (qid, correct_choice, concept, is_correct_char) in enumerate(
            zip(QUESTION_IDS, CORRECT_CHOICES, CONCEPTS, pattern)
        ):
            is_correct = is_correct_char == "1"
            selected = correct_choice if is_correct else wrong_choice_map[q_idx]
            answers.append({
                "attempt_id": attempt_id,
                "question_id": qid,
                "concept_tag": concept,
                "selected_choice": selected,
                "is_correct": is_correct,
            })

        supabase.table("exam_answers").insert(answers).execute()

    print(f"  응시 {len(STUDENT_IDS)}건 + 답안 {len(STUDENT_IDS) * 10}개 생성 완료")


def create_concept_stats():
    """개념별 이해도 통계 생성"""
    print("개념 통계 생성 중...")

    hard_students     = {9, 12, 16, 21, 26}   # 0-indexed (10,13,17,22,27번 학생)
    struggle_students = {3, 4, 8, 18, 24, 28} # 0-indexed
    strong_students   = {5, 13, 20, 2, 7, 17, 23, 27} # 0-indexed

    stats = []
    for i, student_id in enumerate(STUDENT_IDS):
        def stuck(base, hard_add=4, struggle_add=2):
            if i in hard_students: return base + hard_add
            if i in struggle_students: return base + struggle_add
            return base

        def resolved(base, strong_add=2, hard_sub=2):
            if i in hard_students: return max(0, base - hard_sub)
            if i in strong_students: return base + strong_add
            return base

        stats += [
            {"course_id": COURSE_ID, "student_id": student_id, "concept": "일차함수",
             "stuck_count": stuck(1), "resolved_count": resolved(2)},
            {"course_id": COURSE_ID, "student_id": student_id, "concept": "연립방정식",
             "stuck_count": stuck(3, 4, 1), "resolved_count": resolved(1, 2, 1)},
            {"course_id": COURSE_ID, "student_id": student_id, "concept": "도형",
             "stuck_count": stuck(1, 3, 1), "resolved_count": resolved(2, 1, 1)},
            {"course_id": COURSE_ID, "student_id": student_id, "concept": "비례식",
             "stuck_count": stuck(0, 3, 0), "resolved_count": resolved(3, 1, 1)},
        ]

    # 배치 삽입 (Supabase 최대 크기 고려, 50개씩)
    batch_size = 50
    for start in range(0, len(stats), batch_size):
        supabase.table("concept_stats").insert(stats[start:start + batch_size]).execute()

    print(f"  개념 통계 {len(stats)}개 생성 완료")


def create_tutor_conversations():
    """튜터 대화 생성 (대시보드 '대표 질의응답 근거' 섹션용)"""
    print("튜터 대화 생성 중...")

    conversations = [
        {
            "id": "cc000000-0000-0000-0000-000000000001",
            "student_id": STUDENT_IDS[9],  # 임준혁
            "course_id": COURSE_ID,
            "concept_tag": "연립방정식", "school_level": "중학교 2학년",
            "summary": "연립방정식 풀이 순서를 몰라 계속 막혔으나 대입법 개념을 단계별로 이해함",
            "stuck_count": 3, "resolved": True,
            "source_type": "exam_review",
            "source_reference_id": EXAM_ID,
            "started_at": "2026-04-03T10:05:00+09:00",
            "ended_at":   "2026-04-03T10:22:00+09:00",
        },
        {
            "id": "cc000000-0000-0000-0000-000000000002",
            "student_id": STUDENT_IDS[4],  # 정수아
            "course_id": COURSE_ID,
            "concept_tag": "연립방정식", "school_level": "중학교 2학년",
            "summary": "두 미지수를 동시에 구하는 것이 어려워 '한 식을 한 변수로 정리' 힌트로 돌파함",
            "stuck_count": 2, "resolved": True,
            "source_type": "exam_review",
            "source_reference_id": EXAM_ID,
            "started_at": "2026-04-03T10:08:00+09:00",
            "ended_at":   "2026-04-03T10:20:00+09:00",
        },
        {
            "id": "cc000000-0000-0000-0000-000000000003",
            "student_id": STUDENT_IDS[26],  # 노승민
            "course_id": COURSE_ID,
            "concept_tag": "연립방정식", "school_level": "중학교 2학년",
            "summary": "연립방정식 전체 개념이 모호하여 튜터가 수직선 위에 그림으로 설명하며 감 잡음",
            "stuck_count": 5, "resolved": False,
            "source_type": "tutor_session",
            "source_reference_id": None,
            "started_at": "2026-04-04T14:00:00+09:00",
            "ended_at":   "2026-04-04T14:30:00+09:00",
        },
        {
            "id": "cc000000-0000-0000-0000-000000000004",
            "student_id": STUDENT_IDS[3],  # 최현우
            "course_id": COURSE_ID,
            "concept_tag": "일차함수", "school_level": "중학교 2학년",
            "summary": "기울기와 절편의 관계를 헷갈려 했으나 그래프 직접 그려보며 이해",
            "stuck_count": 2, "resolved": True,
            "source_type": "tutor_session",
            "source_reference_id": None,
            "started_at": "2026-04-02T16:00:00+09:00",
            "ended_at":   "2026-04-02T16:15:00+09:00",
        },
        {
            "id": "cc000000-0000-0000-0000-000000000005",
            "student_id": STUDENT_IDS[12],  # 서태양
            "course_id": COURSE_ID,
            "concept_tag": "일차함수", "school_level": "중학교 2학년",
            "summary": "점을 대입해 식을 구하는 방법을 모르다가 단계별 풀이로 이해",
            "stuck_count": 3, "resolved": True,
            "source_type": "exam_review",
            "source_reference_id": EXAM_ID,
            "started_at": "2026-04-03T10:30:00+09:00",
            "ended_at":   "2026-04-03T10:45:00+09:00",
        },
    ]

    supabase.table("tutor_conversations").insert(conversations).execute()

    messages = [
        # 임준혁 – 연립방정식
        {"conversation_id": "cc000000-0000-0000-0000-000000000001", "role": "user",      "content": "2x + y = 5랑 x - y = 1을 어떻게 풀어요?", "message_order": 1},
        {"conversation_id": "cc000000-0000-0000-0000-000000000001", "role": "assistant", "content": "좋은 질문이에요! 먼저 두 식을 더하면 어떻게 될까요? 각 항끼리 더해보세요.", "message_order": 2},
        {"conversation_id": "cc000000-0000-0000-0000-000000000001", "role": "user",      "content": "더하면... 3x = 6이 되나요?", "message_order": 3},
        {"conversation_id": "cc000000-0000-0000-0000-000000000001", "role": "assistant", "content": "맞아요! 그럼 x는 얼마인가요? 그 값을 원래 식 중 하나에 대입해봐요.", "message_order": 4},

        # 정수아 – 연립방정식
        {"conversation_id": "cc000000-0000-0000-0000-000000000002", "role": "user",      "content": "두 수의 합이 10이고 차가 4라고 하는데 어떻게 식을 세우는지 모르겠어요", "message_order": 1},
        {"conversation_id": "cc000000-0000-0000-0000-000000000002", "role": "assistant", "content": "두 수를 x, y라고 할게요. '합이 10'은 어떤 식으로 쓸 수 있을까요?", "message_order": 2},
        {"conversation_id": "cc000000-0000-0000-0000-000000000002", "role": "user",      "content": "x + y = 10이요?", "message_order": 3},
        {"conversation_id": "cc000000-0000-0000-0000-000000000002", "role": "assistant", "content": "완벽해요! '차가 4'는요? x가 더 크다고 가정하면 어떻게 쓸까요?", "message_order": 4},

        # 노승민 – 연립방정식 (미해결)
        {"conversation_id": "cc000000-0000-0000-0000-000000000003", "role": "user",      "content": "연립방정식이 뭔지 모르겠어요. 그냥 방정식이랑 뭐가 달라요?", "message_order": 1},
        {"conversation_id": "cc000000-0000-0000-0000-000000000003", "role": "assistant", "content": "방정식 하나는 미지수가 하나예요. 연립방정식은 미지수 두 개인 식이 두 개 있어요. x + y = 5에서 x와 y가 될 수 있는 쌍이 몇 가지인지 생각해볼까요?", "message_order": 2},
        {"conversation_id": "cc000000-0000-0000-0000-000000000003", "role": "user",      "content": "엄청 많잖아요... 어떻게 하나만 구해요?", "message_order": 3},
        {"conversation_id": "cc000000-0000-0000-0000-000000000003", "role": "assistant", "content": "조건이 하나 더 있으면 범위가 좁혀지죠! x - y = 1이라는 조건도 함께 만족해야 한다면, 두 식을 더해보면 어떻게 될까요?", "message_order": 4},

        # 최현우 – 일차함수
        {"conversation_id": "cc000000-0000-0000-0000-000000000004", "role": "user",      "content": "y = 2x + 1에서 기울기가 2라는 게 무슨 뜻이에요?", "message_order": 1},
        {"conversation_id": "cc000000-0000-0000-0000-000000000004", "role": "assistant", "content": "x가 1 증가할 때 y가 얼마나 증가하는지를 나타내요. x를 1에서 2로 바꾸면 y는 어떻게 변하나요?", "message_order": 2},
        {"conversation_id": "cc000000-0000-0000-0000-000000000004", "role": "user",      "content": "y = 2×2+1 = 5, 원래는 3이었으니까 2 증가하네요!", "message_order": 3},
        {"conversation_id": "cc000000-0000-0000-0000-000000000004", "role": "assistant", "content": "완벽히 이해했어요! 기울기 2는 x가 1 늘면 y가 2 늘어난다는 뜻이에요. 그래프에서는 얼마나 가파른지 나타내죠.", "message_order": 4},

        # 서태양 – 일차함수
        {"conversation_id": "cc000000-0000-0000-0000-000000000005", "role": "user",      "content": "기울기 2이고 점 (1,3) 지나는 식을 어떻게 구해요?", "message_order": 1},
        {"conversation_id": "cc000000-0000-0000-0000-000000000005", "role": "assistant", "content": "y = 2x + b 형태로 시작해봐요. 점 (1,3)을 이 식에 넣으면 어떻게 되나요?", "message_order": 2},
        {"conversation_id": "cc000000-0000-0000-0000-000000000005", "role": "user",      "content": "3 = 2×1 + b니까 b = 1이에요?", "message_order": 3},
        {"conversation_id": "cc000000-0000-0000-0000-000000000005", "role": "assistant", "content": "완벽해요! y = 2x + 1이 답이에요. 이 방법으로 다른 점이 주어져도 항상 풀 수 있어요.", "message_order": 4},
    ]

    supabase.table("tutor_messages").insert(messages).execute()
    print(f"  대화 {len(conversations)}개 + 메시지 {len(messages)}개 생성 완료")


def verify():
    """삽입된 데이터 요약 출력"""
    print("\n── 검증 결과 ──────────────────────────────")

    students = supabase.table("profiles").select("id", count="exact") \
        .eq("role", "student").in_("id", STUDENT_IDS).execute()
    enrollments = supabase.table("enrollments").select("id", count="exact") \
        .eq("course_id", COURSE_ID).execute()
    attempts = supabase.table("exam_attempts").select("id,score", count="exact") \
        .eq("course_id", COURSE_ID).execute()
    avg_score = sum(r["score"] for r in attempts.data) / len(attempts.data) if attempts.data else 0

    print(f"  학생 수:    {students.count}명")
    print(f"  등록 수:    {enrollments.count}명")
    print(f"  응시 건수:  {attempts.count}건 (전원 완료)")
    print(f"  평균 점수:  {avg_score:.1f}점")

    concept_stats = supabase.table("concept_stats").select("id", count="exact") \
        .eq("course_id", COURSE_ID).execute()
    convs = supabase.table("tutor_conversations").select("id", count="exact") \
        .eq("course_id", COURSE_ID).execute()

    print(f"  개념 통계:  {concept_stats.count}개")
    print(f"  튜터 대화:  {convs.count}개")
    print("────────────────────────────────────────────")
    print("\n✓ 완료! 대시보드에서 teacher01@socrateach.test / testpass123 으로 로그인하세요.")
    print(f"  반 ID: {COURSE_ID}")


if __name__ == "__main__":
    print("=== 반 시험 현황 대시보드 테스트 시드 삽입 시작 ===\n")
    try:
        delete_existing()
        create_users()
        create_course_and_enrollments()
        create_exam_and_questions()
        create_attempts_and_answers()
        create_concept_stats()
        create_tutor_conversations()
        verify()
    except Exception as e:
        print(f"\n❌ 오류 발생: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
