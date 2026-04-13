#!/usr/bin/env python3

from __future__ import annotations

import argparse
import calendar
import math
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable
from uuid import NAMESPACE_URL, UUID, uuid5

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from supabase import Client, create_client
from supabase_auth.types import AdminUserAttributes
from postgrest.exceptions import APIError

from app.config import settings

UTC = timezone.utc
SIM_NAMESPACE = uuid5(NAMESPACE_URL, "socrateach/simulation/v1")
DEFAULT_EMAIL_DOMAIN = "sim.socrateach.local"
DEFAULT_PASSWORD = "SocraTeachDemo!2026"
UPSERT_BATCH_SIZE = 250
BASE_REQUIRED_TABLES = [
    "profiles",
    "courses",
    "enrollments",
    "materials",
    "tutor_sessions",
    "concept_stats",
]
TRANSCRIPT_TABLES = [
    "tutor_conversations",
    "tutor_messages",
]
ASSESSMENT_TABLES = [
    "exams",
    "exam_questions",
    "exam_attempts",
    "exam_answers",
]

SURNAME_POOL = [
    "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임",
    "한", "오", "서", "신", "권", "황", "안", "송", "류", "전",
]

GIVEN_NAME_POOL = [
    "서준", "서연", "민준", "민서", "지후", "지우", "하준", "하은", "도윤", "도연",
    "예준", "예은", "시우", "시은", "유찬", "유진", "현우", "현서", "준호", "준희",
    "채윤", "채원", "지안", "지아", "수현", "수아", "태윤", "태린", "은우", "은채",
    "주원", "주아", "다온", "다인", "우진", "우주", "가온", "가은", "로이", "로아",
]


@dataclass(frozen=True)
class ConceptTemplate:
    concept: str
    subject: str
    difficulty: float
    everyday_example: str
    common_confusion: str
    key_question: str


@dataclass(frozen=True)
class SimulationUser:
    user_id: UUID
    email: str
    full_name: str
    role: str


@dataclass(frozen=True)
class StudentPersona:
    profile: SimulationUser
    curiosity: float
    persistence: float
    mastery: float


@dataclass
class SimulationBundle:
    teacher: SimulationUser
    students: list[StudentPersona]
    course_row: dict
    enrollment_rows: list[dict]
    material_rows: list[dict]
    tutor_session_rows: list[dict]
    concept_stat_rows: list[dict]
    conversation_rows: list[dict]
    message_rows: list[dict]
    exam_rows: list[dict]
    exam_question_rows: list[dict]
    exam_attempt_rows: list[dict]
    exam_answer_rows: list[dict]
    start_date: date
    end_date: date
    school_level: str
    course_slug: str
    transcripts_enabled: bool
    assessments_enabled: bool


CONCEPTS_BY_LEVEL: dict[str, list[ConceptTemplate]] = {
    "elementary": [
        ConceptTemplate(
            concept="초등 수학 · 분수의 의미",
            subject="수학",
            difficulty=0.35,
            everyday_example="피자를 똑같이 나누는 상황",
            common_confusion="분자가 무엇을 뜻하는지",
            key_question="전체를 몇 조각으로 보고 있는지 먼저 말할 수 있을까?",
        ),
        ConceptTemplate(
            concept="초등 과학 · 생태계와 먹이 관계",
            subject="과학",
            difficulty=0.4,
            everyday_example="숲속 먹이사슬 그림",
            common_confusion="왜 한 생물이 사라지면 다른 생물도 영향을 받는지",
            key_question="누가 누구에게 에너지를 주는지 화살표 방향으로 설명할 수 있을까?",
        ),
        ConceptTemplate(
            concept="초등 국어 · 중심 내용 찾기",
            subject="국어",
            difficulty=0.32,
            everyday_example="짧은 설명문 한 단락",
            common_confusion="중요한 문장과 예시 문장을 구분하는 것",
            key_question="이 글이 결국 무엇을 말하고 싶은지 한 문장으로 줄이면 어떨까?",
        ),
        ConceptTemplate(
            concept="초등 수학 · 소수와 길이 비교",
            subject="수학",
            difficulty=0.42,
            everyday_example="자와 줄자의 눈금",
            common_confusion="소수점 자리가 커질수록 값도 크다고 생각하는 것",
            key_question="눈금 한 칸의 크기를 먼저 확인하면 어떤 숫자가 더 큰지 보일까?",
        ),
    ],
    "middle": [
        ConceptTemplate(
            concept="중학 수학 · 일차함수와 그래프",
            subject="수학",
            difficulty=0.52,
            everyday_example="시간에 따라 변하는 요금표",
            common_confusion="기울기와 y절편의 의미를 헷갈리는 것",
            key_question="x가 1 늘 때 y가 얼마나 바뀌는지 먼저 찾으면 그래프가 보일까?",
        ),
        ConceptTemplate(
            concept="중학 과학 · 물질의 상태 변화",
            subject="과학",
            difficulty=0.5,
            everyday_example="얼음이 녹고 물이 끓는 실험",
            common_confusion="상태가 바뀌어도 입자 자체는 그대로라는 점",
            key_question="눈에 보이는 모양 말고 입자 움직임이 어떻게 달라지는지 상상할 수 있을까?",
        ),
        ConceptTemplate(
            concept="중학 국어 · 주장과 근거",
            subject="국어",
            difficulty=0.47,
            everyday_example="짧은 발표문 또는 칼럼",
            common_confusion="내 생각과 근거 자료를 같은 것으로 보는 것",
            key_question="이 글에서 꼭 증명하려는 한 문장을 먼저 찾는다면 무엇일까?",
        ),
        ConceptTemplate(
            concept="중학 수학 · 확률의 기초",
            subject="수학",
            difficulty=0.58,
            everyday_example="주사위와 카드 뽑기",
            common_confusion="가능한 경우의 수를 빠뜨리는 것",
            key_question="먼저 전체 경우를 빠짐없이 세면 유리한지 생각해볼까?",
        ),
    ],
    "high": [
        ConceptTemplate(
            concept="고등 수학 · 변화율과 함수 해석",
            subject="수학",
            difficulty=0.68,
            everyday_example="속도 그래프와 성장 그래프",
            common_confusion="함수가 빨리 증가하는 것과 값이 큰 것을 같은 뜻으로 보는 것",
            key_question="그래프의 어느 구간이 더 가파른지 비교하면 변화율 감각이 생길까?",
        ),
        ConceptTemplate(
            concept="고등 과학 · 유전 정보의 전달",
            subject="생명과학",
            difficulty=0.7,
            everyday_example="DNA에서 단백질로 이어지는 과정도",
            common_confusion="유전자, 염색체, DNA를 같은 단위로 생각하는 것",
            key_question="정보가 저장된 것과 실제로 만들어지는 것을 구분하면 구조가 보일까?",
        ),
        ConceptTemplate(
            concept="고등 사회 · 사회 문제 분석과 논증",
            subject="통합사회",
            difficulty=0.6,
            everyday_example="청소년 생활과 연결된 사회 이슈 기사",
            common_confusion="의견만 말하고 자료 해석을 빼먹는 것",
            key_question="주장, 근거, 반론 가능성을 각각 따로 적어보면 논증 구조가 선명해질까?",
        ),
        ConceptTemplate(
            concept="고등 수학 · 조건부확률과 사건의 독립",
            subject="수학",
            difficulty=0.74,
            everyday_example="검사 결과와 확률 표",
            common_confusion="이미 알고 있는 조건이 전체 확률을 바꾼다는 점",
            key_question="새로운 정보를 안 뒤에 표본공간이 어떻게 달라지는지 먼저 볼까?",
        ),
    ],
}

