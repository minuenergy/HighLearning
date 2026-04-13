'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  BrainCircuit,
  BookMarked,
  CalendarRange,
  ChartColumnBig,
  ChevronRight,
  CircleAlert,
  MessageSquareQuote,
  NotebookPen,
  Sparkles,
  Users,
} from 'lucide-react'
import { fetchTeacherDashboardBriefing, type TeacherDashboardBriefing } from '@/lib/analytics-api'
import AssignmentCalendarBoard, { type CalendarBoardEvent } from '@/components/calendar/AssignmentCalendarBoard'
import { getApiUrl } from '@/lib/api'
import { listAccessibleCourses } from '@/lib/course-access'
import { createClient } from '@/lib/supabase'
import {
  fetchTeacherStudentsOverview,
  fetchTeacherSubjectsOverview,
  type TeacherClassOverview,
  type TeacherStudentsOverview,
  type TeacherSubjectOverview,
} from '@/lib/workspace-api'

type CourseExamSummary = {
  id: string
  title: string
  due_at?: string | null
  exam_date?: string | null
  published_at?: string | null
  workflow_status?: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
  assignment_type?: 'exam' | 'homework'
  pending_student_count?: number
  question_count?: number
  is_overdue?: boolean
  section_title?: string | null
}

async function fetchCourseExamSummaries(courseId: string): Promise<CourseExamSummary[]> {
  const response = await fetch(getApiUrl(`/api/exams/course/${courseId}`), {
    cache: 'no-store',
  })
  if (!response.ok) {
    return []
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

function averageClassScore(group: TeacherClassOverview) {
  const scores = group.students
    .map(student => student.average_first_score)
    .filter((score): score is number => typeof score === 'number')

  if (scores.length === 0) return null
  return Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1))
}

function statusLabel(score: number | null) {
  if (score === null) return { label: '데이터 수집 중', tone: 'text-slate-500 bg-slate-100' }
  if (score < 60) return { label: '보강 우선', tone: 'text-red-700 bg-red-50' }
  if (score < 80) return { label: '점검 필요', tone: 'text-amber-700 bg-amber-50' }
  return { label: '안정 진행', tone: 'text-emerald-700 bg-emerald-50' }
}

function formatScore(score?: number | null) {
  return typeof score === 'number' ? `${score.toFixed(1)}점` : '미집계'
}

