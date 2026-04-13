'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BookOpenCheck,
  CheckCircle2,
  Clock3,
  FileStack,
  FileText,
  GraduationCap,
  LibraryBig,
  Sparkles,
} from 'lucide-react'
import CoursePicker from '@/components/course/CoursePicker'
import MaterialUpload from '@/components/teacher/MaterialUpload'
import { getApiUrl } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import {
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'
import {
  formatMaterialDateTime,
  getMaterialNextAction,
  getMaterialPipelineProgress,
  getMaterialPipelineSteps,
  getMaterialPrimaryStatus,
  isMaterialPipelineActive,
  type MaterialPipelineLike,
  type MaterialPipelineState,
  type MaterialPipelineTone,
} from '@/lib/material-status'

type Material = MaterialPipelineLike & {
  id: string
  file_name: string
  indexed: boolean
  created_at: string
}

type MaterialSection = {
  order?: number
  title: string
  page_start: number
  page_end: number
  learning_objective?: string
}

type CourseExam = {
  id: string
  title: string
  assignment_type?: 'exam' | 'homework'
  workflow_status?: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
  source_format?: string | null
  question_count: number
  pending_student_count?: number
  published_at?: string | null
  due_at?: string | null
  material_id?: string | null
  section_title?: string | null
  learning_objective?: string | null
}

type MaterialDetail = Material & {
  summary_text?: string | null
  detected_sections?: MaterialSection[]
  related_exams?: CourseExam[]
}

async function fetchMaterials(courseId: string): Promise<Material[]> {
  const response = await fetch(getApiUrl(`/api/materials/course/${courseId}`), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('자료 목록을 불러오지 못했습니다.')
  }

  const data = await response.json()
  return Array.isArray(data) ? data : []
}

async function fetchCourseExams(courseId: string): Promise<CourseExam[]> {
  const response = await fetch(getApiUrl(`/api/exams/course/${courseId}`), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('시험 목록을 불러오지 못했습니다.')
  }

  const data = await response.json()
  return Array.isArray(data) ? data : []
}

async function fetchMaterialDetail(materialId: string): Promise<MaterialDetail> {
  const response = await fetch(getApiUrl(`/api/materials/${materialId}`), {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('자료 상세를 불러오지 못했습니다.')
  }

  return response.json()
}

async function generateMaterialDrafts(options: {
  materialId: string
  teacherId: string
  maxSections?: number
  questionsPerSection?: number
}) {
  const response = await fetch(getApiUrl(`/api/materials/${options.materialId}/generate-drafts`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      teacher_id: options.teacherId,
      max_sections: options.maxSections ?? 3,
      questions_per_section: options.questionsPerSection ?? 10,
    }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '시험 초안 다시 생성에 실패했습니다.')
  }

  return response.json()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

function formatCount(value?: number | null) {
  return new Intl.NumberFormat('ko-KR').format(value ?? 0)
}

function getTonePillClasses(tone: MaterialPipelineTone, selected = false) {
  if (tone === 'error') {
    return selected ? 'bg-red-400/20 text-red-100' : 'bg-red-50 text-red-700'
  }
  if (tone === 'warning') {
    return selected ? 'bg-amber-400/20 text-amber-100' : 'bg-amber-50 text-amber-700'
  }
  if (tone === 'processing') {
    return selected ? 'bg-blue-400/20 text-blue-100' : 'bg-blue-50 text-blue-700'
  }
  if (tone === 'success') {
    return selected ? 'bg-emerald-400/20 text-emerald-100' : 'bg-emerald-50 text-emerald-700'
  }
  return selected ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'
}

function getProgressBarClasses(tone: MaterialPipelineTone) {
  if (tone === 'error') return 'bg-red-500'
  if (tone === 'warning') return 'bg-amber-500'
  if (tone === 'processing') return 'bg-blue-500'
  if (tone === 'success') return 'bg-emerald-500'
  return 'bg-slate-400'
}

function getStepStateClasses(state: MaterialPipelineState) {
  if (state === 'failed') return 'border-red-200 bg-red-50'
  if (state === 'complete') return 'border-emerald-200 bg-emerald-50'
  if (state === 'current') return 'border-blue-200 bg-blue-50'
  return 'border-slate-200 bg-white'
}

function getStepDotClasses(state: MaterialPipelineState) {
  if (state === 'failed') return 'bg-red-500'
  if (state === 'complete') return 'bg-emerald-500'
  if (state === 'current') return 'bg-blue-500'
  return 'bg-slate-300'
}

function getStepStateLabel(state: MaterialPipelineState) {
  if (state === 'failed') return '오류'
  if (state === 'complete') return '완료'
  if (state === 'current') return '진행 중'
  return '대기'
}

function MaterialsPageContent() {
  const searchParams = useSearchParams()
  const requestedCourseId = searchParams.get('course')
  const [teacherId, setTeacherId] = useState('')
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [exams, setExams] = useState<CourseExam[]>([])
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null)
  const [selectedMaterialDetail, setSelectedMaterialDetail] = useState<MaterialDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [regeneratingDrafts, setRegeneratingDrafts] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      try {
        const [
          {
            data: { user },
          },
          accessibleCourses,
        ] = await Promise.all([supabase.auth.getUser(), listAccessibleCourses(supabase)])
        if (!isMounted) return

        setTeacherId(user?.id ?? '')
        setCourses(accessibleCourses)
        const nextCourse = pickAccessibleCourse(accessibleCourses, requestedCourseId)
        setCourse(nextCourse)
        setError('')

        if (!nextCourse) {
          setMaterials([])
          setExams([])
          setSelectedMaterialDetail(null)
          setLoading(false)
          return
        }

        const [nextMaterials, nextExams] = await Promise.all([
          fetchMaterials(nextCourse.id),
          fetchCourseExams(nextCourse.id),
        ])
        if (!isMounted) return

        setMaterials(nextMaterials)
        setExams(nextExams)
        setSelectedMaterialId(current => current ?? nextMaterials[0]?.id ?? null)
      } catch (loadError) {
        if (!isMounted) return
        setMaterials([])
        setExams([])
        setSelectedMaterialDetail(null)
        setError(loadError instanceof Error ? loadError.message : '자료 화면을 불러오지 못했습니다.')
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

  const refreshMaterials = useCallback(async (preferredMaterialId?: string | null) => {
    if (!course) return
    try {
      const [nextMaterials, nextExams] = await Promise.all([fetchMaterials(course.id), fetchCourseExams(course.id)])
      setMaterials(nextMaterials)
      setExams(nextExams)
      setError('')

      const candidateMaterialId = preferredMaterialId ?? selectedMaterialId
      const nextSelectedMaterialId =
        !candidateMaterialId
          ? nextMaterials[0]?.id ?? null
          : nextMaterials.some(material => material.id === candidateMaterialId)
            ? candidateMaterialId
            : nextMaterials[0]?.id ?? null

      setSelectedMaterialId(nextSelectedMaterialId)
      if (nextSelectedMaterialId) {
        const detail = await fetchMaterialDetail(nextSelectedMaterialId).catch(() => null)
        setSelectedMaterialDetail(detail)
      } else {
        setSelectedMaterialDetail(null)
      }
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '자료 상태를 새로고침하지 못했습니다.')
    }
  }, [course, selectedMaterialId])

  useEffect(() => {
    let isMounted = true

    async function loadMaterialDetail() {
      if (!selectedMaterialId) {
        setSelectedMaterialDetail(null)
        return
      }

      setLoadingDetail(true)
      try {
        const detail = await fetchMaterialDetail(selectedMaterialId)
        if (!isMounted) return
        setSelectedMaterialDetail(detail)
      } catch {
        if (!isMounted) return
        setSelectedMaterialDetail(null)
      } finally {
        if (isMounted) {
          setLoadingDetail(false)
        }
      }
    }

    void loadMaterialDetail()
    return () => {
      isMounted = false
    }
  }, [selectedMaterialId])

  useEffect(() => {
    if (!course) return
    const hasActiveProcessing = materials.some(isMaterialPipelineActive)
    if (!hasActiveProcessing) return

    const timer = window.setInterval(() => {
      void refreshMaterials()
    }, 2500)

    return () => {
      window.clearInterval(timer)
    }
  }, [course, materials, refreshMaterials])

  const selectedMaterial = materials.find(item => item.id === selectedMaterialId) ?? materials[0] ?? null
  const indexedCount = materials.filter(item => item.indexed).length
  const activeProcessingCount = materials.filter(isMaterialPipelineActive).length
  const failedCount = materials.filter(
    item => item.processing_status === 'failed' || item.draft_generation_status === 'failed',
  ).length
  const publishedCount = exams.filter(item => item.workflow_status === 'published').length
  const homeworkCount = exams.filter(item => item.assignment_type === 'homework').length
  const pendingCount = exams.reduce((sum, item) => sum + (item.pending_student_count ?? 0), 0)

  const relatedExams = selectedMaterialDetail?.related_exams ?? exams.filter(item => item.material_id === selectedMaterial?.id)
  const detectedSections = selectedMaterialDetail?.detected_sections ?? []
  const selectedMaterialStatus = selectedMaterial ? getMaterialPrimaryStatus(selectedMaterial) : null
  const selectedMaterialProgress = selectedMaterial ? getMaterialPipelineProgress(selectedMaterial) : 0
  const selectedMaterialSteps = selectedMaterial ? getMaterialPipelineSteps(selectedMaterial) : []

  const handleRegenerateDrafts = async () => {
    if (!selectedMaterial || !teacherId) return
    setRegeneratingDrafts(true)
    setFeedback('')
    setError('')

    try {
      const result = await generateMaterialDrafts({
        materialId: selectedMaterial.id,
        teacherId,
      })
      await refreshMaterials(selectedMaterial.id)
      const detail = await fetchMaterialDetail(selectedMaterial.id)
      setSelectedMaterialDetail(detail)
      setFeedback(`단원별 시험 초안 ${result.generated_count ?? 0}개를 다시 생성했습니다.`)
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : '시험 초안 다시 생성에 실패했습니다.')
    } finally {
      setRegeneratingDrafts(false)
    }
  }

  const handleDeleteMaterial = async () => {
    if (!selectedMaterial) return
    if (!window.confirm(`"${selectedMaterial.file_name}" 자료를 삭제할까요?\n삭제하면 AI 학습 데이터와 저장된 PDF가 함께 제거됩니다.`)) return
    try {
      await fetch(`/api/materials/${selectedMaterial.id}`, { method: 'DELETE' })
      setSelectedMaterialId(null)
      await refreshMaterials()
    } catch {
      setError('자료 삭제에 실패했습니다.')
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">자료를 연결할 반이 없습니다.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            현재 로그인한 교사 계정에 연결된 반이 없어서 자료 관리 화면을 열 수 없습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eefaf4,#ffffff_48%,#e0f2fe)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" />
              Material Library
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">자료실과 수업 연결</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              올린 자료를 반별로 정리하고, 곧바로 시험지 제작실과 반 분석으로 이어지게 구성했습니다. 교사가 다음 수업 행동을 바로 정할 수 있게 돕는 화면입니다.
            </p>
            <p className="mt-3 text-sm font-medium text-blue-700">현재 반: {course.title}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">업로드 자료</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{materials.length}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">학습 완료</p>
              <p className="mt-3 text-3xl font-black text-emerald-600">{indexedCount}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">처리 중 자료</p>
              <p className="mt-3 text-3xl font-black text-blue-600">{activeProcessingCount}</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">미제출 합계</p>
              <p className="mt-3 text-3xl font-black text-red-600">{pendingCount}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/teacher/exams?course=${course.id}`}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            시험지 제작실
          </Link>
          <Link
            href={`/teacher/dashboard?course=${course.id}`}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
          >
            반 분석 보기
          </Link>
        </div>

        {failedCount > 0 && (
          <p className="mt-4 text-sm font-medium text-red-700">
            현재 오류 상태 자료 {failedCount}건이 있습니다. 자료를 선택하면 실패 지점과 재시도 방향을 바로 확인할 수 있습니다.
          </p>
        )}
      </section>

      <CoursePicker courses={courses} selectedCourseId={course.id} label="자료를 관리할 반 선택" />

      {(feedback || error) && (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error || feedback}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <MaterialUpload courseId={course.id} onUploaded={refreshMaterials} />

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <LibraryBig className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950">이 반에서 바로 이어지는 학습 흐름</h2>
              <p className="mt-1 text-sm text-slate-500">자료 업로드 이후 시험 제작, 숙제 배포, 미제출 추적이 어떻게 이어지는지 한 번에 봅니다.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center gap-2 text-slate-500">
                <BookOpenCheck className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">숙제형 시험</span>
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-900">{homeworkCount}개</p>
              <p className="mt-2 text-sm text-slate-500">자료를 바탕으로 학생별 복습 과제로 연결</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center gap-2 text-slate-500">
                <GraduationCap className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">시험 진행</span>
              </div>
              <p className="mt-3 text-lg font-semibold text-slate-900">{publishedCount}개</p>
              <p className="mt-2 text-sm text-slate-500">학생이 실제로 응시하거나 풀이 중인 항목</p>
            </div>
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center gap-2 text-slate-500">
                <Clock3 className="h-4 w-4" />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">즉시 확인 필요</span>
              </div>
              <p className="mt-3 text-lg font-semibold text-red-600">{pendingCount}명</p>
              <p className="mt-2 text-sm text-slate-500">미제출 학생이 남아 있는 전체 합계</p>
            </div>
          </div>
        </section>
      </div>

      <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">업로드된 자료</h2>
                <p className="mt-1 text-sm text-slate-500">자료를 클릭하면 처리 상태와 다음 활용 방법을 확인할 수 있습니다.</p>
              </div>
              <button onClick={() => void refreshMaterials()} className="text-xs font-medium text-blue-600 hover:underline">
                새로고침
              </button>
            </div>
          </div>

          {materials.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              아직 업로드된 자료가 없습니다.
            </p>
          )}

          {materials.map(material => {
            const isSelected = selectedMaterial?.id === material.id
            const status = getMaterialPrimaryStatus(material)
            const progress = getMaterialPipelineProgress(material)
            const isActive = isMaterialPipelineActive(material)
            return (
              <button
                key={material.id}
                type="button"
                onClick={() => setSelectedMaterialId(material.id)}
                className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                  isSelected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                      {material.file_name}
                    </p>
                    <p className={`mt-2 text-xs ${isSelected ? 'text-slate-200' : 'text-slate-400'}`}>
                      {formatDate(material.created_at)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${getTonePillClasses(status.tone, isSelected)}`}
                  >
                    {status.label}
                  </span>
                </div>

                <div className={`mt-4 h-2 overflow-hidden rounded-full ${isSelected ? 'bg-white/15' : 'bg-slate-100'}`}>
                  <div
                    className={`h-full rounded-full transition-all ${isSelected ? 'bg-white' : getProgressBarClasses(status.tone)}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className={`mt-3 flex flex-wrap items-center gap-2 text-xs ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                  <span>{progress}%</span>
                  {material.page_count ? <span>{formatCount(material.page_count)}p</span> : null}
                  {material.draft_generated_count ? <span>draft {formatCount(material.draft_generated_count)}개</span> : null}
                  {isActive ? <span className="font-semibold">실시간 갱신 중</span> : null}
                </div>
              </button>
            )
          })}
        </div>

        <div className="space-y-6">
          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            {selectedMaterial ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                        업로드 자료
                      </span>
                      {selectedMaterialStatus && (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getTonePillClasses(selectedMaterialStatus.tone)}`}
                        >
                          {selectedMaterialStatus.label}
                        </span>
                      )}
                      {selectedMaterial.indexed && (
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          학생 질문 근거로 사용 가능
                        </span>
                      )}
                      {selectedMaterial.draft_generated_count ? (
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          단원별 draft {selectedMaterial.draft_generated_count}개
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                      {selectedMaterial.file_name}
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      업로드된 자료는 AI가 학습한 뒤 학생 질문의 근거 자료, 시험지 출제 참고 자료, 교사의 재설명 준비 자료로 이어집니다.
                    </p>
                    {selectedMaterial.error_message && (
                      <p className="mt-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
                        {selectedMaterial.error_message}
                      </p>
                    )}
                    {selectedMaterial.draft_generation_error && (
                      <p className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
                        {selectedMaterial.draft_generation_error}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleDeleteMaterial()}
                      className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50"
                    >
                      자료 삭제
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRegenerateDrafts()}
                      disabled={
                        !selectedMaterial.indexed ||
                        regeneratingDrafts ||
                        selectedMaterial.draft_generation_status === 'analyzing' ||
                        selectedMaterial.draft_generation_status === 'generating'
                      }
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
                    >
                      {regeneratingDrafts
                        ? '초안 생성 중...'
                        : selectedMaterial.draft_generation_status === 'analyzing' ||
                            selectedMaterial.draft_generation_status === 'generating'
                          ? selectedMaterial.draft_generation_stage || '초안 생성 중'
                          : '단원별 draft 다시 생성'}
                    </button>
                    <Link
                      href={`/teacher/exams?course=${course.id}`}
                      className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      시험지 제작실로 이동
                    </Link>
                    <Link
                      href={`/teacher/dashboard?course=${course.id}`}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                    >
                      반 분석 보기
                    </Link>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#ffffff_55%,#eff6ff)] p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Live Pipeline</p>
                      <h3 className="mt-2 text-xl font-semibold text-slate-950">실시간 제작 진행 상태</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        업로드 이후 어느 단계에서 멈췄는지, 지금 학생 질문 근거와 시험 초안 생성까지 어디까지 왔는지 한 눈에 봅니다.
                      </p>
                    </div>
                    <div className="rounded-[24px] border border-white/80 bg-white/90 px-4 py-4 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">진행률</p>
                      <p className="mt-2 text-3xl font-black text-slate-950">{selectedMaterialProgress}%</p>
                      <p className="mt-2 text-sm text-slate-500">{selectedMaterialStatus?.label ?? '상태 확인 중'}</p>
                    </div>
                  </div>

                  <div className="mt-5 h-3 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full rounded-full transition-all ${getProgressBarClasses(
                        selectedMaterialStatus?.tone ?? 'neutral',
                      )}`}
                      style={{ width: `${selectedMaterialProgress}%` }}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
                    {selectedMaterial.parser_used ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        parser {selectedMaterial.parser_used}
                      </span>
                    ) : null}
                    {selectedMaterial.processing_started_at ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        시작 {formatMaterialDateTime(selectedMaterial.processing_started_at)}
                      </span>
                    ) : null}
                    {selectedMaterial.processing_completed_at ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        학습 완료 {formatMaterialDateTime(selectedMaterial.processing_completed_at)}
                      </span>
                    ) : null}
                    {selectedMaterial.last_generated_at ? (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                        최근 초안 생성 {formatMaterialDateTime(selectedMaterial.last_generated_at)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-3 xl:grid-cols-4">
                    {selectedMaterialSteps.map((step, index) => (
                      <div
                        key={step.id}
                        className={`rounded-[24px] border px-4 py-4 ${getStepStateClasses(step.state)}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${getStepDotClasses(step.state)}`} />
                            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Step {index + 1}
                            </span>
                          </div>
                          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                            {getStepStateLabel(step.state)}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-900">{step.label}</p>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <FileText className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">파일명</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{selectedMaterial.file_name}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">업로드일</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{formatDate(selectedMaterial.created_at)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">파이프라인 상태</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{selectedMaterialStatus?.label}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <FileStack className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">권장 다음 단계</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{getMaterialNextAction(selectedMaterial)}</p>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <FileStack className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">추출 문자 수</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{formatCount(selectedMaterial.extracted_char_count)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <LibraryBig className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">생성 청크 수</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{formatCount(selectedMaterial.chunk_count)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">페이지 수</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{formatCount(selectedMaterial.page_count)}</p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">자동 생성 draft</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{formatCount(selectedMaterial.draft_generated_count)}</p>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5">
                    <h3 className="text-lg font-semibold text-slate-950">AI가 읽은 자료 요약과 단원</h3>
                    <div className="mt-4 space-y-4">
                      {loadingDetail && (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                          자료 상세를 불러오는 중입니다.
                        </div>
                      )}
                      {!loadingDetail && selectedMaterialDetail?.summary_text && (
                        <div className="rounded-2xl border border-white/80 bg-white px-4 py-4">
                          <p className="text-sm font-semibold text-slate-900">자료 요약</p>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{selectedMaterialDetail.summary_text}</p>
                        </div>
                      )}
                      {!loadingDetail && detectedSections.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                          단원 분석이 아직 완료되지 않았습니다.
                        </div>
                      )}
                      {detectedSections.map((section, index) => (
                        <div key={`${section.title}-${index}`} className="rounded-2xl border border-white/80 bg-white px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                              {index + 1}단원
                            </span>
                            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                              {section.page_start}-{section.page_end}p
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-semibold text-slate-900">{section.title}</p>
                          {section.learning_objective && (
                            <p className="mt-2 text-sm leading-6 text-slate-500">{section.learning_objective}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-5 py-5">
                    <h3 className="text-lg font-semibold text-slate-950">이 자료에서 이어진 시험 초안</h3>
                    <div className="mt-4 space-y-3">
                      {relatedExams.length === 0 && (
                        <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                          아직 이 자료에서 이어진 시험 초안이 없습니다.
                        </p>
                      )}
                      {relatedExams.map(item => (
                        <div key={item.id} className="rounded-2xl border border-white/80 bg-white px-4 py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {item.assignment_type === 'homework' ? '숙제' : '시험'} · {item.question_count}문항
                              </p>
                              {item.section_title && (
                                <p className="mt-2 text-xs text-slate-400">{item.section_title}</p>
                              )}
                            </div>
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
                              {item.workflow_status === 'published'
                                ? '배포 중'
                                : item.workflow_status === 'scheduled'
                                  ? '예약됨'
                                  : '검수 중'}
                            </span>
                          </div>
                          {item.learning_objective && (
                            <p className="mt-3 text-sm leading-6 text-slate-600">{item.learning_objective}</p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-3">
                            <Link
                              href={`/teacher/exams?course=${course.id}&exam=${item.id}&open=editor`}
                              className="text-sm font-medium text-blue-600 hover:underline"
                            >
                              시험지 제작실에서 바로 열기
                            </Link>
                            {item.workflow_status === 'scheduled' && item.published_at && (
                              <span className="text-sm text-slate-500">시작 {formatMaterialDateTime(item.published_at)}</span>
                            )}
                            {item.due_at && (
                              <span className="text-sm text-slate-500">마감 {formatDate(item.due_at)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                왼쪽에서 자료를 선택하면 상세 내용과 활용 흐름을 볼 수 있습니다.
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  )
}

export default function MaterialsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <MaterialsPageContent />
    </Suspense>
  )
}