MATERIALS_BY_LEVEL: dict[str, list[str]] = {
    "elementary": [
        "01_학기시작_개념브릿지.pdf",
        "02_분수와소수_활동지.pdf",
        "03_읽기전략_수업자료.pdf",
        "04_생태계_탐구노트.pdf",
        "05_여름방학_복습패킷.pdf",
        "06_가을학기_성장체크.pdf",
    ],
    "middle": [
        "01_중학개념_오리엔테이션.pdf",
        "02_일차함수_탐구활동.pdf",
        "03_상태변화_실험정리.pdf",
        "04_주장과근거_읽기자료.pdf",
        "05_확률기초_문제세트.pdf",
        "06_기말대비_오답복기.pdf",
    ],
    "high": [
        "01_공통수학_개념맵.pdf",
        "02_변화율_그래프분석.pdf",
        "03_생명과학_유전정보.pdf",
        "04_사회논증_자료읽기.pdf",
        "05_조건부확률_표분석.pdf",
        "06_수능형_오답리포트.pdf",
    ],
}


def parse_args() -> argparse.Namespace:
    today = date.today()
    if today.month >= 3:
        default_start = date(today.year - 1, 3, 1)
        default_end = date(today.year, 2, calendar.monthrange(today.year, 2)[1])
    else:
        default_start = date(today.year - 2, 3, 1)
        default_end = date(today.year - 1, 2, calendar.monthrange(today.year - 1, 2)[1])

    parser = argparse.ArgumentParser(
        description="Generate a year of simulated SocraTeach class data for Supabase.",
    )
    parser.add_argument("--school-level", choices=sorted(CONCEPTS_BY_LEVEL.keys()), default="middle")
    parser.add_argument("--students", type=int, default=30)
    parser.add_argument("--seed", type=int, default=20260407)
    parser.add_argument("--start-date", type=lambda value: date.fromisoformat(value), default=default_start)
    parser.add_argument("--end-date", type=lambda value: date.fromisoformat(value), default=default_end)
    parser.add_argument("--course-slug", default=None)
    parser.add_argument("--email-domain", default=DEFAULT_EMAIL_DOMAIN)
    parser.add_argument("--password", default=DEFAULT_PASSWORD)
    parser.add_argument(
        "--without-transcripts",
        action="store_true",
        help="Skip tutor_conversations and tutor_messages so the simulator can run against the initial schema only.",
    )
    parser.add_argument(
        "--without-assessments",
        action="store_true",
        help="Skip exam tables so the simulator can run without assessment migrations.",
    )
    parser.add_argument("--apply", action="store_true", help="Write the simulated data into Supabase.")
    return parser.parse_args()


def deterministic_uuid(*parts: str) -> UUID:
    return uuid5(SIM_NAMESPACE, "::".join(parts))


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def chunked(rows: list[dict], size: int) -> Iterable[list[dict]]:
    for index in range(0, len(rows), size):
        yield rows[index:index + size]


def generate_names(count: int) -> list[str]:
    names: list[str] = []
    for surname in SURNAME_POOL:
        for given_name in GIVEN_NAME_POOL:
            names.append(f"{surname}{given_name}")
    return names[:count]


