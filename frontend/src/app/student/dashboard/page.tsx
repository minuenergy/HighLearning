'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BellRing,
  BookOpenCheck,
  CalendarDays,
  FileQuestion,
  Sparkles,
} from 'lucide-react'
import AssignmentCalendarBoard, { type CalendarBoardEvent } from '@/components/calendar/AssignmentCalendarBoard'
import CoursePicker from '@/components/course/CoursePicker'
import { getApiUrl } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import {
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'
import { fetchStudentPerformance, type StudentPerformanceOverview } from '@/lib/workspace-api'

type ExamCard = {
  id: string
  title: string
  question_count: number
  published_at?: string | null
  due_at?: string | null
  assignment_type?: 'exam' | 'homework'
  is_overdue?: boolean
  latest_attempt?: {
    id: string
    score: number
    max_score: number
    submitted_at: string
    attempt_number: number
    wrong_count: number
  } | null
}

type StudentNotification = {
  id: string
  exam_id?: string | null
  exam_title?: string | null
  message: string
  notification_type: 'assignment_assigned' | 'assignment_overdue'
  created_at: string
  due_at?: string | null
  published_at?: string | null
  assignment_type?: 'exam' | 'homework' | null
  workflow_status?: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived' | null
  is_overdue?: boolean
  teacher_name?: string | null
}

async function fetchStudentNotifications(studentId: string, courseId: string): Promise<StudentNotification[]> {
  const response = await fetch(
    getApiUrl(`/api/exams/student/${studentId}/${courseId}/notifications`),
    { cache: 'no-store' },
  )
  if (!response.ok) {
    return []
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

async function fetchStudentExams(studentId: string, courseId: string): Promise<ExamCard[]> {
  const response = await fetch(getApiUrl(`/api/exams/student/${studentId}/${courseId}`), {
    cache: 'no-store',
  })
  if (!response.ok) {
    return []
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

function formatDue(value?: string | null) {
  if (!value) return '상시'
  return new Date(value).toLocaleDateString('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })
}

function StudentDashboardContent() {
  const searchParams = useSearchParams()
  const requestedCourseId = searchParams.get('course')
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [notifications, setNotifications] = useState<StudentNotification[]>([])
  const [exams, setExams] = useState<ExamCard[]>([])
  const [overview, setOverview] = useState<StudentPerformanceOverview | null>(null)

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return

        const nextCourses = await listAccessibleCourses(supabase)
        if (!active) return
        setCourses(nextCourses)

        const nextCourse = pickAccessibleCourse(nextCourses, requestedCourseId)
        setCourse(nextCourse)
        if (!nextCourse) {
          setNotifications([])
          setExams([])
          setOverview(null)
          return
        }

        const [nextNotifications, nextExams, nextOverview] = await Promise.all([
          fetchStudentNotifications(user.id, nextCourse.id),
          fetchStudentExams(user.id, nextCourse.id),
          fetchStudentPerformance(user.id, nextCourse.id),
        ])
        if (!active) return

        setNotifications(nextNotifications)
        setExams(nextExams)
        setOverview(nextOverview)
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
  }, [requestedCourseId, supabase])

  const upcomingAssignments = exams
    .slice()
    .sort((left, right) => new Date(left.due_at || 0).getTime() - new Date(right.due_at || 0).getTime())
  const calendarEvents: CalendarBoardEvent[] = course
    ? upcomingAssignments.map(exam => ({
        id: exam.id,
        title: exam.assignment_type === 'exam' ? '시험 일정' : '숙제 일정',
        subtitle: exam.title,
        date: exam.due_at || exam.published_at || new Date().toISOString(),
        href: `/student/exams?course=${course.id}&exam=${exam.id}`,
        tone: exam.is_overdue ? 'red' : exam.latest_attempt ? 'emerald' : 'blue',
      }))
    : []

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">학생 홈을 준비하는 중입니다.</div>
  }

  if (!course) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
        연결된 학습 반을 찾지 못했습니다.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eef6ff,#ffffff_48%,#fef3c7)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Student Home
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">교과별 숙제 캘린더와 성적 흐름을 함께 봅니다</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              로그인하면 먼저 숙제와 시험 일정이 보이고, 성적 페이지와 AI 튜터로 바로 넘어갈 수 있습니다.
            </p>
            <p className="mt-3 text-sm font-medium text-blue-700">현재 반: {course.title}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/student/performance?course=${course.id}`}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              시험 성적 보기
            </Link>
            <Link
              href={`/student/exams?course=${course.id}`}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              온라인 시험 보기
            </Link>
          </div>
        </div>
      </section>

      <CoursePicker courses={courses} selectedCourseId={course.id} label="학습할 반 전환" />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">알림 수</p>
          <p className="mt-4 text-4xl font-black text-red-600">{notifications.length}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">최초 평균</p>
          <p className="mt-4 text-4xl font-black text-blue-600">{overview?.summary.average_first_score ?? '미집계'}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">완료 시험</p>
          <p className="mt-4 text-4xl font-black text-emerald-600">{overview?.summary.completed_exams ?? 0}</p>
        </div>
      </section>

      {notifications.length > 0 && (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50/85 p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white p-3 text-amber-700">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">테스트 알림</h2>
              <p className="mt-1 text-sm text-slate-500">완료하기 전까지 남아 있는 알림입니다.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {notifications.map(notification => (
              notification.exam_id ? (
                <Link
                  key={notification.id}
                  href={`/student/exams?course=${course.id}&exam=${notification.exam_id}`}
                  className={`block rounded-[22px] border bg-white px-4 py-4 transition ${
                    notification.notification_type === 'assignment_overdue'
                      ? 'border-rose-100 hover:border-rose-200'
                      : 'border-white hover:border-blue-200'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-900">{notification.message}</p>
                  {notification.exam_title && (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      {notification.exam_title}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-400">
                    {notification.assignment_type === 'exam' ? '시험형' : '숙제형'}
                    {notification.due_at ? ` · 마감 ${formatDue(notification.due_at)}` : ''}
                    {!notification.due_at && notification.published_at ? ` · 시작 ${formatDue(notification.published_at)}` : ''}
                    {notification.teacher_name ? ` · 담당 ${notification.teacher_name} 선생님` : ''}
                  </p>
                  <p className="mt-2 text-xs text-slate-400">{new Date(notification.created_at).toLocaleString('ko-KR')}</p>
                </Link>
              ) : (
                <article key={notification.id} className="rounded-[22px] border border-white bg-white px-4 py-4">
                  <p className="text-sm font-medium text-slate-900">{notification.message}</p>
                  <p className="mt-2 text-xs text-slate-400">{new Date(notification.created_at).toLocaleString('ko-KR')}</p>
                </article>
              )
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <AssignmentCalendarBoard
            title="교과별 숙제 캘린더"
            caption="과제가 시작된 흐름과 마감 시점을 실제 달력 형태로 확인합니다."
            events={calendarEvents}
            emptyMessage="아직 배정된 시험이나 숙제가 없습니다."
          />

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">숙제 진행 목록</h2>
                <p className="mt-1 text-sm text-slate-500">달력에서 본 과제를 카드 형태로 다시 확인하고 바로 들어갑니다.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {upcomingAssignments.length === 0 && (
                <p className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  아직 배정된 시험이나 숙제가 없습니다.
                </p>
              )}

              {upcomingAssignments.map(exam => (
                <Link
                  key={exam.id}
                  href={`/student/exams?course=${course.id}&exam=${exam.id}`}
                  className="block rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-slate-900">{exam.title}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        문항 {exam.question_count}개 · 시작 {formatDue(exam.published_at)} · 마감 {formatDue(exam.due_at)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        exam.is_overdue
                          ? 'bg-red-50 text-red-700'
                          : exam.latest_attempt
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      {exam.is_overdue ? '마감 지남' : exam.latest_attempt ? '제출 완료' : '진행 중'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">
                    {exam.latest_attempt
                      ? `최근 점수 ${exam.latest_attempt.score}/${exam.latest_attempt.max_score} · 오답 ${exam.latest_attempt.wrong_count}개`
                      : '아직 응시 전입니다.'}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <BookOpenCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">빠른 이동</h2>
              <p className="mt-1 text-sm text-slate-500">현재 맥락에서 바로 시험, 성적, 튜터로 넘어갑니다.</p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <Link
              href={`/student/performance?course=${course.id}`}
              className="block rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300"
            >
              <p className="text-sm font-semibold text-slate-900">시험 성적 페이지</p>
              <p className="mt-2 text-sm text-slate-500">교과별, 목차별 성적과 AI 튜터를 함께 봅니다.</p>
            </Link>
            <Link
              href={`/student/exams?course=${course.id}`}
              className="block rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300"
            >
              <p className="text-sm font-semibold text-slate-900">온라인 시험 페이지</p>
              <p className="mt-2 text-sm text-slate-500">시험지를 풀고 제출하면 자동 채점과 오답 복기가 이어집니다.</p>
            </Link>
            <Link
              href={`/student/tutor?course=${course.id}`}
              className="block rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300"
            >
              <p className="text-sm font-semibold text-slate-900">AI 튜터 페이지</p>
              <p className="mt-2 text-sm text-slate-500">세션별로 대화를 분리해서 저장하고, 다른 기기에서도 이어갑니다.</p>
            </Link>
          </div>

          <div className="mt-5 rounded-[22px] border border-amber-100 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
            <FileQuestion className="mr-2 inline h-4 w-4" />
            숙제를 시작하면 로그인 직후 알림이 유지되고, 해당 시험을 모두 마무리할 때까지 남아 있습니다.
          </div>
        </section>
      </div>
    </div>
  )
}

export default function StudentDashboardPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <StudentDashboardContent />
    </Suspense>
  )
}
