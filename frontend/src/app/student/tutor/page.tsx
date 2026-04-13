'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowUpRight,
  BookOpenText,
  Compass,
  Sparkles,
} from 'lucide-react'
import TutorWorkspacePanel from '@/components/chat/TutorWorkspacePanel'
import CoursePicker from '@/components/course/CoursePicker'
import {
  CURRICULUM_PRESETS,
  getCurriculumPreset,
  SCHOOL_LEVEL_ORDER,
} from '@/lib/curriculum-presets'
import {
  DEMO_COURSE_ID,
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'
import { createClient } from '@/lib/supabase'

function TutorPageContent() {
  const searchParams = useSearchParams()
  const presetId = searchParams.get('preset')
  const requestedCourseId = searchParams.get('course')
  const linkedExamId = searchParams.get('exam')
  const sourceType = searchParams.get('source') || undefined
  const sourceReferenceId = searchParams.get('source_ref') || undefined
  const focusQuestion = searchParams.get('question') || undefined
  const contextTitle = searchParams.get('context') || undefined
  const learningObjective = searchParams.get('objective') || undefined
  const sourceReference = searchParams.get('source_label') || undefined
  const starterPrompt = searchParams.get('prompt') || undefined
  const selectedPreset = getCurriculumPreset(presetId)
  const [studentId, setStudentId] = useState('guest')
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [resolvedCourseId, setResolvedCourseId] = useState(requestedCourseId || DEMO_COURSE_ID)
  const supabase = useMemo(() => createClient(), [])

  const concept = searchParams.get('concept') || selectedPreset?.concept || '개념 학습'
  const initialPrompt = starterPrompt || selectedPreset?.samplePrompt

  useEffect(() => {
    let active = true

    async function loadContext() {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return

      setStudentId(user?.id ?? 'guest')

      try {
        const nextCourses = await listAccessibleCourses(supabase)
        if (!active) return

        setCourses(nextCourses)
        const nextCourse = pickAccessibleCourse(nextCourses, requestedCourseId)
        setCourse(nextCourse)
        setResolvedCourseId(nextCourse?.id ?? requestedCourseId ?? DEMO_COURSE_ID)
      } catch {
        if (!active) return
        setCourse(null)
        setResolvedCourseId(requestedCourseId ?? DEMO_COURSE_ID)
      }
    }

    void loadContext()
    return () => {
      active = false
    }
  }, [requestedCourseId, supabase])

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eef6ff,#ffffff_46%,#fff7ed)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Tutor Workspace
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">AI 소크라테스 튜터</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              현재 보고 있는 시험이나 성적 맥락을 이어서 질문할 수 있고, 세션별로 대화가 분리되어 저장됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/student/dashboard"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              학생 홈
            </Link>
            <Link
              href={`/student/exams?course=${resolvedCourseId}${linkedExamId ? `&exam=${linkedExamId}` : ''}`}
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              시험으로 돌아가기
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <CoursePicker courses={courses} selectedCourseId={course?.id ?? resolvedCourseId} label="학습 중인 반" />

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <BookOpenText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">현재 대화 맥락</h2>
                <p className="mt-1 text-sm text-slate-500">{focusQuestion || concept}</p>
              </div>
            </div>
            {selectedPreset && (
            <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">{selectedPreset.title}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{selectedPreset.summary}</p>
              </div>
            )}
            {(learningObjective || sourceReference) && (
              <div className="mt-4 rounded-[22px] border border-blue-100 bg-blue-50/70 px-4 py-4">
                {learningObjective && <p className="text-sm leading-6 text-blue-900">교육 목적: {learningObjective}</p>}
                {sourceReference && <p className="mt-2 text-sm leading-6 text-blue-800">자료 범위: {sourceReference}</p>}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">교육과정 예시</h2>
                <p className="mt-1 text-sm text-slate-500">학교급별로 바로 시작할 수 있는 튜터 예시입니다.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {SCHOOL_LEVEL_ORDER.map(level => (
                <div key={level}>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{level}</p>
                  <div className="mt-2 space-y-2">
                    {CURRICULUM_PRESETS.filter(preset => preset.schoolLevel === level).map(preset => (
                      <Link
                        key={preset.id}
                        href={`/student/tutor?preset=${preset.id}&course=${resolvedCourseId}`}
                        className="block rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 transition hover:border-slate-300"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{preset.title}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {preset.gradeBand} · {preset.subject}
                            </p>
                          </div>
                          <ArrowUpRight className="h-4 w-4 text-slate-400" />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{preset.summary}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>

        <TutorWorkspacePanel
          courseId={resolvedCourseId}
          studentId={studentId}
          defaultConcept={concept}
          starterPrompt={initialPrompt}
          sourceType={sourceType}
          sourceReferenceId={sourceReferenceId}
          focusQuestion={focusQuestion}
          contextTitle={contextTitle}
          learningObjective={learningObjective}
          sourceReference={sourceReference}
          autoSelectFirst
          title="AI 소크라테스 튜터"
          subtitle="세션 선택, 새 세션 생성, 삭제가 모두 DB 기준으로 동작합니다."
        />
      </div>
    </div>
  )
}

export default function StudentTutorPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <TutorPageContent />
    </Suspense>
  )
}