def make_teacher(level: str, course_slug: str, domain: str) -> SimulationUser:
    school_level_label = {"elementary": "초등", "middle": "중등", "high": "고등"}[level]
    user_id = deterministic_uuid("teacher", course_slug)
    return SimulationUser(
        user_id=user_id,
        email=f"{course_slug}.teacher@{domain}",
        full_name=f"{school_level_label} 시뮬레이션 교사",
        role="teacher",
    )


def make_students(level: str, course_slug: str, domain: str, count: int, rng: random.Random) -> list[StudentPersona]:
    names = generate_names(count)
    personas: list[StudentPersona] = []

    for index in range(count):
        user_id = deterministic_uuid("student", course_slug, str(index + 1))
        profile = SimulationUser(
            user_id=user_id,
            email=f"{course_slug}.student{index + 1:02d}@{domain}",
            full_name=names[index],
            role="student",
        )
        personas.append(
            StudentPersona(
                profile=profile,
                curiosity=clamp(rng.normalvariate(0.95, 0.15), 0.6, 1.3),
                persistence=clamp(rng.normalvariate(0.9, 0.18), 0.55, 1.35),
                mastery=clamp(rng.normalvariate(0.7, 0.16), 0.35, 0.95),
            )
        )

    return personas


def school_days_between(start_date: date, end_date: date) -> list[date]:
    cursor = start_date
    days: list[date] = []
    while cursor <= end_date:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def weighted_school_days(days: list[date], school_level: str) -> list[float]:
    weights: list[float] = []
    for day in days:
        weight = 1.0
        if day.month in (7, 8):
            weight *= 0.45
        if day.month in (1, 2):
            weight *= 0.4
        if school_level == "high" and day.month in (10, 11):
            weight *= 1.15
        if school_level == "elementary" and day.month in (5, 9):
            weight *= 1.1
        weights.append(weight)
    return weights


def make_timestamp(base_day: date, hour: int, minute: int) -> datetime:
    return datetime.combine(base_day, time(hour=hour, minute=minute, tzinfo=UTC))


def conversation_messages(
    student_name: str,
    concept: ConceptTemplate,
    resolved: bool,
    stuck_count: int,
    rng: random.Random,
) -> list[tuple[str, str]]:
    openers = [
        f"{concept.concept}에서 {concept.common_confusion}가 특히 헷갈려요.",
        f"{concept.concept} 수업은 들었는데 {concept.key_question[:-1]} 부분이 잘 안 잡혀요.",
        f"{concept.everyday_example} 예시는 알겠는데 개념으로 연결이 잘 안 돼요.",
    ]
    tutor_openers = [
        f"좋아요, {student_name}님. 먼저 {concept.everyday_example}를 떠올리면 어떤 규칙이 보이나요?",
        f"바로 답을 말하기보다, {concept.key_question}",
        f"우선 {concept.subject}에서 이 개념이 무엇을 비교하거나 설명하려는지부터 떠올려볼까요?",
    ]
    student_attempts = [
        f"제 생각에는 핵심이 있긴 한데, 어디를 먼저 봐야 하는지 모르겠어요.",
        f"전체적인 느낌은 알겠는데 말로 설명하려고 하면 자꾸 섞여요.",
        f"아마도 관련은 있는데 제가 기준을 정확히 못 잡은 것 같아요.",
    ]
    tutor_guides = [
        f"좋아요. 그럼 {concept.common_confusion}를 잠깐 빼고, 가장 먼저 확인할 기준 한 가지를 말해볼 수 있을까요?",
        f"그 접근 좋습니다. {concept.everyday_example}에서 무엇이 변하고 무엇이 그대로인지 나눠보면 어떨까요?",
        f"한 단계만 더 가볼게요. 이 개념을 친구에게 설명한다면 첫 문장을 어떻게 시작할까요?",
    ]

    if resolved:
        student_reflection = [
            "아, 먼저 기준을 정하고 나면 제가 왜 헷갈렸는지 알 것 같아요.",
            "이제는 예시를 보고도 핵심을 말할 수 있을 것 같아요.",
            "제가 스스로 설명해보니까 구조가 조금 보이기 시작했어요.",
        ]
        tutor_close = [
            "좋습니다. 그 설명에서 가장 중요한 낱말 하나만 뽑는다면 무엇일까요?",
            "좋아요. 방금 말한 내용을 다른 예시에 그대로 적용할 수 있을지도 떠올려볼까요?",
            "잘했어요. 지금 정리한 기준을 다음 문제에서도 다시 찾을 수 있겠나요?",
        ]
    else:
        student_reflection = [
            f"아직 {concept.common_confusion} 때문에 머릿속이 정리되진 않았어요.",
            "기준을 세우는 건 알겠는데 실제 문제에 가면 또 흔들릴 것 같아요.",
            "예시를 보면 알 것 같다가도 스스로 설명하려면 막혀요.",
        ]
        tutor_close = [
            f"괜찮아요. 그럼 답 대신 작은 힌트만 줄게요. {concept.everyday_example}에서 가장 먼저 세야 하는 것은 무엇일까요?",
            f"좋아요. 오늘은 여기까지 하고, 다음엔 {concept.key_question[:-1]}만 먼저 적어보는 것부터 시작해볼까요?",
            f"좋습니다. 마지막으로 {concept.common_confusion}를 한 문장으로 적어두면 다음 대화에서 바로 이어가기 쉬울 거예요. 어떤 문장으로 남기고 싶나요?",
        ]

    return [
        ("user", rng.choice(openers)),
        ("assistant", rng.choice(tutor_openers)),
        ("user", rng.choice(student_attempts)),
        ("assistant", rng.choice(tutor_guides)),
        ("user", rng.choice(student_reflection)),
        ("assistant", rng.choice(tutor_close)),
    ]


