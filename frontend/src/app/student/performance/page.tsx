'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BarChart3,
  BookOpenText,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import TutorSidebar from '@/components/chat/TutorSidebar'
import CoursePicker from '@/components/course/CoursePicker'
import ScoreBarChart from '@/components/workspace/ScoreBarChart'
import { createClient } from '@/lib/supabase'
import {
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'
import {
  fetchStudentPerformance,
  type StudentPerformanceOverview,
} from '@/lib/workspace-api'

function StudentPerformanceContent() {
  const searchParams = useSearchParams()
  const requestedCourseId = searchParams.get('course')
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [studentId, setStudentId] = useState('')
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [overview, setOverview] = useState<StudentPerformanceOverview | null>(null)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [tutorOpen, setTutorOpen] = useState(false)

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return

        setStudentId(user.id)

        const nextCourses = await listAccessibleCourses(supabase)
        if (!active) return
        setCourses(nextCourses)

        const nextCourse = pickAccessibleCourse(nextCourses, requestedCourseId)
        setCourse(nextCourse)

        if (!nextCourse) {
          setOverview(null)
          return
        }

        const nextOverview = await fetchStudentPerformance(user.id, nextCourse.id)
        if (!active) return

        setOverview(nextOverview)
        setSelectedSubject(nextOverview.subjects[0]?.subject ?? null)
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

  const subject = overview?.subjects.find(item => item.subject === selectedSubject) ?? overview?.subjects[0] ?? null
  const tutorPrompt = subject
    ? `${subject.subject} 성적을 보고 어디 개념부터 다시 생각해봐야 하는지 질문으로 도와줘.`
    : '내 시험 성적을 보고 어떤 개념부터 다시 보면 좋을지 질문으로 도와줘.'
  const tutorFocusQuestion = subject
    ? `${subject.subject} 평균 ${subject.average_score ?? '미집계'}점 · 가장 먼저 볼 단원 ${subject.sections[0]?.section ?? '없음'}`
    : '과목별 시험 성적을 바탕으로 복기합니다.'

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">시험 성적 페이지를 불러오는 중입니다.</div>
  }

  if (!course || !overview) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
        성적을 확인할 수 있는 반을 찾지 못했습니다.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#fefce8,#ffffff_48%,#eff6ff)] p-6 shadow-sm">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            Performance
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">과목별 시험 성적</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            성적을 확인한 뒤, 오른쪽 아래 AI 튜터 버튼으로 해당 과목 복기를 바로 이어갈 수 있습니다.
          </p>
        </div>
      </section>

      <CoursePicker courses={courses} selectedCourseId={course.id} label="성적을 볼 반 선택" />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">과목 수</p>
          <p className="mt-4 text-4xl font-black text-slate-950">{overview.summary.subject_count}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">최초 평균</p>
          <p className="mt-4 text-4xl font-black text-blue-600">{overview.summary.average_first_score ?? '미집계'}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">완료 시험</p>
          <p className="mt-4 text-4xl font-black text-emerald-600">{overview.summary.completed_exams}</p>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">교과별 성적</h2>
            <p className="mt-1 text-sm text-slate-500">먼저 과목을 고른 뒤, 아래에서 목차별 점수와 시험 카드를 확인하세요.</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {overview.subjects.map(item => (
            <button
              key={item.subject}
              type="button"
              onClick={() => setSelectedSubject(item.subject)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                subject?.subject === item.subject
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              {item.subject}
            </button>
          ))}
        </div>
      </section>

      <ScoreBarChart
        title="과목별 평균 시험 성적"
        caption="최초 시험 점수를 기준으로 과목별 현재 위치를 확인합니다."
        items={overview.subjects.map(item => ({
          label: item.subject,
          value: item.average_score,
          meta: `${item.question_count}문항`,
        }))}
        accent="blue"
        emptyMessage="과목 성적 데이터가 아직 없습니다."
      />

      {subject && (
        <ScoreBarChart
          title={`${subject.subject} 목차별 성적`}
          caption="낮은 단원부터 튜터와 함께 복기하면 더 빠르게 따라갈 수 있습니다."
          items={subject.sections.map(section => ({
            label: section.section,
            value: section.average_score,
            meta: `${section.question_count}문항`,
          }))}
          accent="emerald"
          emptyMessage="목차별 세부 데이터가 아직 없습니다."
        />
      )}

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
            <BookOpenText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">시험 카드</h2>
            <p className="mt-1 text-sm text-slate-500">여태 응시한 시험을 카드 형태로 빠르게 훑습니다.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {overview.exam_cards.map(exam => (
            <article key={exam.exam_id} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-base font-semibold text-slate-900">{exam.title}</p>
              <p className="mt-2 text-sm text-slate-500">{exam.subjects.join(', ')}</p>
              <p className="mt-3 text-sm text-blue-700">평균 {exam.average_score ?? '미집계'}점 · 오답 {exam.wrong_count}개</p>
            </article>
          ))}
        </div>
      </section>

      {/* 플로팅 AI 튜터 버튼 */}
      <button
        type="button"
        onClick={() => setTutorOpen(true)}
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
        concept={subject?.subject ?? '시험 성적 복기'}
        starterPrompt={tutorPrompt}
        focusQuestion={tutorFocusQuestion}
        contextTitle="시험 성적 기준 복기"
        sourceType="exam_result"
      />
    </div>
  )
}

export default function StudentPerformancePage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <StudentPerformanceContent />
    </Suspense>
  )
}