function TeacherDashboardContent() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<TeacherStudentsOverview | null>(null)
  const [subjectOverview, setSubjectOverview] = useState<TeacherSubjectOverview | null>(null)
  const [teacherBriefing, setTeacherBriefing] = useState<TeacherDashboardBriefing | null>(null)
  const [calendarEvents, setCalendarEvents] = useState<CalendarBoardEvent[]>([])

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return

        const [nextOverview, nextSubjectOverview, accessibleCourses, nextBriefing] = await Promise.all([
          fetchTeacherStudentsOverview(user.id),
          fetchTeacherSubjectsOverview(user.id),
          listAccessibleCourses(supabase),
          fetchTeacherDashboardBriefing(user.id).catch(() => null),
        ])

        if (!active) return
        setOverview(nextOverview)
        setSubjectOverview(nextSubjectOverview)
        setTeacherBriefing(nextBriefing)

        const examGroups = await Promise.all(
          accessibleCourses.map(async course => ({
            course,
            exams: await fetchCourseExamSummaries(course.id),
          })),
        )
        if (!active) return

        const nextEvents = examGroups.flatMap(({ course, exams }) =>
          exams.map<CalendarBoardEvent>(exam => {
            const eventDate = exam.due_at || exam.published_at || exam.exam_date || new Date().toISOString()
            const pendingCount = exam.pending_student_count ?? 0
            const tone =
              exam.workflow_status === 'draft'
                ? 'blue'
                : exam.workflow_status === 'scheduled'
                  ? 'blue'
                : exam.is_overdue
                  ? 'red'
                  : pendingCount > 0
                    ? 'amber'
                    : 'emerald'
            return {
              id: `${course.id}-${exam.id}`,
              title: course.title,
              subtitle: `${exam.title}${exam.section_title ? ` · ${exam.section_title}` : ''}`,
              date: eventDate,
              href: `/teacher/exams?course=${course.id}&exam=${exam.id}`,
              tone,
            }
          }),
        )
        setCalendarEvents(nextEvents)
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPage()
    return () => {
      active = false
    }
  }, [supabase])

  const groups = overview?.classes ?? []
  const subjects = subjectOverview?.subjects ?? []

  const summary = (() => {
    const studentIds = new Set<string>()
    let supportCount = 0

    groups.forEach(group => {
      group.students.forEach(student => {
        studentIds.add(student.id)
        supportCount += student.needs_support_count
      })
    })

    return {
      classCount: groups.length,
      studentCount: studentIds.size,
      subjectCount: subjects.length,
      supportCount,
    }
  })()

  const classCalendarEvents = calendarEvents
  const subjectCalendarEvents = calendarEvents.map(event => ({
    ...event,
    title: event.subtitle?.split(' · ')[0] || event.title,
    subtitle: event.title,
  }))

  const reinforcementCards = subjects
    .slice()
    .sort((left, right) => (left.average_first_score ?? 999) - (right.average_first_score ?? 999))
    .slice(0, 3)
  const llmBriefing = teacherBriefing?.llm_briefing

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">교사 홈을 불러오는 중입니다.</div>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#fff7ed,#ffffff_44%,#eff6ff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Teacher Home
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">반별 진도와 과목별 위험 신호를 한 번에 확인합니다</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              최초 시험 점수를 기준으로 반별 흐름, 과목별 약점, 학생 대화에서 자주 막히는 지점을 모아서 보여줍니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/teacher/students"
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              학생 관리 열기
            </Link>
            <Link
              href="/teacher/subjects"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              과목 관리 열기
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">담당 반</p>
          <p className="mt-4 text-4xl font-black text-slate-950">{summary.classCount}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">학생 수</p>
          <p className="mt-4 text-4xl font-black text-slate-950">{summary.studentCount}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">운영 과목</p>
          <p className="mt-4 text-4xl font-black text-blue-600">{summary.subjectCount}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">보강 신호</p>
          <p className="mt-4 text-4xl font-black text-red-600">{summary.supportCount}</p>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">AI 대화 브리핑</h2>
              <p className="mt-1 text-sm text-slate-500">튜터 대화 원문을 기준으로 공통 오개념과 보강 문장을 정리했습니다.</p>
            </div>
          </div>

          <div className="mt-5 rounded-[24px] border border-blue-100 bg-[linear-gradient(135deg,#eff6ff,#ffffff)] p-5">
            <p className="text-sm leading-7 text-slate-700">
              {llmBriefing?.executive_summary || '충분한 대화 원문이 쌓이면 AI가 교사용 브리핑을 자동으로 요약합니다.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2">
                <BookMarked className="h-4 w-4 text-slate-400" />
                수업 {teacherBriefing?.summary.course_count ?? 0}개
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2">
                <MessageSquareQuote className="h-4 w-4 text-slate-400" />
                대화 {teacherBriefing?.summary.conversation_count ?? 0}건
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2">
                <CircleAlert className="h-4 w-4 text-slate-400" />
                미제출 {teacherBriefing?.summary.pending_assignments ?? 0}건
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <CircleAlert className="h-4 w-4 text-red-500" />
                공통 오개념
              </div>
              <div className="mt-3 space-y-3">
                {(llmBriefing?.misconceptions ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">아직 요약할 공통 오개념이 없습니다.</p>
                )}
                {(llmBriefing?.misconceptions ?? []).map(item => (
                  <div key={`${item.concept}-${item.pattern}`} className="rounded-2xl bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{item.concept}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.pattern}</p>
                    {item.evidence && <p className="mt-2 text-xs leading-5 text-slate-500">{item.evidence}</p>}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <NotebookPen className="h-4 w-4 text-amber-600" />
                수업에서 바로 말할 문장
              </div>
              <div className="mt-3 space-y-3">
                {(llmBriefing?.teacher_talk_track ?? []).length === 0 && (
                  <p className="text-sm text-slate-500">아직 자동 생성된 talk track이 없습니다.</p>
                )}
                {(llmBriefing?.teacher_talk_track ?? []).map(item => (
                  <p key={item} className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                    {item}
                  </p>
                ))}
                {(llmBriefing?.teacher_talk_track ?? []).length === 0 &&
                  (llmBriefing?.teaching_suggestions ?? []).map(item => (
                    <p key={item} className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                      {item}
                    </p>
                  ))}
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <ChartColumnBig className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">수업별 위험 지도</h2>
              <p className="mt-1 text-sm text-slate-500">어느 반·과목에서 먼저 개입해야 하는지 빠르게 확인합니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(teacherBriefing?.course_snapshots ?? []).length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                아직 수업 브리핑 데이터가 없습니다.
              </p>
            )}

            {(teacherBriefing?.course_snapshots ?? []).map(course => (
              <div key={course.course_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-900">{course.course_title}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {[course.grade_level, course.class_label, course.subject_name].filter(Boolean).join(' · ') || '수업 메타데이터 정리 중'}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusLabel(course.average_exam_score ?? null).tone}`}>
                    {statusLabel(course.average_exam_score ?? null).label}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                  <p className="rounded-2xl bg-white px-3 py-2">최초 시험 평균 {formatScore(course.average_exam_score)}</p>
                  <p className="rounded-2xl bg-white px-3 py-2">미제출 {course.pending_assignments}건</p>
                  <p className="rounded-2xl bg-white px-3 py-2">가장 막히는 개념 {course.top_concept ?? '없음'}</p>
                  <p className="rounded-2xl bg-white px-3 py-2">대화 근거 {course.conversation_count}건</p>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <AssignmentCalendarBoard
          title="반별 진도 캘린더"
          caption="반마다 언제 시험이나 숙제가 진행되고 있는지 달력으로 확인합니다."
          events={classCalendarEvents}
          emptyMessage="달력에 표시할 반별 시험 일정이 없습니다."
        />

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <CalendarRange className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">반 운영 현황</h2>
              <p className="mt-1 text-sm text-slate-500">학생 수, 과목 구성, 현재 위험도를 빠르게 확인합니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {groups.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                표시할 반이 없습니다.
              </p>
            )}

            {groups.map(group => {
              const score = averageClassScore(group)
              const status = statusLabel(score)

              return (
                <article key={group.id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{group.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{group.subject_labels.join(', ') || '과목 연결 중'}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      {group.student_count}명
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2">
                      <ChartColumnBig className="h-4 w-4 text-slate-400" />
                      평균 {score === null ? '미집계' : `${score.toFixed(1)}점`}
                    </span>
                  </div>
                  <Link
                    href={`/teacher/students?group=${group.id}`}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-700"
                  >
                    이 반 관리로 이동
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </article>
              )
            })}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <AssignmentCalendarBoard
          title="교과별 진도 캘린더"
          caption="시험 생성과 숙제 마감이 과목별로 언제 몰려 있는지 확인합니다."
          events={subjectCalendarEvents}
          emptyMessage="달력에 표시할 과목별 일정이 없습니다."
        />

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
              <CircleAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">보강 수업 추천</h2>
              <p className="mt-1 text-sm text-slate-500">오답률과 대화 신호를 합쳐 지금 먼저 말해야 할 내용을 추렸습니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {reinforcementCards.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                충분한 과목 데이터가 쌓이면 보강 추천이 나타납니다.
              </p>
            )}

            {reinforcementCards.map(subject => (
              <article key={subject.subject} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <BookMarked className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-[0.18em]">Top Priority</span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-slate-900">{subject.subject}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  최초 시험 평균 {subject.average_first_score ?? '미집계'}점 · 가장 낮은 목차는{' '}
                  {subject.sections[0]?.section ?? '아직 없음'}입니다.
                </p>
                <div className="mt-4 space-y-2">
                  {subject.teaching_signals.map(signal => (
                    <p key={signal} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                      {signal}
                    </p>
                  ))}
                </div>
                <Link
                  href={`/teacher/subjects?subject=${encodeURIComponent(subject.subject)}`}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-700"
                >
                  과목 관리에서 자세히 보기
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-rose-50 p-3 text-rose-700">
              <CircleAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">질문 패턴과 취약 개념</h2>
              <p className="mt-1 text-sm text-slate-500">학생들이 어떤 방식으로 질문하고 어디에서 계속 막히는지 묶어서 보여줍니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {(llmBriefing?.question_patterns ?? []).length === 0 &&
              (teacherBriefing?.top_difficult_concepts ?? []).length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  아직 충분한 패턴 데이터가 없습니다.
                </p>
              )}

            {(llmBriefing?.question_patterns ?? []).map(item => (
              <div key={`${item.type}-${item.example}`} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">{item.type}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.example}</p>
                {item.teacher_move && <p className="mt-2 text-xs leading-5 text-blue-700">{item.teacher_move}</p>}
              </div>
            ))}

            {(teacherBriefing?.top_difficult_concepts ?? []).slice(0, 3).map(item => (
              <div key={`${item.course_id}-${item.concept}`} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">{item.concept}</p>
                <p className="mt-2 text-sm text-slate-600">
                  {item.course_title} · 막힘 {item.total_stuck}회 · 해결률 {item.resolve_rate}%
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-violet-50 p-3 text-violet-700">
              <MessageSquareQuote className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">대화 근거와 개입 추천</h2>
              <p className="mt-1 text-sm text-slate-500">실제 대화 일부와 함께 다음 액션을 바로 이어갈 수 있게 정리했습니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {(teacherBriefing?.conversation_examples ?? []).slice(0, 2).map(example => (
              <div key={example.conversation_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">
                  {example.course_title} · {example.concept || '미분류'}
                </p>
                <p className="mt-1 text-xs text-slate-500">{example.focus_question || example.summary || '질문 맥락 없음'}</p>
                <div className="mt-3 space-y-2">
                  {example.messages.slice(0, 2).map((message, index) => (
                    <p key={`${example.conversation_id}-${index}`} className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                      <span className="font-semibold text-slate-500">{message.role === 'user' ? '학생' : '튜터'}:</span>{' '}
                      {message.content}
                    </p>
                  ))}
                </div>
              </div>
            ))}

            {(teacherBriefing?.intervention_recommendations ?? []).slice(0, 2).map(item => (
              <div key={`${item.course_id}-${item.title}`} className="rounded-[24px] border border-blue-100 bg-blue-50/60 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                <p className="mt-2 text-sm text-slate-600">{item.reason}</p>
                <div className="mt-3 space-y-2">
                  {item.actions.map(action => (
                    <p key={action} className="rounded-2xl bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                      {action}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  )
}

export default function TeacherDashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <TeacherDashboardContent />
    </Suspense>
  )
}