def build_exam_question(
    concept: ConceptTemplate,
    question_order: int,
    rng: random.Random,
) -> tuple[str, list[dict], str, str, str]:
    prompt = (
        f"{question_order}번. {concept.everyday_example}와 연결해 볼 때, "
        f"'{concept.concept}'을 이해하는 가장 적절한 접근은 무엇일까요?"
    )
    options = [
        {
            "label": "A",
            "text": f"{concept.key_question[:-1]}를 기준으로 핵심 관계를 먼저 확인한다.",
            "correct": True,
        },
        {
            "label": "B",
            "text": f"{concept.common_confusion}만 떠올리고 바로 결론을 낸다.",
            "correct": False,
        },
        {
            "label": "C",
            "text": "숫자가 큰 보기만 고르면 항상 정답에 가깝다고 본다.",
            "correct": False,
        },
        {
            "label": "D",
            "text": "예시와 개념은 연결하지 않고 공식만 외우면 된다고 본다.",
            "correct": False,
        },
    ]
    rng.shuffle(options)
    correct_choice = next(option["label"] for option in options if option["correct"])
    choices = [{"label": option["label"], "text": option["text"]} for option in options]
    explanation = (
        f"{concept.concept}에서는 {concept.key_question[:-1]}를 기준으로 관계를 파악해야 합니다. "
        f"{concept.common_confusion}에만 머물면 핵심 개념을 놓치기 쉽습니다."
    )
    difficulty = "hard" if concept.difficulty >= 0.58 else "medium"
    return prompt, choices, correct_choice, explanation, difficulty


def build_exam_tutor_prompt(exam_title: str, question_prompt: str, concept: str, selected_choice: str) -> str:
    return (
        f"{exam_title}에서 '{question_prompt}' 문제를 풀다가 {selected_choice}를 골랐어요. "
        f"정답을 바로 주지 말고, {concept} 개념을 스스로 떠올리게 질문으로 도와줘."
    )


def exam_review_messages(
    student_name: str,
    exam_title: str,
    concept: ConceptTemplate,
    question_prompt: str,
    selected_choice: str,
    resolved: bool,
    rng: random.Random,
) -> list[tuple[str, str]]:
    openers = [
        f"{exam_title}에서 '{question_prompt}' 문제를 {selected_choice}로 골랐는데 왜 틀렸는지 잘 모르겠어요.",
        f"{exam_title} 오답 복기 중인데 {concept.concept}랑 문제를 연결하는 기준이 헷갈려요.",
        f"시험에서는 {selected_choice}가 맞다고 생각했는데 지금 보니 자신이 없어요.",
    ]
    tutor_openers = [
        f"좋아요, {student_name}님. 문제에서 바로 답을 찾기보다 {concept.key_question}",
        f"{concept.everyday_example}를 떠올리면 지금 선택한 보기의 어떤 부분이 먼저 걸리나요?",
        f"우선 {concept.common_confusion}를 잠깐 내려놓고, 무엇을 비교해야 하는지 먼저 말해볼까요?",
    ]
    student_reflection = [
        "아, 문제에서 무엇을 기준으로 봐야 하는지부터 정했어야 했네요.",
        "제가 보기 문장만 보고 판단하고 개념을 제대로 안 떠올렸던 것 같아요.",
        "시험장에서는 급해서 헷갈렸는데 지금은 조금 구조가 보이는 것 같아요.",
    ]
    tutor_closes = [
        "좋아요. 그렇다면 다음에 비슷한 문제를 보면 첫 줄에 어떤 기준을 적어둘 수 있을까요?",
        "이제 같은 개념이 다른 상황에 나오면 어떤 질문부터 스스로 해볼지 말해볼까요?",
        "좋습니다. 오늘 정리한 기준을 한 문장으로 남기면 다음 시험 복기에 도움이 될 거예요.",
    ]

    if not resolved:
        student_reflection = [
            "아직도 보기 사이에서 왜 갈려야 하는지 조금 흐릿해요.",
            "개념을 떠올리긴 했는데 실제 문항에서 적용하는 부분이 어렵네요.",
            "다음에도 비슷한 문제를 보면 다시 헷갈릴 것 같아요.",
        ]
        tutor_closes = [
            f"괜찮아요. 그럼 다음엔 {concept.key_question[:-1]}만 먼저 체크해보는 연습부터 해볼까요?",
            f"좋아요. 오늘은 정답보다 {concept.common_confusion}를 피하는 기준 한 줄만 남겨볼까요?",
            "좋습니다. 비슷한 문제를 하나 더 보고 같은 기준을 적용해보면 훨씬 선명해질 거예요.",
        ]

    return [
        ("user", rng.choice(openers)),
        ("assistant", rng.choice(tutor_openers)),
        ("user", rng.choice(student_reflection)),
        ("assistant", rng.choice(tutor_closes)),
    ]


def generate_material_rows(course_id: UUID, school_level: str, start_date: date, course_slug: str) -> list[dict]:
    rows: list[dict] = []
    for index, file_name in enumerate(MATERIALS_BY_LEVEL[school_level], start=1):
        created_at = make_timestamp(start_date + timedelta(days=index * 18), 9, 0)
        rows.append(
            {
                "id": str(deterministic_uuid("material", course_slug, str(index))),
                "course_id": str(course_id),
                "file_name": file_name,
                "storage_path": f"simulated/{course_slug}/{file_name}",
                "indexed": True,
                "created_at": created_at.isoformat(),
            }
        )
    return rows


