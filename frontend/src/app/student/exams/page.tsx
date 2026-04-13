'use client'
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ClipboardCheck, MessageCircle, RotateCcw, Sparkles } from 'lucide-react'
import CoursePicker from '@/components/course/CoursePicker'
import StudentPaperPreview, { QUESTIONS_PER_PAGE, type PreviewExam } from '@/components/exam/StudentPaperPreview'
import TutorSidebar from '@/components/chat/TutorSidebar'
import { getApiUrl } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import {
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'

type ExamCard = {
  id: string
  title: string
  question_count: number
  due_at?: string | null
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

type ExamQuestion = {
  id: string
  question_order: number
  concept_tag: string
  prompt: string
  choices: Array<{ label: string; text: string }>
  correct_choice?: string | null
  explanation?: string | null
  answer_id?: string | null
  student_answer?: string | null
  is_correct?: boolean | null
  tutor_prompt?: string | null
  corrected_choice?: string | null
  resolved_via_tutor?: boolean | null
  review_completed_at?: string | null
  source_pages?: number[]
  evidence_excerpt?: string | null
  source_chunk_previews?: Array<{
    id: string
    page_number?: number | null
    page_label?: string | null
    content: string
  }>
  page_asset_urls?: string[]
  source_reference?: string | null
  can_view_solution?: boolean
}

type ExamDetail = {
  exam: {
    id: string
    title: string
    description: string
    duration_minutes: number
    total_points: number
    exam_date: string
    due_at?: string | null
    textbook_title?: string | null
    section_title?: string | null
    learning_objective?: string | null
    source_format?: string | null
  }
  attempt?: {
    id: string
    score: number
    max_score: number
    attempt_number: number
    submitted_at: string
  } | null
  questions: ExamQuestion[]
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

function buildExamSourceLabel(exam: ExamDetail['exam'] | undefined | null) {
  if (!exam) return ''
  return [exam.textbook_title, exam.section_title].filter(Boolean).join(' · ')
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

function ExamsPageContent() {
  const searchParams = useSearchParams()
  const requestedCourseId = searchParams.get('course')
  const requestedExamId = searchParams.get('exam')
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [studentId, setStudentId] = useState('')
  const [exams, setExams] = useState<ExamCard[]>([])
  const [detail, setDetail] = useState<ExamDetail | null>(null)
  const [retakeMode, setRetakeMode] = useState(false)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [reviewAnswers, setReviewAnswers] = useState<Record<string, string>>({})
  const [reviewStatus, setReviewStatus] = useState<Record<string, string>>({})
  const [notifications, setNotifications] = useState<StudentNotification[]>([])
  const [previewImage, setPreviewImage] = useState<{ url: string; label: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [reviewingAnswerId, setReviewingAnswerId] = useState<string | null>(null)
  const [examPage, setExamPage] = useState(0)
  const [tutorOpen, setTutorOpen] = useState(false)
  const [tutorContext, setTutorContext] = useState<{ concept?: string; prompt?: string; question?: string; contextTitle?: string } | null>(null)
  const [supabase] = useState(() => createClient())

  const selectedExamId = useMemo(() => requestedExamId || exams[0]?.id || null, [requestedExamId, exams])
  const assetUrl = (relativeUrl: string) => getApiUrl(relativeUrl)

  const refreshCoursePayload = async (courseId: string, nextStudentId: string) => {
    const [examsResponse, notificationRows] = await Promise.all([
      fetch(getApiUrl(`/api/exams/student/${nextStudentId}/${courseId}`)),
      fetchStudentNotifications(nextStudentId, courseId),
    ])
    const examsData = await examsResponse.json()
    setExams(Array.isArray(examsData) ? examsData : [])
    setNotifications(notificationRows)
  }

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !isMounted) return

        setStudentId(user.id)

        const accessibleCourses = await listAccessibleCourses(supabase)
        if (!isMounted) return

        setCourses(accessibleCourses)
        const nextCourse = pickAccessibleCourse(accessibleCourses, requestedCourseId)
        setCourse(nextCourse)

        if (!nextCourse) {
          setExams([])
          setDetail(null)
          return
        }

        const [examsResponse, notificationRows] = await Promise.all([
          fetch(getApiUrl(`/api/exams/student/${user.id}/${nextCourse.id}`)),
          fetchStudentNotifications(user.id, nextCourse.id),
        ])
        const examsData = await examsResponse.json()
        if (!isMounted) return

        setExams(Array.isArray(examsData) ? examsData : [])
        setNotifications(notificationRows)
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadPage()

    return () => {
      isMounted = false
    }
  }, [requestedCourseId, supabase])

  useEffect(() => {
    let isMounted = true

    async function loadDetail() {
      if (!selectedExamId || !studentId) return

      const response = await fetch(getApiUrl(`/api/exams/${selectedExamId}?student_id=${studentId}`))
      const data = await response.json()
      if (!isMounted) return

      setDetail(data)
      setRetakeMode(!data?.attempt)
      setAnswers({})
      setReviewAnswers({})
      setReviewStatus({})
      setPreviewImage(null)
      setExamPage(0)
    }

    void loadDetail()

    return () => {
      isMounted = false
    }
  }, [selectedExamId, studentId])

  const submitExam = async () => {
    if (!detail || !studentId) return
    setSubmitting(true)

    try {
      const response = await fetch(getApiUrl(`/api/exams/${detail.exam.id}/submit`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          answers,
          duration_minutes: detail.exam.duration_minutes,
        }),
      })
      const data = await response.json()
      setDetail(data)
      setRetakeMode(false)
      setReviewAnswers({})
      setReviewStatus({})

      if (course) {
        await refreshCoursePayload(course.id, studentId)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submitReview = async (question: ExamQuestion) => {
    if (!question.answer_id || !studentId) return
    const correctedChoice = reviewAnswers[question.answer_id]
    if (!correctedChoice) return

    setReviewingAnswerId(question.answer_id)
    setReviewStatus(prev => ({ ...prev, [question.answer_id!]: '' }))

    try {
      const response = await fetch(getApiUrl(`/api/exams/answers/${question.answer_id}/review`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          corrected_choice: correctedChoice,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.detail ?? '복기 답안을 제출하지 못했습니다.')
      }

      setDetail(data)
      const updatedQuestion = data?.questions?.find((item: ExamQuestion) => item.answer_id === question.answer_id)
      setReviewStatus(prev => ({
        ...prev,
        [question.answer_id!]:
          updatedQuestion?.resolved_via_tutor
            ? '좋아요. 오답 복기를 통해 정답으로 다시 연결되었습니다.'
            : '아직 정답이 아니에요. 튜터 질문을 다시 따라간 뒤 한 번 더 시도해보세요.',
      }))

      if (course) {
        await refreshCoursePayload(course.id, studentId)
      }
    } catch (reviewError) {
      setReviewStatus(prev => ({
        ...prev,
        [question.answer_id!]:
          reviewError instanceof Error ? reviewError.message : '복기 답안을 제출하지 못했습니다.',
      }))
    } finally {
      setReviewingAnswerId(null)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400">로딩 중...</div>
  }

  if (!course) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">연결된 시험 반이 없습니다.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            현재 계정에 접근 가능한 반이 없어 시험 화면을 열 수 없습니다.
          </p>
        </div>
      </div>
    )
  }

  const wrongQuestions = detail?.questions.filter(question => question.is_correct === false) ?? []
  const unresolvedWrongQuestions = wrongQuestions.filter(question => !question.resolved_via_tutor)
  const firstWrongQuestion = unresolvedWrongQuestions[0]
  const examSourceLabel = buildExamSourceLabel(detail?.exam)

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Online Assessment
            </div>
            <h1 className="mt-3 text-3xl font-semibold text-slate-950">온라인 시험과 오답 복기</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              시험을 제출하면 자동 채점되고, 틀린 문항은 바로 소크라테스식 질문 복기로 이어집니다.
            </p>
            <p className="mt-3 text-sm font-medium text-blue-700">현재 반: {course.title}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/student/dashboard?course=${course.id}`}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              학생 대시보드
            </Link>
            <Link
              href={`/student/tutor?course=${course.id}`}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              튜터로 이동
            </Link>
          </div>
        </div>
      </section>

      <CoursePicker courses={courses} selectedCourseId={course.id} label="시험을 볼 반 선택" />

      {notifications.length > 0 && (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-950">숙제 알림</h2>
          <div className="mt-4 space-y-3">
            {notifications.map(notification => (
              <Link
                key={notification.id}
                href={notification.exam_id ? `/student/exams?course=${course.id}&exam=${notification.exam_id}` : `/student/exams?course=${course.id}`}
                className={`block rounded-2xl border bg-white px-4 py-4 transition ${
                  notification.notification_type === 'assignment_overdue'
                    ? 'border-rose-100 hover:border-rose-200'
                    : 'border-white/80 hover:border-blue-200'
                }`}
              >
                <p className="text-sm font-medium text-slate-900">{notification.message}</p>
                {notification.exam_title && (
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {notification.exam_title}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  {notification.notification_type === 'assignment_overdue' ? '마감 지남' : '새 과제'}
                  {notification.assignment_type ? ` · ${notification.assignment_type === 'exam' ? '시험형' : '숙제형'}` : ''}
                  {notification.due_at
                    ? ` · 마감 ${new Date(notification.due_at).toLocaleDateString('ko-KR')}`
                    : notification.published_at
                      ? ` · 시작 ${new Date(notification.published_at).toLocaleDateString('ko-KR')}`
                      : ''}
                  {notification.teacher_name ? ` · 담당 ${notification.teacher_name} 선생님` : ''}
                </p>
                <p className="mt-1 text-xs text-slate-400">{new Date(notification.created_at).toLocaleString('ko-KR')}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">시험 목록</h2>
                <p className="mt-1 text-sm text-slate-500">최근 결과가 있는 시험은 점수와 오답 개수를 함께 보여줍니다.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {exams.map(exam => (
                <Link
                  key={exam.id}
                  href={`/student/exams?course=${course.id}&exam=${exam.id}`}
                  className={`block rounded-2xl border px-4 py-4 transition ${
                    exam.id === selectedExamId
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900">{exam.title}</p>
                  <p className="mt-2 text-sm text-slate-500">문항 {exam.question_count}개</p>
                  {exam.due_at && (
                    <p className={`mt-2 text-xs font-medium ${exam.is_overdue ? 'text-red-600' : 'text-slate-400'}`}>
                      마감 {new Date(exam.due_at).toLocaleDateString('ko-KR')}
                    </p>
                  )}
                  {exam.latest_attempt ? (
                    <p className="mt-2 text-sm text-blue-700">
                      {exam.latest_attempt.score}/{exam.latest_attempt.max_score} · 오답 {exam.latest_attempt.wrong_count}개
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">아직 응시 기록 없음</p>
                  )}
                </Link>
              ))}
            </div>
          </section>
        </aside>

        <section className="min-w-0 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          {!detail && (
            <p className="text-sm text-slate-500">시험을 선택하면 상세 내용이 표시됩니다.</p>
          )}

          {detail && (
            <>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">{detail.exam.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{detail.exam.description}</p>
                  {(detail.exam.learning_objective || examSourceLabel) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detail.exam.learning_objective && (
                        <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                          교육 목적: {detail.exam.learning_objective}
                        </span>
                      )}
                      {examSourceLabel && (
                        <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                          자료 범위: {examSourceLabel}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-3 text-sm text-slate-400">
                    제한 시간 {detail.exam.duration_minutes}분 · 총점 {detail.exam.total_points}점
                    {detail.exam.due_at ? ` · 마감 ${new Date(detail.exam.due_at).toLocaleDateString('ko-KR')}` : ''}
                  </p>
                </div>
                {detail.attempt && !retakeMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setRetakeMode(true)
                      setAnswers({})
                    }}
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                  >
                    <RotateCcw className="h-4 w-4" />
                    다시 응시하기
                  </button>
                )}
              </div>

              {detail.attempt && !retakeMode && (
                <div className="mt-6 space-y-4">
                  <div className="rounded-[28px] border border-blue-100 bg-blue-50/80 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">Latest Result</p>
                    <p className="mt-3 text-3xl font-semibold text-slate-950">
                      {detail.attempt.score} / {detail.attempt.max_score}
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {detail.attempt.attempt_number}회차 응시 · {new Date(detail.attempt.submitted_at).toLocaleString('ko-KR')}
                    </p>
                  </div>

                  {wrongQuestions.length > 0 && (
                    <div className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Socratic Review Flow</p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-950">오답 복기를 시작해보세요</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        1. 틀린 문항을 튜터에게 가져가 개념 질문을 따라갑니다. 2. 아래 카드에서 다시 답을 고릅니다.
                        3. 정답으로 연결되면 해결 상태가 기록됩니다.
                      </p>
                      {firstWrongQuestion && (
                        <button
                          type="button"
                          onClick={() => {
                            setTutorContext({
                              concept: firstWrongQuestion.concept_tag,
                              prompt: firstWrongQuestion.tutor_prompt ?? undefined,
                              question: `${detail.exam.title} ${firstWrongQuestion.question_order}번 문항: ${firstWrongQuestion.prompt}`,
                              contextTitle: `${detail.exam.title} ${firstWrongQuestion.question_order}번 오답 복기`,
                            })
                            setTutorOpen(true)
                          }}
                          className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                        >
                          <MessageCircle className="h-4 w-4" />
                          첫 오답부터 튜터 복기 시작
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {retakeMode ? (
                <div className="mt-6 space-y-5">
                  {(() => {
                    const previewExam: PreviewExam = {
                      title: detail.exam.title,
                      description: detail.exam.description,
                      learningObjective: detail.exam.learning_objective ?? undefined,
                      durationMinutes: detail.exam.duration_minutes,
                      totalPoints: detail.exam.total_points,
                      examDate: detail.exam.exam_date,
                      sourceLabel: examSourceLabel || undefined,
                      questions: detail.questions.map((q, i) => ({
                        id: q.id,
                        order: q.question_order ?? i + 1,
                        prompt: q.prompt,
                        concept: q.concept_tag,
                        points: detail.exam.total_points
                          ? Math.round(detail.exam.total_points / detail.questions.length)
                          : 10,
                        choices: q.choices,
                      })),
                    }
                    const totalPages = Math.ceil(previewExam.questions.length / QUESTIONS_PER_PAGE)
                    return (
                      <StudentPaperPreview
                        preview={previewExam}
                        currentPage={examPage}
                        totalPages={totalPages}
                        onPageChange={setExamPage}
                        answers={answers}
                        onSelectAnswer={(qId, label) => setAnswers(prev => ({ ...prev, [qId]: label }))}
                      />
                    )
                  })()}

                  <button
                    type="button"
                    onClick={() => void submitExam()}
                    disabled={submitting}
                    className="w-full rounded-2xl bg-slate-950 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {submitting ? '채점 중...' : '시험 제출하기'}
                  </button>
                </div>
              ) : (
                <div className="mt-6 space-y-4">
                  {detail.questions.map(question => {
                    const reviewChoice =
                      (question.answer_id && reviewAnswers[question.answer_id]) ||
                      question.corrected_choice ||
                      ''
                    const reviewMessage = question.answer_id ? reviewStatus[question.answer_id] : ''

                    return (
                      <article key={question.id} className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {question.question_order}번
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              question.is_correct
                                ? 'bg-emerald-50 text-emerald-700'
                                : question.resolved_via_tutor
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'bg-red-50 text-red-600'
                            }`}
                          >
                            {question.is_correct ? '정답' : question.resolved_via_tutor ? '복기 완료' : '오답'}
                          </span>
                        </div>
                        <p className="mt-4 text-sm font-semibold leading-7 text-slate-900">{question.prompt}</p>
                        <p className="mt-3 text-sm text-slate-600">
                          처음 고른 답 {question.student_answer ?? '-'}
                          {question.is_correct && question.correct_choice
                            ? ` · 정답 ${question.correct_choice}`
                            : question.resolved_via_tutor && question.correct_choice
                              ? ` · 복기 후 정답 ${question.correct_choice}`
                              : ' · 정답은 복기 완료 후 공개됩니다.'}
                        </p>

                        {question.is_correct === true && question.explanation && (
                          <p className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-sm leading-6 text-emerald-900">
                            {question.explanation}
                          </p>
                        )}
                        {question.can_view_solution && question.evidence_excerpt && (
                          <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-900">
                            {question.source_reference ? `${question.source_reference} · ` : ''}
                            {question.evidence_excerpt}
                          </p>
                        )}
                        {question.can_view_solution && (question.source_chunk_previews?.length ?? 0) > 0 && (
                          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">근거 텍스트 조각</p>
                            <div className="mt-3 space-y-3">
                              {question.source_chunk_previews?.map(chunk => (
                                <div key={chunk.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                  <p className="text-xs font-semibold text-slate-500">
                                    {chunk.page_label ?? (chunk.page_number ? `${chunk.page_number}p` : '교재 텍스트')}
                                  </p>
                                  <p className="mt-2 text-sm leading-6 text-slate-700">{chunk.content}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {question.can_view_solution && (question.page_asset_urls?.length ?? 0) > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {question.page_asset_urls?.map((url, index) => (
                              <button
                                key={`${question.id}-${url}`}
                                type="button"
                                onClick={() =>
                                  setPreviewImage({
                                    url: assetUrl(url),
                                    label: question.source_reference
                                      ? `${question.source_reference} ${question.source_pages?.[index]}p`
                                      : `${question.source_pages?.[index]}p`,
                                  })
                                }
                                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                              >
                                {question.source_pages?.[index]}p 원문 보기
                              </button>
                            ))}
                          </div>
                        )}

                        {question.is_correct === false && (
                          <div className="mt-4 space-y-4">
                            {question.resolved_via_tutor ? (
                              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm leading-6 text-blue-900">
                                다시 고른 답 {question.corrected_choice ?? question.correct_choice ?? '-'}
                                {question.explanation ? ` · ${question.explanation}` : ''}
                              </div>
                            ) : (
                              <>
                                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                                  튜터에게 바로 정답을 받기보다, 개념을 스스로 떠올릴 수 있도록 질문 흐름으로 다시 풀어보세요.
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTutorContext({
                                        concept: question.concept_tag,
                                        prompt: question.tutor_prompt ?? undefined,
                                        question: `${detail.exam.title} ${question.question_order}번 문항: ${question.prompt}`,
                                        contextTitle: `${detail.exam.title} ${question.question_order}번 오답 복기`,
                                      })
                                      setTutorOpen(true)
                                    }}
                                    className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                                  >
                                    <MessageCircle className="h-4 w-4" />
                                    이 문제 튜터에게 질문하기
                                  </button>
                                </div>
                                <div className="grid gap-3">
                                  {question.choices.map(choice => (
                                    <button
                                      key={`${question.id}-${choice.label}`}
                                      type="button"
                                      onClick={() => {
                                        if (!question.answer_id) return
                                        setReviewAnswers(prev => ({ ...prev, [question.answer_id!]: choice.label }))
                                      }}
                                      className={`rounded-2xl border px-4 py-4 text-left text-sm leading-6 transition ${
                                        reviewChoice === choice.label
                                          ? 'border-blue-300 bg-blue-50 text-blue-900'
                                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                                      }`}
                                    >
                                      <span className="font-semibold">{choice.label}.</span> {choice.text}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  disabled={!question.answer_id || !reviewChoice || reviewingAnswerId === question.answer_id}
                                  onClick={() => void submitReview(question)}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
                                >
                                  {reviewingAnswerId === question.answer_id ? '확인 중...' : '복기 후 다시 답하기'}
                                </button>
                              </>
                            )}

                            {reviewMessage && (
                              <p
                                className={`rounded-2xl border px-4 py-4 text-sm leading-6 ${
                                  question.answer_id && question.correct_choice && reviewChoice === question.correct_choice
                                    ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                                    : 'border-amber-100 bg-amber-50 text-amber-800'
                                }`}
                              >
                                {reviewMessage}
                              </p>
                            )}
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </>
          )}
          {previewImage && (
            <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">교재 원문 보기</p>
              <p className="mt-3 text-sm font-semibold text-slate-900">{previewImage.label}</p>
              <img
                src={previewImage.url}
                alt={previewImage.label}
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white object-contain"
              />
            </div>
          )}
        </section>

      </div>

      {/* 플로팅 AI 튜터 버튼 */}
      <button
        type="button"
        onClick={() => {
          if (!tutorContext && detail) {
            setTutorContext({
              concept: firstWrongQuestion?.concept_tag ?? detail.questions[0]?.concept_tag ?? '시험 복기',
              prompt: firstWrongQuestion?.tutor_prompt ?? '이번 시험에서 틀렸거나 헷갈린 문제를 바탕으로, 내가 스스로 근거를 말하게 질문해줘.',
              question: firstWrongQuestion
                ? `${detail.exam.title} ${firstWrongQuestion.question_order}번 문항: ${firstWrongQuestion.prompt}`
                : undefined,
              contextTitle: '시험 페이지 기준 복기',
            })
          }
          setTutorOpen(true)
        }}
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(15,23,42,0.25)] transition hover:bg-slate-800 active:scale-95"
      >
        <MessageCircle className="h-5 w-5" />
        AI 튜터
      </button>

      <TutorSidebar
        open={tutorOpen}
        onClose={() => setTutorOpen(false)}
        courseId={course.id}
        studentId={studentId}
        concept={tutorContext?.concept}
        starterPrompt={tutorContext?.prompt}
        focusQuestion={tutorContext?.question}
        contextTitle={tutorContext?.contextTitle}
        learningObjective={detail?.exam.learning_objective ?? undefined}
        sourceReference={examSourceLabel || undefined}
        sourceType="exam_review"
        sourceReferenceId={firstWrongQuestion?.answer_id ?? undefined}
      />
    </div>
  )
}

export default function StudentExamsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-slate-400">로딩 중...</div>}>
      <ExamsPageContent />
    </Suspense>
  )
}