def session_count_for_student(persona: StudentPersona, rng: random.Random) -> int:
    base = 34 + int(persona.curiosity * 11) + int(persona.persistence * 8)
    return int(clamp(base + rng.randint(-4, 7), 26, 64))


def pick_concept(persona: StudentPersona, concepts: list[ConceptTemplate], rng: random.Random) -> ConceptTemplate:
    weights = []
    for concept in concepts:
        challenge_weight = 0.9 + concept.difficulty * 0.8 + (1 - persona.mastery) * 0.9
        weights.append(challenge_weight)
    return rng.choices(concepts, weights=weights, k=1)[0]


def simulate_session_outcome(persona: StudentPersona, concept: ConceptTemplate, rng: random.Random) -> tuple[int, bool]:
    friction = concept.difficulty + (1 - persona.mastery) * 0.9 + rng.uniform(-0.12, 0.18)

    if friction < 0.62:
        stuck_count = 0 if rng.random() < 0.45 else 1
    elif friction < 0.92:
        stuck_count = 1 if rng.random() < 0.55 else 2
    else:
        stuck_count = 2 if rng.random() < 0.6 else 3

    resolved_probability = clamp(
        0.82 + persona.persistence * 0.14 - concept.difficulty * 0.24 - stuck_count * 0.08,
        0.22,
        0.96,
    )
    resolved = rng.random() < resolved_probability
    return stuck_count, resolved


def generate_assessment_rows(
    *,
    args: argparse.Namespace,
    course_id: UUID,
    course_slug: str,
    concepts: list[ConceptTemplate],
    students: list[StudentPersona],
    rng: random.Random,
    start_date: date,
    end_date: date,
) -> tuple[list[dict], list[dict], list[dict], list[dict], list[dict], list[dict]]:
    exam_rows: list[dict] = []
    question_rows: list[dict] = []
    attempt_rows: list[dict] = []
    answer_rows: list[dict] = []
    review_conversation_rows: list[dict] = []
    review_message_rows: list[dict] = []

    exam_specs = [
        ("1학기 개념 점검 미니평가", 88),
        ("2학기 성취 점검 미니평가", 255),
    ]

    for exam_index, (exam_title, offset_days) in enumerate(exam_specs, start=1):
        exam_day = min(max(start_date + timedelta(days=offset_days), start_date), end_date - timedelta(days=7))
        exam_id = deterministic_uuid("exam", course_slug, str(exam_index))
        exam_rows.append(
            {
                "id": str(exam_id),
                "course_id": str(course_id),
                "title": exam_title,
                "description": f"{args.school_level} 과정 핵심 개념을 확인하는 시뮬레이션 온라인 시험",
                "exam_date": make_timestamp(exam_day, 10, 0).isoformat(),
                "duration_minutes": 25,
                "total_points": 60,
                "source_name": f"simulation_exam_{exam_index}",
                "source_format": "simulation",
                "created_by": str(teacher.user_id),
                "created_at": make_timestamp(exam_day - timedelta(days=7), 9, 0).isoformat(),
            }
        )

        weighted_concepts = concepts[:]
        weighted_concepts.sort(key=lambda concept: concept.difficulty, reverse=True)
        selected_concepts = weighted_concepts[:4] + rng.choices(concepts, weights=[concept.difficulty for concept in concepts], k=2)
        exam_questions: list[dict] = []

        for question_order, concept in enumerate(selected_concepts, start=1):
            question_id = deterministic_uuid("exam-question", course_slug, str(exam_index), str(question_order))
            prompt, choices, correct_choice, explanation, difficulty = build_exam_question(concept, question_order, rng)
            question = {
                "id": str(question_id),
                "exam_id": str(exam_id),
                "question_order": question_order,
                "concept_tag": concept.concept,
                "prompt": prompt,
                "choices": choices,
                "correct_choice": correct_choice,
                "explanation": explanation,
                "difficulty": difficulty,
                "points": 10,
                "created_at": make_timestamp(exam_day - timedelta(days=7), 9, question_order).isoformat(),
            }
            exam_questions.append(question)
            question_rows.append(question)

        for student in students:
            attempt_id = deterministic_uuid("exam-attempt", course_slug, str(exam_id), str(student.profile.user_id))
            submitted_at = make_timestamp(exam_day, 14 + rng.randint(0, 3), rng.choice([0, 10, 20, 30, 40]))
            score = 0

            for question in exam_questions:
                concept = next(item for item in concepts if item.concept == question["concept_tag"])
                accuracy_probability = clamp(
                    0.82 + student.mastery * 0.22 - concept.difficulty * 0.45 + rng.uniform(-0.18, 0.12),
                    0.12,
                    0.95,
                )
                is_correct = rng.random() < accuracy_probability

                if is_correct:
                    selected_choice = question["correct_choice"]
                    score += question["points"]
                else:
                    wrong_choices = [
                        choice["label"]
                        for choice in question["choices"]
                        if choice["label"] != question["correct_choice"]
                    ]
                    selected_choice = rng.choice(wrong_choices)

                answer_id = deterministic_uuid("exam-answer", str(attempt_id), question["id"])
                tutor_prompt = None
                review_resolved = False
                review_completed_at = None
                if not is_correct:
                    tutor_prompt = build_exam_tutor_prompt(
                        exam_title,
                        question["prompt"],
                        question["concept_tag"],
                        selected_choice,
                    )

                if not is_correct and not args.without_transcripts and rng.random() < 0.58:
                    review_resolved = rng.random() < clamp(0.48 + student.persistence * 0.22 - concept.difficulty * 0.18, 0.18, 0.88)
                    review_conversation_id = deterministic_uuid(
                        "exam-review-conversation",
                        course_slug,
                        str(exam_id),
                        str(student.profile.user_id),
                        question["id"],
                    )
                    review_started_at = submitted_at + timedelta(days=rng.randint(1, 4), hours=rng.randint(0, 3))
                    if review_resolved:
                        review_completed_at = (review_started_at + timedelta(minutes=12)).isoformat()
                    review_conversation_rows.append(
                        {
                            "id": str(review_conversation_id),
                            "student_id": str(student.profile.user_id),
                            "course_id": str(course_id),
                            "concept_tag": question["concept_tag"],
                            "school_level": args.school_level,
                            "summary": f"{student.profile.full_name} 학생이 {exam_title} 오답을 복기하며 {question['concept_tag']} 개념을 다시 점검함",
                            "stuck_count": 1,
                            "resolved": review_resolved,
                            "started_at": review_started_at.isoformat(),
                            "ended_at": (review_started_at + timedelta(minutes=12)).isoformat(),
                            "created_at": review_started_at.isoformat(),
                            "source_type": "exam_review",
                            "source_reference_id": str(answer_id),
                            "focus_question": question["prompt"],
                        }
                    )

                    review_messages = exam_review_messages(
                        student.profile.full_name,
                        exam_title,
                        concept,
                        question["prompt"],
                        selected_choice,
                        review_resolved,
                        rng,
                    )
                    for message_order, (role, content) in enumerate(review_messages, start=1):
                        review_message_rows.append(
                            {
                                "id": str(
                                    deterministic_uuid(
                                        "exam-review-message",
                                        str(review_conversation_id),
                                        str(message_order),
                                    )
                                ),
                                "conversation_id": str(review_conversation_id),
                                "role": role,
                                "content": content,
                                "message_order": message_order,
                                "created_at": (review_started_at + timedelta(minutes=message_order)).isoformat(),
                            }
                        )

                answer_rows.append(
                    {
                        "id": str(answer_id),
                        "attempt_id": str(attempt_id),
                        "question_id": question["id"],
                        "concept_tag": question["concept_tag"],
                        "selected_choice": selected_choice,
                        "is_correct": is_correct,
                        "tutor_prompt": tutor_prompt,
                        "corrected_choice": question["correct_choice"] if review_resolved else None,
                        "resolved_via_tutor": review_resolved,
                        "review_completed_at": review_completed_at,
                        "created_at": submitted_at.isoformat(),
                    }
                )

            attempt_rows.append(
                {
                    "id": str(attempt_id),
                    "exam_id": str(exam_id),
                    "course_id": str(course_id),
                    "student_id": str(student.profile.user_id),
                    "attempt_number": 1,
                    "score": score,
                    "max_score": 60,
                    "duration_minutes": rng.randint(14, 26),
                    "status": "graded",
                    "submitted_at": submitted_at.isoformat(),
                    "created_at": submitted_at.isoformat(),
                }
            )

    return (
        exam_rows,
        question_rows,
        attempt_rows,
        answer_rows,
        review_conversation_rows,
        review_message_rows,
    )


def generate_bundle(args: argparse.Namespace) -> SimulationBundle:
    rng = random.Random(args.seed)
    start_date: date = args.start_date
    end_date: date = args.end_date
    if end_date < start_date:
        raise ValueError("end-date must be on or after start-date")

    course_slug = args.course_slug or f"sim-{args.school_level}-{start_date.isoformat()}"
    teacher = make_teacher(args.school_level, course_slug, args.email_domain)
    students = make_students(args.school_level, course_slug, args.email_domain, args.students, rng)
    course_id = deterministic_uuid("course", course_slug)

    course_row = {
        "id": str(course_id),
        "teacher_id": str(teacher.user_id),
        "title": f"[SIM] {args.school_level.title()} Demo Cohort",
        "description": f"Simulated {args.school_level} class generated for {start_date.isoformat()} to {end_date.isoformat()}",
        "created_at": make_timestamp(start_date - timedelta(days=10), 8, 30).isoformat(),
    }

    enrollment_rows = [
        {
            "id": str(deterministic_uuid("enrollment", course_slug, str(student.profile.user_id))),
            "course_id": str(course_id),
            "student_id": str(student.profile.user_id),
            "enrolled_at": make_timestamp(start_date - timedelta(days=5), 9, 0).isoformat(),
        }
        for student in students
    ]

    material_rows = generate_material_rows(course_id, args.school_level, start_date, course_slug)
    concepts = CONCEPTS_BY_LEVEL[args.school_level]
    school_days = school_days_between(start_date, end_date)
    weights = weighted_school_days(school_days, args.school_level)

    tutor_session_rows: list[dict] = []
    conversation_rows: list[dict] = []
    message_rows: list[dict] = []
    stats_by_student_concept: dict[tuple[str, str], dict] = {}

    for student in students:
        total_sessions = session_count_for_student(student, rng)
        chosen_days = rng.choices(school_days, weights=weights, k=total_sessions)
        chosen_days.sort()

        for session_index, session_day in enumerate(chosen_days, start=1):
            concept = pick_concept(student, concepts, rng)
            stuck_count, resolved = simulate_session_outcome(student, concept, rng)
            start_hour = rng.choice([16, 17, 18, 19, 20])
            start_minute = rng.choice([0, 10, 20, 30, 40, 50])
            started_at = make_timestamp(session_day, start_hour, start_minute)
            ended_at = started_at + timedelta(minutes=rng.randint(8, 21))

            conversation_id = deterministic_uuid(
                "conversation",
                course_slug,
                str(student.profile.user_id),
                str(session_index),
            )
            session_id = deterministic_uuid(
                "session",
                course_slug,
                str(student.profile.user_id),
                str(session_index),
            )

            summary = (
                f"{student.profile.full_name} 학생이 {concept.concept}에서 "
                f"{'핵심을 정리하고 적용 질문까지 진행함' if resolved else '핵심 개념을 다시 짚어볼 숙제를 남김'}"
            )

            tutor_session_rows.append(
                {
                    "id": str(session_id),
                    "student_id": str(student.profile.user_id),
                    "course_id": str(course_id),
                    "concept_tag": concept.concept,
                    "stuck_count": stuck_count,
                    "resolved": resolved,
                    "created_at": ended_at.isoformat(),
                }
            )

            if not args.without_transcripts:
                conversation_rows.append(
                    {
                        "id": str(conversation_id),
                        "student_id": str(student.profile.user_id),
                        "course_id": str(course_id),
                        "concept_tag": concept.concept,
                        "school_level": args.school_level,
                        "summary": summary,
                        "stuck_count": stuck_count,
                        "resolved": resolved,
                        "started_at": started_at.isoformat(),
                        "ended_at": ended_at.isoformat(),
                        "created_at": started_at.isoformat(),
                        "source_type": "tutor_session",
                        "source_reference_id": None,
                        "focus_question": None,
                    }
                )

                for message_order, (role, content) in enumerate(
                    conversation_messages(student.profile.full_name, concept, resolved, stuck_count, rng),
                    start=1,
                ):
                    message_rows.append(
                        {
                            "id": str(
                                deterministic_uuid(
                                    "message",
                                    str(conversation_id),
                                    str(message_order),
                                )
                            ),
                            "conversation_id": str(conversation_id),
                            "role": role,
                            "content": content,
                            "message_order": message_order,
                            "created_at": (started_at + timedelta(minutes=message_order)).isoformat(),
                        }
                    )

            stat_key = (str(student.profile.user_id), concept.concept)
            if stat_key not in stats_by_student_concept:
                stats_by_student_concept[stat_key] = {
                    "id": str(deterministic_uuid("concept-stat", course_slug, *stat_key)),
                    "course_id": str(course_id),
                    "student_id": str(student.profile.user_id),
                    "concept": concept.concept,
                    "stuck_count": 0,
                    "resolved_count": 0,
                    "last_updated": ended_at.isoformat(),
                }

            stats_by_student_concept[stat_key]["stuck_count"] += stuck_count
            stats_by_student_concept[stat_key]["resolved_count"] += 1 if resolved else 0
            stats_by_student_concept[stat_key]["last_updated"] = ended_at.isoformat()

    concept_stat_rows = list(stats_by_student_concept.values())
    (
        exam_rows,
        exam_question_rows,
        exam_attempt_rows,
        exam_answer_rows,
        review_conversation_rows,
        review_message_rows,
    ) = (
        generate_assessment_rows(
            args=args,
            course_id=course_id,
            course_slug=course_slug,
            concepts=concepts,
            students=students,
            rng=rng,
            start_date=start_date,
            end_date=end_date,
        )
        if not args.without_assessments
        else ([], [], [], [], [], [])
    )

    if review_conversation_rows:
        conversation_rows.extend(review_conversation_rows)
    if review_message_rows:
        message_rows.extend(review_message_rows)

    return SimulationBundle(
        teacher=teacher,
        students=students,
        course_row=course_row,
        enrollment_rows=enrollment_rows,
        material_rows=material_rows,
        tutor_session_rows=tutor_session_rows,
        concept_stat_rows=concept_stat_rows,
        conversation_rows=conversation_rows,
        message_rows=message_rows,
        exam_rows=exam_rows,
        exam_question_rows=exam_question_rows,
        exam_attempt_rows=exam_attempt_rows,
        exam_answer_rows=exam_answer_rows,
        start_date=start_date,
        end_date=end_date,
        school_level=args.school_level,
        course_slug=course_slug,
        transcripts_enabled=not args.without_transcripts,
        assessments_enabled=not args.without_assessments,
    )


def ensure_auth_user(client: Client, user: SimulationUser, password: str) -> None:
    try:
        response = client.auth.admin.get_user_by_id(str(user.user_id))
        if getattr(response, "user", None):
            return
    except Exception:
        pass

    attributes: AdminUserAttributes = {
        "id": str(user.user_id),
        "email": user.email,
        "password": password,
        "email_confirm": True,
        "user_metadata": {
            "full_name": user.full_name,
            "role": user.role,
            "simulated": True,
        },
        "app_metadata": {
            "provider": "email",
            "providers": ["email"],
            "simulated": True,
        },
    }
    client.auth.admin.create_user(attributes)


def upsert_rows(client: Client, table_name: str, rows: list[dict]) -> None:
    if not rows:
        return

    for batch in chunked(rows, UPSERT_BATCH_SIZE):
        client.table(table_name).upsert(batch).execute()


def get_api_error_code(error: APIError) -> str | None:
    code = getattr(error, "code", None)
    if code:
        return str(code)

    if error.args and isinstance(error.args[0], dict):
        return error.args[0].get("code")

    return None


def ensure_required_tables(client: Client, transcripts_enabled: bool, assessments_enabled: bool) -> None:
    required_tables = list(BASE_REQUIRED_TABLES)
    if transcripts_enabled:
        required_tables.extend(TRANSCRIPT_TABLES)
    if assessments_enabled:
        required_tables.extend(ASSESSMENT_TABLES)

    missing_tables: list[str] = []

    for table_name in required_tables:
        try:
            client.table(table_name).select("*").limit(1).execute()
        except APIError as error:
            if get_api_error_code(error) == "PGRST205":
                missing_tables.append(table_name)
                continue
            raise

    if missing_tables:
        migration_hint = ""
        if {"tutor_conversations", "tutor_messages"} & set(missing_tables):
            migration_hint = (
                " Apply backend/supabase/migrations/002_tutor_transcripts.sql first, "
                "then rerun the simulator."
            )
        elif {"exams", "exam_questions", "exam_attempts", "exam_answers"} & set(missing_tables):
            migration_hint = (
                " Apply backend/supabase/migrations/003_assessments_and_chat_sources.sql first, "
                "then rerun the simulator."
            )

        raise RuntimeError(
            "Missing required tables in Supabase schema cache: "
            + ", ".join(missing_tables)
            + "."
            + migration_hint
        )


def apply_bundle(bundle: SimulationBundle, args: argparse.Namespace) -> None:
    client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    ensure_required_tables(client, bundle.transcripts_enabled, bundle.assessments_enabled)

    ensure_auth_user(client, bundle.teacher, args.password)
    for student in bundle.students:
        ensure_auth_user(client, student.profile, args.password)

    profile_rows = [
        {
            "id": str(bundle.teacher.user_id),
            "email": bundle.teacher.email,
            "full_name": bundle.teacher.full_name,
            "role": bundle.teacher.role,
            "created_at": make_timestamp(bundle.start_date - timedelta(days=14), 8, 0).isoformat(),
        },
        *[
            {
                "id": str(student.profile.user_id),
                "email": student.profile.email,
                "full_name": student.profile.full_name,
                "role": student.profile.role,
                "created_at": make_timestamp(bundle.start_date - timedelta(days=7), 8, 0).isoformat(),
            }
            for student in bundle.students
        ],
    ]

    upsert_rows(client, "profiles", profile_rows)
    upsert_rows(client, "courses", [bundle.course_row])
    upsert_rows(client, "enrollments", bundle.enrollment_rows)
    upsert_rows(client, "materials", bundle.material_rows)
    upsert_rows(client, "tutor_sessions", bundle.tutor_session_rows)
    upsert_rows(client, "concept_stats", bundle.concept_stat_rows)
    if bundle.transcripts_enabled:
        upsert_rows(client, "tutor_conversations", bundle.conversation_rows)
        upsert_rows(client, "tutor_messages", bundle.message_rows)
    if bundle.assessments_enabled:
        upsert_rows(client, "exams", bundle.exam_rows)
        upsert_rows(client, "exam_questions", bundle.exam_question_rows)
        upsert_rows(client, "exam_attempts", bundle.exam_attempt_rows)
        upsert_rows(client, "exam_answers", bundle.exam_answer_rows)


def print_summary(bundle: SimulationBundle, apply: bool) -> None:
    print(f"mode={'APPLY' if apply else 'DRY_RUN'}")
    print(f"school_level={bundle.school_level}")
    print(f"course_slug={bundle.course_slug}")
    print(f"date_range={bundle.start_date.isoformat()}..{bundle.end_date.isoformat()}")
    print(f"teacher={bundle.teacher.full_name} <{bundle.teacher.email}>")
    print(f"students={len(bundle.students)}")
    print(f"materials={len(bundle.material_rows)}")
    print(f"tutor_sessions={len(bundle.tutor_session_rows)}")
    print(f"concept_stats={len(bundle.concept_stat_rows)}")
    print(f"transcripts={'enabled' if bundle.transcripts_enabled else 'disabled'}")
    if bundle.transcripts_enabled:
        print(f"tutor_conversations={len(bundle.conversation_rows)}")
        print(f"tutor_messages={len(bundle.message_rows)}")
    print(f"assessments={'enabled' if bundle.assessments_enabled else 'disabled'}")
    if bundle.assessments_enabled:
        print(f"exams={len(bundle.exam_rows)}")
        print(f"exam_questions={len(bundle.exam_question_rows)}")
        print(f"exam_attempts={len(bundle.exam_attempt_rows)}")
        print(f"exam_answers={len(bundle.exam_answer_rows)}")

    counts_by_concept: dict[str, int] = defaultdict(int)
    for row in bundle.tutor_session_rows:
        counts_by_concept[row["concept_tag"]] += 1

    print("top_concepts=")
    for concept, count in sorted(counts_by_concept.items(), key=lambda item: item[1], reverse=True)[:5]:
        print(f"  - {concept}: {count}")

    if bundle.transcripts_enabled and bundle.conversation_rows:
        print("sample_conversation_summary=")
        print(f"  - {bundle.conversation_rows[0]['summary']}")
        first_messages = [row for row in bundle.message_rows if row["conversation_id"] == bundle.conversation_rows[0]["id"]][:4]
        for message in first_messages:
            print(f"    [{message['role']}] {message['content']}")


def main() -> int:
    args = parse_args()
    bundle = generate_bundle(args)
    print_summary(bundle, args.apply)

    if args.apply:
        apply_bundle(bundle, args)
        print("status=completed")
        print("note=The simulator uses deterministic UUIDs. Re-running with the same course-slug and seed will upsert the same dataset.")
    else:
        print("status=preview_only")
        print("hint=Add --apply to write the simulated dataset into Supabase.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
