'use client'
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  AlarmClockCheck,
  BellDot,
  BookOpenText,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Eye,
  FileEdit,
  Maximize2,
  Plus,
  Save,
  Send,
  Sparkles,
  TriangleAlert,
  Trash2,
  X,
} from 'lucide-react'
import CoursePicker from '@/components/course/CoursePicker'
import { getApiUrl } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import { extractCourseSubjectLabel, subjectLabelsMatch } from '@/lib/subject-utils'
import {
  listAccessibleCourses,
  pickAccessibleCourse,
  type AccessibleCourse,
} from '@/lib/course-access'

type CourseExam = {
  id: string
  title: string
  description: string
  exam_date: string
  duration_minutes: number
  total_points: number
  question_count: number
  attempt_count: number
  average_score: number | null
  resolved_after_review_count: number
  source_format?: string | null
  workflow_status?: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
  assignment_type?: 'exam' | 'homework'
  published_at?: string | null
  due_at?: string | null
  submitted_student_count?: number
  pending_student_count?: number
  total_students?: number
  missing_students?: string[]
  textbook_id?: string | null
  textbook_toc_node_id?: string | null
  textbook_title?: string | null
  section_title?: string | null
  material_id?: string | null
  learning_objective?: string | null
  section_page_start?: number | null
  section_page_end?: number | null
}

type CourseScheduleStatus = {
  activated_now: number
  overdue_created_now: number
  cleared_now: number
  pending_notifications: number
  assigned_notifications: number
  overdue_notifications: number
  total_exams: number
  draft_exams: number
  reviewed_exams: number
  scheduled_exams: number
  published_exams: number
  overdue_exams: number
  active_exams: number
  upcoming_schedule: Array<{
    id: string
    title: string
    workflow_status: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
    assignment_type: 'exam' | 'homework'
    published_at?: string | null
    due_at?: string | null
  }>
  overdue_queue: Array<{
    id: string
    title: string
    workflow_status: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
    assignment_type: 'exam' | 'homework'
    published_at?: string | null
    due_at?: string | null
  }>
  last_reconciled_at: string
}

type TextbookDraftDetail = {
  draft: {
    id: string
    draft_slug?: string
    title: string
    description: string
    textbook_slug: string
    textbook_title: string
    book_title: string
    section_title: string
    question_count: number
    source_pages: number[]
    page_start?: number | null
    page_end?: number | null
    has_local_pdf?: boolean
    material_id?: string | null
    generated_markdown: string
    local_pdf_path?: string | null
  }
  questions: Array<{
    id: string
    question_order: number
    concept_tag: string
    prompt: string
    choices: Array<{ label: string; text: string }>
    correct_choice: string
    explanation?: string | null
    source_pages: number[]
    evidence_excerpt?: string | null
    source_chunk_previews?: Array<{
      id: string
      page_number?: number | null
      page_label?: string | null
      content: string
    }>
    page_asset_urls: string[]
  }>
}

type SavedExamDetail = {
  exam: {
    id: string
    course_id: string
    title: string
    description?: string | null
    exam_date?: string | null
    duration_minutes?: number | null
    total_points?: number | null
    workflow_status?: 'draft' | 'reviewed' | 'scheduled' | 'published' | 'archived'
    assignment_type?: 'exam' | 'homework'
    published_at?: string | null
    due_at?: string | null
    assignment_note?: string | null
    source_name?: string | null
    source_format?: string | null
    textbook_id?: string | null
    textbook_toc_node_id?: string | null
    textbook_slug?: string | null
    textbook_title?: string | null
    section_title?: string | null
    material_id?: string | null
    learning_objective?: string | null
    section_page_start?: number | null
    section_page_end?: number | null
  }
  questions: Array<{
    id: string
    question_order: number
    concept_tag: string
    prompt: string
    choices: Array<{ label: string; text: string }>
    correct_choice?: string | null
    explanation?: string | null
    difficulty?: string | null
    points?: number | null
    source_pages: number[]
    evidence_excerpt?: string | null
    source_chunk_previews?: Array<{
      id: string
      page_number?: number | null
      page_label?: string | null
      content: string
    }>
    source_textbook_slug?: string | null
    source_section_title?: string | null
    page_asset_urls?: string[]
  }>
}

type PreviewQuestion = {
  id: string
  order: number
  prompt: string
  concept?: string
  points?: number
  difficulty?: string
  answer?: string
  explanation?: string
  choices: Array<{ label: string; text: string }>
}

type PreviewExam = {
  title: string
  description?: string
  learningObjective?: string
  durationMinutes?: number
  totalPoints?: number
  examDate?: string
  sourceLabel: string
  subtitle?: string
  questions: PreviewQuestion[]
}

type EditableQuestion = {
  id: string
  order: number
  concept: string
  prompt: string
  points: number
  answer: string
  explanation: string
  choices: Array<{ label: string; text: string }>
  sourcePages: number[]
  evidenceExcerpt: string
}

type EditableExam = {
  title: string
  description: string
  learningObjective: string
  durationMinutes: number
  totalPoints: number
  examDate: string
  questions: EditableQuestion[]
}

type WorkspaceMode = 'reader' | 'editor' | 'student-paper'
type WorkspaceOrigin = { kind: 'saved-exam'; examId: string }
type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type WorkspaceSource = {
  selectionId: string
  kind: 'saved-exam'
  id: string
  subjectLabel: string
  textbookKey: string
  textbookLabel: string
  sectionTitle: string
  title: string
  questionCount: number
  pageStart?: number | null
  pageEnd?: number | null
  sourceLabel: string
  workflowStatus?: CourseExam['workflow_status']
  learningObjective?: string | null
}

const EXAM_TEMPLATE = `TITLE: 중1 일차함수 빠른 점검
DESCRIPTION: 기울기와 y절편을 4문항으로 확인하는 형성평가입니다.
DATE: 2026-05-02
DURATION: 20
TOTAL_POINTS: 40

---
CONCEPT: 중학 수학 · 일차함수와 그래프
DIFFICULTY: medium
POINTS: 10
QUESTION: y = 2x + 1에서 기울기는 무엇인가요?
A. -1
B. 0
C. 1
D. 2
ANSWER: D
EXPLANATION: y = ax + b 꼴에서 a가 기울기입니다.
`

const QUESTIONS_PER_PAGE = 6

const SOURCE_LABELS: Record<string, string> = {
  markdown_upload: '업로드 시험',
  preset: '기본 예시',
  simulation: '시뮬레이션',
  textbook_generated: '교재 생성',
  material_generated: '자료 생성',
  manual: '수동 등록',
}

const WORKFLOW_LABELS: Record<string, string> = {
  draft: '검수 전',
  reviewed: '검수 완료',
  scheduled: '예약됨',
  published: '배포 중',
  archived: '보관됨',
}

function nextWeekDate() {
  const next = new Date()
  next.setDate(next.getDate() + 7)
  return next.toISOString().slice(0, 10)
}

function nextHourDateTime() {
  const next = new Date()
  next.setMinutes(0, 0, 0)
  next.setHours(next.getHours() + 1)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  const hours = String(next.getHours()).padStart(2, '0')
  const minutes = String(next.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDate(value?: string | null) {
  if (!value) return '미정'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(value))
}

function formatDateTime(value?: string | null) {
  if (!value) return '미정'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function buildSelectionId(kind: WorkspaceOrigin['kind'], id: string) {
  return `${kind}:${id}`
}

function makeLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function fetchCourseExams(courseId: string): Promise<CourseExam[]> {
  const response = await fetch(getApiUrl(`/api/exams/course/${courseId}`), {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('시험 목록을 불러오지 못했습니다.')
  }
  const data = await response.json()
  return Array.isArray(data)
    ? data.filter(
        exam =>
          exam &&
          typeof exam === 'object' &&
          (exam as CourseExam).source_format !== 'textbook_generated',
      )
    : []
}

async function fetchCourseScheduleStatus(courseId: string): Promise<CourseScheduleStatus> {
  const response = await fetch(getApiUrl(`/api/exams/course/${courseId}/schedule-status`), {
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error('예약 공지 상태를 불러오지 못했습니다.')
  }
  return response.json()
}

async function fetchTeacherExamDetail(examId: string): Promise<SavedExamDetail> {
  const response = await fetch(
    getApiUrl(`/api/exams/${encodeURIComponent(examId)}?teacher_view=true`),
    { cache: 'no-store' },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '시험 상세를 불러오지 못했습니다.')
  }
  return response.json()
}

async function updateEditorExam(options: {
  examId: string
  teacherId: string
  payload: Record<string, unknown>
}) {
  const response = await fetch(
    getApiUrl(`/api/exams/${encodeURIComponent(options.examId)}/editor`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: options.teacherId,
        ...options.payload,
      }),
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '시험 수정 저장에 실패했습니다.')
  }
  return response.json()
}

async function patchEditorExam(options: {
  examId: string
  teacherId: string
  payload: Record<string, unknown>
}) {
  const response = await fetch(
    getApiUrl(`/api/exams/${encodeURIComponent(options.examId)}/editor`),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teacher_id: options.teacherId,
        ...options.payload,
      }),
    },
  )
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '시험 자동 저장에 실패했습니다.')
  }
  return response.json()
}

async function importPresetExams(courseId: string, teacherId: string, presetIds?: string[]) {
  const response = await fetch(getApiUrl(`/api/exams/course/${courseId}/presets/import`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacher_id: teacherId, preset_ids: presetIds }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '예시 시험 불러오기에 실패했습니다.')
  }
  return response.json()
}

async function publishExam(
  examId: string,
  options: {
    publishAt: string
    dueAt: string
    assignmentType: 'exam' | 'homework'
  },
) {
  const response = await fetch(getApiUrl(`/api/exams/${examId}/publish`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publish_at: options.publishAt,
      due_at: options.dueAt,
      assignment_type: options.assignmentType,
    }),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '시험 배포에 실패했습니다.')
  }
  return response.json()
}

function parseExamMarkdown(content: string): PreviewExam {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return {
      title: '시험지',
      sourceLabel: '직접 작성',
      questions: [],
    }
  }

  const sections = normalized.split(/\n---+\n/g)
  const headerLines = sections[0]?.split('\n') ?? []
  const metadata = new Map<string, string>()
  for (const line of headerLines) {
    const match = line.match(/^([A-Z_]+):\s*(.+)$/)
    if (match) {
      metadata.set(match[1], match[2].trim())
    }
  }

  const questions = sections
    .slice(1)
    .map((section, index) => {
      const lines = section.split('\n')
      const sectionMeta = new Map<string, string>()
      const choices: Array<{ label: string; text: string }> = []

      for (const line of lines) {
        const choiceMatch = line.match(/^([A-Z])\.\s*(.+)$/)
        if (choiceMatch) {
          choices.push({ label: choiceMatch[1], text: choiceMatch[2] })
          continue
        }

        const kvMatch = line.match(/^([A-Z_]+):\s*(.+)$/)
        if (kvMatch) {
          sectionMeta.set(kvMatch[1], kvMatch[2].trim())
        }
      }

      return {
        id: `parsed-${index + 1}`,
        order: index + 1,
        prompt: sectionMeta.get('QUESTION') ?? '문항 내용 없음',
        concept: sectionMeta.get('CONCEPT') ?? undefined,
        points: Number(sectionMeta.get('POINTS') ?? '10') || 10,
        difficulty: sectionMeta.get('DIFFICULTY') ?? undefined,
        answer: sectionMeta.get('ANSWER') ?? undefined,
        explanation: sectionMeta.get('EXPLANATION') ?? undefined,
        choices,
      } satisfies PreviewQuestion
    })
    .filter(question => question.prompt !== '문항 내용 없음' || question.choices.length > 0)

  return {
    title: metadata.get('TITLE') ?? '시험지',
    description: metadata.get('DESCRIPTION') ?? undefined,
    examDate: metadata.get('DATE') ?? undefined,
    durationMinutes: Number(metadata.get('DURATION') ?? '0') || undefined,
    totalPoints:
      Number(metadata.get('TOTAL_POINTS') ?? '0') || questions.reduce((sum, item) => sum + (item.points ?? 0), 0),
    sourceLabel: '직접 작성',
    questions,
  }
}

function editableExamToPreview(exam: EditableExam, sourceLabel: string, subtitle?: string): PreviewExam {
  return {
    title: exam.title,
    description: exam.description,
    learningObjective: exam.learningObjective,
    examDate: exam.examDate,
    durationMinutes: exam.durationMinutes,
    totalPoints: exam.questions.reduce((sum, item) => sum + item.points, 0),
    sourceLabel,
    subtitle,
    questions: exam.questions.map(question => ({
      id: question.id,
      order: question.order,
      prompt: question.prompt,
      concept: question.concept,
      points: question.points,
      answer: question.answer,
      explanation: question.explanation,
      choices: question.choices,
    })),
  }
}

function buildReaderPages(detail: TextbookDraftDetail | null): number[] {
  if (!detail) return []
  if (detail.draft.page_start && detail.draft.page_end) {
    return Array.from(
      { length: detail.draft.page_end - detail.draft.page_start + 1 },
      (_, index) => detail.draft.page_start! + index,
    )
  }
  return Array.from(new Set(detail.draft.source_pages)).sort((a, b) => a - b)
}

function buildWorkspaceSubtitle(detail: TextbookDraftDetail | null) {
  if (!detail) return ''
  return Array.from(
    new Set([detail.draft.textbook_title, detail.draft.book_title, detail.draft.section_title].filter(Boolean)),
  ).join(' · ')
}

function cloneEditableExam(exam: EditableExam): EditableExam {
  return {
    ...exam,
    questions: exam.questions.map(question => ({
      ...question,
      choices: question.choices.map(choice => ({ ...choice })),
      sourcePages: [...question.sourcePages],
    })),
  }
}

function buildEditableExamPayloadFrom(
  editableExam: EditableExam,
  context: {
    savedExam?: SavedExamDetail['exam'] | null
    draftDetail?: TextbookDraftDetail | null
  },
) {
  const examSource = context.savedExam
  const draftSource = context.draftDetail?.draft
  return {
    title: editableExam.title,
    description: editableExam.description,
    learning_objective: editableExam.learningObjective || null,
    exam_date: editableExam.examDate || new Date().toISOString().slice(0, 10),
    duration_minutes: editableExam.durationMinutes,
    workflow_status: examSource?.workflow_status ?? 'draft',
    assignment_type: examSource?.assignment_type ?? 'homework',
    due_at: examSource?.due_at ?? null,
    assignment_note: examSource?.assignment_note ?? null,
    source_name: examSource?.source_name ?? draftSource?.draft_slug ?? draftSource?.id ?? null,
    source_format: examSource?.source_format ?? 'material_generated',
    textbook_slug: examSource?.textbook_slug ?? draftSource?.textbook_slug ?? null,
    textbook_title: examSource?.textbook_title ?? draftSource?.textbook_title ?? null,
    section_title: examSource?.section_title ?? draftSource?.section_title ?? null,
    material_id: examSource?.material_id ?? null,
    section_page_start: examSource?.section_page_start ?? draftSource?.page_start ?? null,
    section_page_end: examSource?.section_page_end ?? draftSource?.page_end ?? null,
    questions: editableExam.questions.map(question => ({
      id: question.id,
      concept: question.concept,
      prompt: question.prompt,
      choices: question.choices,
      answer: question.answer,
      explanation: question.explanation,
      difficulty: 'medium',
      points: question.points,
      source_pages: question.sourcePages,
      evidence_excerpt: question.evidenceExcerpt,
      source_textbook_slug: examSource?.textbook_slug ?? draftSource?.textbook_slug ?? null,
      source_section_title: examSource?.section_title ?? draftSource?.section_title ?? null,
    })),
  }
}

function buildDraftDetailFromEditableExam(
  baseDetail: TextbookDraftDetail | null,
  editableExam: EditableExam,
  savedExam?: SavedExamDetail['exam'] | null,
): TextbookDraftDetail | null {
  if (!baseDetail) return null

  const pageAssetUrlsByQuestionId = new Map(
    baseDetail.questions.map(question => [question.id, question.page_asset_urls ?? []]),
  )
  const sourceChunkPreviewsByQuestionId = new Map(
    baseDetail.questions.map(question => [question.id, question.source_chunk_previews ?? []]),
  )
  const sourcePages = Array.from(
    new Set(editableExam.questions.flatMap(question => question.sourcePages).filter(page => page > 0)),
  ).sort((a, b) => a - b)

  return {
    draft: {
      ...baseDetail.draft,
      title: editableExam.title,
      description: editableExam.description,
      question_count: editableExam.questions.length,
      source_pages: sourcePages,
      page_start: savedExam?.section_page_start ?? sourcePages[0] ?? null,
      page_end: savedExam?.section_page_end ?? sourcePages[sourcePages.length - 1] ?? null,
    },
    questions: editableExam.questions.map(question => ({
      id: question.id,
      question_order: question.order,
      concept_tag: question.concept,
      prompt: question.prompt,
      choices: question.choices.map(choice => ({ ...choice })),
      correct_choice: question.answer,
      explanation: question.explanation || null,
      source_pages: [...question.sourcePages],
      evidence_excerpt: question.evidenceExcerpt || null,
      source_chunk_previews: sourceChunkPreviewsByQuestionId.get(question.id) ?? [],
      page_asset_urls: pageAssetUrlsByQuestionId.get(question.id) ?? [],
    })),
  }
}

function getAutosaveBlockingReason(editableExam: EditableExam): string | null {
  if (!editableExam.title.trim()) {
    return '시험 제목을 입력하면 자동 저장됩니다.'
  }

  if (editableExam.questions.length === 0) {
    return '문항이 1개 이상 있어야 자동 저장됩니다.'
  }

  for (const question of editableExam.questions) {
    if (!question.prompt.trim()) {
      return `${question.order}번 문항 내용을 입력하면 자동 저장됩니다.`
    }

    if (question.choices.length < 2) {
      return `${question.order}번 문항 선택지가 2개 이상일 때 자동 저장됩니다.`
    }

    for (const choice of question.choices) {
      if (!choice.label.trim() || !choice.text.trim()) {
        return `${question.order}번 문항 선택지를 모두 입력하면 자동 저장됩니다.`
      }
    }

    if (!question.choices.some(choice => choice.label === question.answer)) {
      return `${question.order}번 문항 정답을 다시 확인하면 자동 저장됩니다.`
    }
  }

  return null
}

function formatAutosaveTimestamp(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function getAutosaveTone(status: AutosaveStatus) {
  if (status === 'saving') {
    return {
      panel: 'border-blue-200 bg-blue-50 text-blue-800',
      badge: 'bg-blue-100 text-blue-700',
      label: '자동 저장 중',
    }
  }
  if (status === 'saved') {
    return {
      panel: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      badge: 'bg-emerald-100 text-emerald-700',
      label: '자동 저장됨',
    }
  }
  if (status === 'error') {
    return {
      panel: 'border-rose-200 bg-rose-50 text-rose-800',
      badge: 'bg-rose-100 text-rose-700',
      label: '저장 실패',
    }
  }
  if (status === 'dirty') {
    return {
      panel: 'border-amber-200 bg-amber-50 text-amber-800',
      badge: 'bg-amber-100 text-amber-700',
      label: '저장 대기',
    }
  }
  return {
    panel: 'border-slate-200 bg-slate-50 text-slate-700',
    badge: 'bg-white text-slate-600',
    label: '자동 저장',
  }
}

function makeEditableExamFromSavedExam(detail: SavedExamDetail): EditableExam {
  return {
    title: detail.exam.title,
    description: detail.exam.description ?? '',
    learningObjective: detail.exam.learning_objective ?? '',
    durationMinutes: detail.exam.duration_minutes ?? Math.max(20, detail.questions.length * 3),
    totalPoints:
      detail.exam.total_points ?? detail.questions.reduce((sum, question) => sum + (question.points ?? 10), 0),
    examDate: (detail.exam.exam_date ?? new Date().toISOString()).slice(0, 10),
    questions: detail.questions.map(question => ({
      id: question.id,
      order: question.question_order,
      concept: question.concept_tag,
      prompt: question.prompt,
      points: question.points ?? 10,
      answer: question.correct_choice ?? 'A',
      explanation: question.explanation ?? '',
      choices: question.choices,
      sourcePages: question.source_pages ?? [],
      evidenceExcerpt: question.evidence_excerpt ?? '',
    })),
  }
}

function makeDraftDetailFromSavedExam(detail: SavedExamDetail): TextbookDraftDetail {
  const allSourcePages = Array.from(
    new Set(detail.questions.flatMap(question => question.source_pages ?? []).filter(page => typeof page === 'number')),
  ).sort((a, b) => a - b)

  return {
    draft: {
      id: detail.exam.id,
      draft_slug: detail.exam.source_name ?? detail.exam.id,
      title: detail.exam.title,
      description: detail.exam.description ?? '',
      textbook_slug: detail.exam.textbook_slug === 'None' ? '' : (detail.exam.textbook_slug ?? ''),
      textbook_title: detail.exam.textbook_title ?? '업로드 자료',
      book_title: detail.exam.textbook_title ?? detail.exam.title,
      section_title: detail.exam.section_title ?? '자료 범위',
      question_count: detail.questions.length,
      source_pages: allSourcePages,
      page_start: detail.exam.section_page_start ?? allSourcePages[0] ?? null,
      page_end: detail.exam.section_page_end ?? allSourcePages[allSourcePages.length - 1] ?? null,
      has_local_pdf: Boolean(detail.exam.textbook_slug),
      material_id: detail.exam.material_id ?? null,
      generated_markdown: '',
      local_pdf_path: null,
    },
    questions: detail.questions.map(question => ({
      id: question.id,
      question_order: question.question_order,
      concept_tag: question.concept_tag,
      prompt: question.prompt,
      choices: question.choices,
      correct_choice: question.correct_choice ?? 'A',
      explanation: question.explanation ?? null,
      source_pages: question.source_pages ?? [],
      evidence_excerpt: question.evidence_excerpt ?? null,
      source_chunk_previews: question.source_chunk_previews ?? [],
      page_asset_urls: question.page_asset_urls ?? [],
    })),
  }
}

function SourceBadge({ source }: { source?: string | null }) {
  const label = SOURCE_LABELS[source ?? 'manual'] ?? '기타'
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {label}
    </span>
  )
}

function WorkflowBadge({ status }: { status?: CourseExam['workflow_status'] }) {
  const label = WORKFLOW_LABELS[status ?? 'published'] ?? '진행 중'
  const tone =
    status === 'published'
      ? 'bg-emerald-50 text-emerald-700'
      : status === 'scheduled'
        ? 'bg-cyan-50 text-cyan-700'
      : status === 'reviewed'
        ? 'bg-blue-50 text-blue-700'
        : status === 'archived'
          ? 'bg-slate-100 text-slate-500'
          : 'bg-amber-50 text-amber-700'

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
}

function SelectionSection({
  title,
  subtitle,
  options,
  selectedValue,
  onSelect,
}: {
  title: string
  subtitle: string
  options: Array<{ value: string; label: string; meta?: string }>
  selectedValue: string | null
  onSelect: (value: string) => void
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      <div className="mt-4 space-y-3">
        {options.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            앞 단계 선택 후 목록이 나타납니다.
          </div>
        )}
        {options.map(option => {
          const isSelected = selectedValue === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              className={`flex w-full items-start gap-3 rounded-[22px] border px-4 py-4 text-left transition ${
                isSelected
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 hover:border-slate-300'
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  isSelected ? 'border-white bg-white text-slate-900' : 'border-slate-300 bg-white text-transparent'
                }`}
              >
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                  {option.label}
                </span>
                {option.meta && (
                  <span className={`mt-1 block text-sm ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {option.meta}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function FullscreenOverlay({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 text-white">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-slate-300">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/15"
          >
            <X className="h-4 w-4" />
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">{children}</div>
      </div>
    </div>
  )
}

function WorkspaceSelector({
  value,
  onChange,
}: {
  value: WorkspaceMode
  onChange: (value: WorkspaceMode) => void
}) {
  const items: Array<{ value: WorkspaceMode; title: string; description: string; icon: ReactNode }> = [
    {
      value: 'reader',
      title: '자료 보기',
      description: '업로드한 PDF에서 만든 페이지 미리보기를 1장씩 확인합니다.',
      icon: <BookOpenText className="h-5 w-5" />,
    },
    {
      value: 'editor',
      title: '시험 편집',
      description: 'AI가 만든 문제를 수정, 삭제, 추가합니다.',
      icon: <FileEdit className="h-5 w-5" />,
    },
    {
      value: 'student-paper',
      title: '학생용 시험지 보기',
      description: '6문항씩 페이지를 넘기며 학생 화면처럼 봅니다.',
      icon: <Eye className="h-5 w-5" />,
    },
  ]

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {items.map(item => {
        const isActive = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-[24px] border px-4 py-4 text-left transition ${
              isActive
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className={`rounded-2xl p-3 ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-700'}`}>
                {item.icon}
              </div>
              <div>
                <p className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>{item.title}</p>
                <p className={`mt-1 text-sm ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>{item.description}</p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function StudentPaperPreview({
  preview,
  currentPage,
  totalPages,
  onPageChange,
  answers,
  onSelectAnswer,
  showAnswerKey,
  onToggleAnswerKey,
}: {
  preview: PreviewExam
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  answers: Record<string, string>
  onSelectAnswer: (questionId: string, choiceLabel: string) => void
  showAnswerKey: boolean
  onToggleAnswerKey: () => void
}) {
  const startIndex = currentPage * QUESTIONS_PER_PAGE
  const questions = preview.questions.slice(startIndex, startIndex + QUESTIONS_PER_PAGE)

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-lg font-semibold text-slate-950">{preview.title}</p>
          <p className="mt-1 text-sm text-slate-500">
            페이지 {currentPage + 1}/{totalPages} · 문항 {preview.questions.length}개 · 제한 시간 {preview.durationMinutes ?? 30}분
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onToggleAnswerKey}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              showAnswerKey ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
            }`}
          >
            {showAnswerKey ? '교사용 정답 표시 중' : '교사용 정답 보기'}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage >= totalPages - 1}
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-[36px] bg-[#ece3d5] p-4 shadow-inner">
        <div className="mx-auto rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <span className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-slate-600">
              형성평가
            </span>
            <span className="text-[11px] font-medium text-slate-400">{preview.sourceLabel}</span>
          </div>

          <div className="mt-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">SocraTeach Assessment</p>
            <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{preview.title}</h3>
            {preview.subtitle && <p className="mt-2 text-sm text-slate-500">{preview.subtitle}</p>}
            {preview.description && <p className="mt-3 text-sm leading-7 text-slate-600">{preview.description}</p>}
            {preview.learningObjective && (
              <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-left text-sm leading-7 text-blue-900">
                교육 목적: {preview.learningObjective}
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
            <div>시험일: {preview.examDate ? formatDate(preview.examDate) : '배포 시 설정'}</div>
            <div>제한 시간: {preview.durationMinutes ? `${preview.durationMinutes}분` : '미정'}</div>
            <div>총점: {preview.totalPoints ? `${preview.totalPoints}점` : '미정'}</div>
            <div>이름: ___________________</div>
          </div>

          <div className="mt-6 space-y-4">
            {questions.map(question => {
              const selectedChoice = answers[question.id]
              return (
                <article key={question.id} className="border-b border-slate-100 pb-5 last:border-b-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-sm font-bold text-slate-700">
                      {question.order}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">
                          {question.points ?? 10}점
                        </span>
                        {question.concept && (
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                            {question.concept}
                          </span>
                        )}
                      </div>

                      <p className="mt-2 text-[15px] font-semibold leading-7 text-slate-900">{question.prompt}</p>

                      <div className="mt-3 grid gap-2">
                        {question.choices.map(choice => {
                          const isSelected = selectedChoice === choice.label
                          const isCorrect = question.answer === choice.label
                          const tone = showAnswerKey && isCorrect
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : isSelected
                              ? 'border-blue-300 bg-blue-50 text-blue-900'
                              : 'border-slate-200 bg-white text-slate-700'

                          return (
                            <button
                              key={`${question.id}-${choice.label}`}
                              type="button"
                              onClick={() => onSelectAnswer(question.id, choice.label)}
                              className={`grid grid-cols-[28px_1fr] gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${tone}`}
                            >
                              <span className="font-semibold">{choice.label}.</span>
                              <span>{choice.text}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>

          <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            <span>
              현재 페이지 {questions.length}문항
              {currentPage < totalPages - 1 ? ` · 다음 페이지에 ${Math.min(QUESTIONS_PER_PAGE, preview.questions.length - (startIndex + QUESTIONS_PER_PAGE))}문항` : ''}
            </span>
            <span>{currentPage + 1}/{totalPages} 페이지</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TeacherExamsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <TeacherExamsContent />
    </Suspense>
  )
}

function TeacherExamsContent() {
  const searchParams = useSearchParams()
  const requestedCourseId = searchParams.get('course')
  const requestedExamId = searchParams.get('exam')
  const requestedOpenMode = searchParams.get('open')
  const [teacherId, setTeacherId] = useState('')
  const [courses, setCourses] = useState<AccessibleCourse[]>([])
  const [course, setCourse] = useState<AccessibleCourse | null>(null)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [selectedTextbookSlug, setSelectedTextbookSlug] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState<string | null>(null)
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const [selectedDraftDetail, setSelectedDraftDetail] = useState<TextbookDraftDetail | null>(null)
  const [workspaceOrigin, setWorkspaceOrigin] = useState<WorkspaceOrigin | null>(null)
  const [savedExamDetail, setSavedExamDetail] = useState<SavedExamDetail | null>(null)
  const [editableExam, setEditableExam] = useState<EditableExam | null>(null)
  const [editableExamBaseline, setEditableExamBaseline] = useState<EditableExam | null>(null)
  const [selectedEditorQuestionId, setSelectedEditorQuestionId] = useState<string | null>(null)
  const [readerPageNumber, setReaderPageNumber] = useState<number | null>(null)
  const [materialPageText, setMaterialPageText] = useState<{ page_number: number; page_label?: string; text_content: string } | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('reader')
  const [studentPreviewPage, setStudentPreviewPage] = useState(0)
  const [studentPreviewAnswers, setStudentPreviewAnswers] = useState<Record<string, string>>({})
  const [showAnswerKey, setShowAnswerKey] = useState(false)
  const [exams, setExams] = useState<CourseExam[]>([])
  const [scheduleStatus, setScheduleStatus] = useState<CourseScheduleStatus | null>(null)
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [publishLoadingId, setPublishLoadingId] = useState<string | null>(null)
  const [presetLoadingId, setPresetLoadingId] = useState<string | null>(null)
  const [loadingEditorExamId, setLoadingEditorExamId] = useState<string | null>(null)
  const [autoOpenedRequestedExamId, setAutoOpenedRequestedExamId] = useState<string | null>(null)
  const [savingEditedExam, setSavingEditedExam] = useState(false)
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle')
  const [autosaveMessage, setAutosaveMessage] = useState('')
  const [publishStartAt, setPublishStartAt] = useState(nextHourDateTime())
  const [publishDueDate, setPublishDueDate] = useState(nextWeekDate())
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [supabase] = useState(() => createClient())
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveVersionRef = useRef(0)
  const lastSavedSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!isMounted) return

        setTeacherId(user?.id ?? '')

        const nextCourses = await listAccessibleCourses(supabase)
        if (!isMounted) return

        setCourses(nextCourses)

        const nextCourse = pickAccessibleCourse(nextCourses, requestedCourseId)
        setCourse(nextCourse)
        if (!nextCourse) {
          setExams([])
          setScheduleStatus(null)
          return
        }

        const [nextExams, nextScheduleStatus] = await Promise.all([
          fetchCourseExams(nextCourse.id),
          fetchCourseScheduleStatus(nextCourse.id),
        ])
        if (!isMounted) return
        setExams(nextExams)
        setScheduleStatus(nextScheduleStatus)
        setSelectedExamId(nextExams.find(exam => exam.id === requestedExamId)?.id ?? nextExams[0]?.id ?? null)
      } catch (loadError) {
        if (!isMounted) return
        setError(loadError instanceof Error ? loadError.message : '시험지 제작실을 불러오지 못했습니다.')
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
  }, [requestedCourseId, requestedExamId, supabase])

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [])

  const workspaceSources = useMemo<WorkspaceSource[]>(() => {
    const courseSubjectLabel = extractCourseSubjectLabel(course)
    const materialSources: WorkspaceSource[] = exams
      .filter(exam => exam.source_format === 'material_generated')
      .map(exam => ({
        selectionId: buildSelectionId('saved-exam', exam.id),
        kind: 'saved-exam',
        id: exam.id,
        subjectLabel: courseSubjectLabel ?? '업로드 자료',
        textbookKey: exam.material_id ?? exam.textbook_title ?? exam.id,
        textbookLabel: exam.textbook_title ?? '업로드 자료',
        sectionTitle: exam.section_title ?? '자료 범위',
        title: exam.title,
        questionCount: exam.question_count,
        pageStart: exam.section_page_start ?? null,
        pageEnd: exam.section_page_end ?? null,
        sourceLabel: SOURCE_LABELS.material_generated,
        workflowStatus: exam.workflow_status,
        learningObjective: exam.learning_objective,
      }))

    return materialSources
  }, [course, exams])

  const currentCourseSubjectLabel = useMemo(() => extractCourseSubjectLabel(course), [course])

  const filteredWorkspaceSources = useMemo(
    () =>
      workspaceSources.filter(source =>
        subjectLabelsMatch(currentCourseSubjectLabel, source.subjectLabel),
      ),
    [currentCourseSubjectLabel, workspaceSources],
  )

  const subjectOptions = useMemo(
    () =>
      Array.from(new Map(filteredWorkspaceSources.map(source => [source.subjectLabel, source])).values()).map(source => {
        const count = filteredWorkspaceSources.filter(item => item.subjectLabel === source.subjectLabel).length
        return {
          value: source.subjectLabel,
          label: source.subjectLabel,
          meta: `${count}개 초안`,
        }
      }),
    [filteredWorkspaceSources],
  )

  const textbookOptions = useMemo(() => {
    if (!selectedSubject) return []
    const filtered = filteredWorkspaceSources.filter(source => source.subjectLabel === selectedSubject)
    return Array.from(new Map(filtered.map(source => [source.textbookKey, source])).values()).map(source => ({
      value: source.textbookKey,
      label: source.textbookLabel,
      meta: `목차 ${filtered.filter(item => item.textbookKey === source.textbookKey).length}개`,
    }))
  }, [filteredWorkspaceSources, selectedSubject])

  const sectionOptions = useMemo(() => {
    if (!selectedSubject || !selectedTextbookSlug) return []
    const filtered = filteredWorkspaceSources.filter(
      source => source.subjectLabel === selectedSubject && source.textbookKey === selectedTextbookSlug,
    )
    return Array.from(new Map(filtered.map(source => [source.sectionTitle, source])).values()).map(source => ({
      value: source.sectionTitle,
      label: source.sectionTitle,
      meta: source.pageStart && source.pageEnd ? `${source.pageStart}-${source.pageEnd}p` : `${source.questionCount}문항`,
    }))
  }, [filteredWorkspaceSources, selectedSubject, selectedTextbookSlug])

  const draftOptions = useMemo(() => {
    if (!selectedSubject || !selectedTextbookSlug || !selectedSection) return []
    const filtered = filteredWorkspaceSources.filter(
      source =>
        source.subjectLabel === selectedSubject &&
        source.textbookKey === selectedTextbookSlug &&
        source.sectionTitle === selectedSection,
    )
    return filtered.map(source => ({
      value: source.selectionId,
      label: source.title,
      meta: [
        `${source.questionCount}문항`,
        source.pageStart && source.pageEnd ? `${source.pageStart}-${source.pageEnd}p` : null,
        source.kind === 'saved-exam' && source.workflowStatus ? WORKFLOW_LABELS[source.workflowStatus] ?? null : source.sourceLabel,
      ]
        .filter(Boolean)
        .join(' · '),
    }))
  }, [filteredWorkspaceSources, selectedSection, selectedSubject, selectedTextbookSlug])

  useEffect(() => {
    if (!selectedSubject && subjectOptions.length === 1) {
      setSelectedSubject(subjectOptions[0]?.value ?? null)
    }
  }, [selectedSubject, subjectOptions])

  useEffect(() => {
    if (selectedSubject && !subjectOptions.some(option => option.value === selectedSubject)) {
      setSelectedSubject(null)
    }
  }, [selectedSubject, subjectOptions])

  useEffect(() => {
    if (selectedTextbookSlug && !textbookOptions.some(option => option.value === selectedTextbookSlug)) {
      setSelectedTextbookSlug(null)
      setSelectedSection(null)
      setSelectedDraftId(null)
    }
  }, [selectedTextbookSlug, textbookOptions])

  useEffect(() => {
    if (selectedSection && !sectionOptions.some(option => option.value === selectedSection)) {
      setSelectedSection(null)
      setSelectedDraftId(null)
    }
  }, [selectedSection, sectionOptions])

  useEffect(() => {
    if (selectedDraftId && !draftOptions.some(option => option.value === selectedDraftId)) {
      setSelectedDraftId(null)
    }
  }, [selectedDraftId, draftOptions])

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const applyEditableWorkspace = useCallback((
    detail: TextbookDraftDetail,
    editable: EditableExam,
    origin: WorkspaceOrigin,
    options?: { open?: boolean; mode?: WorkspaceMode; savedExam?: SavedExamDetail | null },
  ) => {
    const nextSnapshot =
      origin.kind === 'saved-exam'
        ? JSON.stringify(
            buildEditableExamPayloadFrom(editable, {
              savedExam: options?.savedExam?.exam ?? null,
              draftDetail: detail,
            }),
          )
        : null

    autosaveVersionRef.current += 1
    clearAutosaveTimer()
    lastSavedSnapshotRef.current = nextSnapshot
    setAutosaveStatus('idle')
    setAutosaveMessage(
      origin.kind === 'saved-exam'
        ? '저장된 draft를 편집 중입니다. 변경사항은 자동 저장됩니다.'
        : '첫 저장을 하면 이후부터 자동 저장됩니다.',
    )

    const nextEditable = cloneEditableExam(editable)
    setSelectedDraftDetail(detail)
    setEditableExam(nextEditable)
    setEditableExamBaseline(cloneEditableExam(nextEditable))
    setWorkspaceOrigin(origin)
    setSelectedEditorQuestionId(nextEditable.questions[0]?.id ?? null)
    const pages = buildReaderPages(detail)
    setReaderPageNumber(pages[0] ?? null)
    setStudentPreviewAnswers({})
    setStudentPreviewPage(0)
    setShowAnswerKey(false)
    setWorkspaceMode(options?.mode ?? (pages.length > 0 ? 'reader' : 'editor'))
    if (options?.open ?? true) {
      setWorkspaceOpen(true)
    }
  }, [clearAutosaveTimer])

  const refreshExams = async (courseId: string, preferredExamId?: string | null) => {
    const [nextExams, nextScheduleStatus] = await Promise.all([
      fetchCourseExams(courseId),
      fetchCourseScheduleStatus(courseId),
    ])
    setExams(nextExams)
    setScheduleStatus(nextScheduleStatus)
    const nextSelectedExam =
      nextExams.find(exam => exam.id === preferredExamId)?.id ?? nextExams[0]?.id ?? null
    setSelectedExamId(nextSelectedExam)
  }

  const syncSavedExamState = (
    savedExam: SavedExamDetail['exam'],
    currentEditableExam: EditableExam,
    questionCount?: number,
  ) => {
    setSavedExamDetail(current =>
      current
        ? {
            ...current,
            exam: {
              ...current.exam,
              ...savedExam,
            },
          }
        : current,
    )
    setSelectedDraftDetail(current => buildDraftDetailFromEditableExam(current, currentEditableExam, savedExam))
    setExams(current =>
      current.map(exam =>
        exam.id === savedExam.id
          ? {
              ...exam,
              title: savedExam.title,
              description: savedExam.description ?? exam.description,
              exam_date: savedExam.exam_date ?? exam.exam_date,
              duration_minutes: savedExam.duration_minutes ?? exam.duration_minutes,
              total_points: savedExam.total_points ?? currentEditableExam.totalPoints,
              question_count: questionCount ?? currentEditableExam.questions.length,
              workflow_status: savedExam.workflow_status ?? exam.workflow_status,
              assignment_type: savedExam.assignment_type ?? exam.assignment_type,
              due_at: savedExam.due_at ?? exam.due_at,
              textbook_title: savedExam.textbook_title ?? exam.textbook_title,
              section_title: savedExam.section_title ?? exam.section_title,
              material_id: savedExam.material_id ?? exam.material_id,
              learning_objective: savedExam.learning_objective ?? exam.learning_objective,
              section_page_start: savedExam.section_page_start ?? exam.section_page_start,
              section_page_end: savedExam.section_page_end ?? exam.section_page_end,
            }
          : exam,
      ),
    )
  }

  const openSavedExamEditor = async (examId: string, options?: { syncSelection?: boolean }) => {
    setLoadingEditorExamId(examId)
    setError('')
    setFeedback('')

    try {
      const detail = await fetchTeacherExamDetail(examId)
      if (options?.syncSelection) {
        const source = filteredWorkspaceSources.find(item => item.kind === 'saved-exam' && item.id === examId)
        if (source) {
          setSelectedSubject(source.subjectLabel)
          setSelectedTextbookSlug(source.textbookKey)
          setSelectedSection(source.sectionTitle)
          setSelectedDraftId(source.selectionId)
        }
      }
      const draftDetail = makeDraftDetailFromSavedExam(detail)
      const editable = makeEditableExamFromSavedExam(detail)
      setSavedExamDetail(detail)
      applyEditableWorkspace(
        draftDetail,
        editable,
        { kind: 'saved-exam', examId },
        { savedExam: detail },
      )
      return true
    } catch (editorError) {
      setError(editorError instanceof Error ? editorError.message : '저장된 시험을 불러오지 못했습니다.')
      return false
    } finally {
      setLoadingEditorExamId(current => (current === examId ? null : current))
    }
  }

  useEffect(() => {
    if (!requestedExamId || !exams.some(exam => exam.id === requestedExamId)) return
    setSelectedExamId(requestedExamId)
  }, [exams, requestedExamId])

  useEffect(() => {
    if (!requestedExamId || requestedOpenMode !== 'editor') return
    if (autoOpenedRequestedExamId === requestedExamId) return
    if (!exams.some(exam => exam.id === requestedExamId)) return

    setAutoOpenedRequestedExamId(requestedExamId)
    setLoadingEditorExamId(requestedExamId)
    setError('')
    setFeedback('')

    void (async () => {
      try {
        const source = filteredWorkspaceSources.find(item => item.kind === 'saved-exam' && item.id === requestedExamId)
        if (source) {
          setSelectedSubject(source.subjectLabel)
          setSelectedTextbookSlug(source.textbookKey)
          setSelectedSection(source.sectionTitle)
          setSelectedDraftId(source.selectionId)
        }
        const detail = await fetchTeacherExamDetail(requestedExamId)
        const draftDetail = makeDraftDetailFromSavedExam(detail)
        const editable = makeEditableExamFromSavedExam(detail)
        setSavedExamDetail(detail)
        applyEditableWorkspace(
          draftDetail,
          editable,
          { kind: 'saved-exam', examId: requestedExamId },
          { savedExam: detail },
        )
      } catch (editorError) {
        setError(editorError instanceof Error ? editorError.message : '저장된 시험을 불러오지 못했습니다.')
      } finally {
        setLoadingEditorExamId(current => (current === requestedExamId ? null : current))
      }
    })()
  }, [applyEditableWorkspace, autoOpenedRequestedExamId, exams, filteredWorkspaceSources, requestedExamId, requestedOpenMode])

  const selectedWorkspaceSource = filteredWorkspaceSources.find(source => source.selectionId === selectedDraftId) ?? null
  const selectedExam = exams.find(exam => exam.id === selectedExamId) ?? exams[0] ?? null
  const readerPages = useMemo(() => buildReaderPages(selectedDraftDetail), [selectedDraftDetail])
  const workspaceSubtitle = useMemo(() => buildWorkspaceSubtitle(selectedDraftDetail), [selectedDraftDetail])

  useEffect(() => {
    let isMounted = true

    async function loadDraftDetail() {
      if (!selectedWorkspaceSource) {
        setSelectedDraftDetail(null)
        return
      }

      try {
        const detail = await fetchTeacherExamDetail(selectedWorkspaceSource.id)
        if (!isMounted) return

        const draftDetail = makeDraftDetailFromSavedExam(detail)
        const editable = makeEditableExamFromSavedExam(detail)
        setSavedExamDetail(detail)
        applyEditableWorkspace(
          draftDetail,
          editable,
          { kind: 'saved-exam', examId: selectedWorkspaceSource.id },
          { savedExam: detail },
        )
      } catch (draftError) {
        if (!isMounted) return
        setError(draftError instanceof Error ? draftError.message : '자료 기반 시험 초안을 불러오지 못했습니다.')
      }
    }

    void loadDraftDetail()

    return () => {
      isMounted = false
    }
  }, [applyEditableWorkspace, selectedWorkspaceSource])

  useEffect(() => {
    if (!workspaceOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWorkspaceOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [workspaceOpen])
  const currentReaderIndex = readerPageNumber ? Math.max(0, readerPages.indexOf(readerPageNumber)) : 0

  useEffect(() => {
    const materialId = selectedDraftDetail?.draft.material_id
    if (!materialId || selectedDraftDetail?.draft.textbook_slug || !readerPageNumber) {
      setMaterialPageText(null)
      return
    }
    fetch(`/api/materials/${materialId}/pages/${readerPageNumber}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setMaterialPageText(data))
      .catch(() => setMaterialPageText(null))
  }, [readerPageNumber, selectedDraftDetail?.draft.material_id, selectedDraftDetail?.draft.textbook_slug])
  const autosaveTone = getAutosaveTone(autosaveStatus)
  const editablePreview = useMemo(() => {
    if (editableExam && selectedDraftDetail) {
      return editableExamToPreview(
        editableExam,
        selectedWorkspaceSource?.sourceLabel ?? selectedDraftDetail.draft.textbook_title,
        workspaceSubtitle,
      )
    }
    if (editableExam) {
      return editableExamToPreview(editableExam, selectedWorkspaceSource?.sourceLabel ?? '업로드 자료', workspaceSubtitle)
    }
    return parseExamMarkdown(EXAM_TEMPLATE)
  }, [editableExam, selectedDraftDetail, selectedWorkspaceSource?.sourceLabel, workspaceSubtitle])
  const totalStudentPreviewPages = Math.max(1, Math.ceil(editablePreview.questions.length / QUESTIONS_PER_PAGE))
  const publishedExamCount = exams.filter(exam => exam.workflow_status === 'published').length
  const pendingSubmissionCount = exams.reduce((sum, exam) => sum + (exam.pending_student_count ?? 0), 0)
  const activeEditorQuestion =
    editableExam?.questions.find(question => question.id === selectedEditorQuestionId) ?? editableExam?.questions[0] ?? null
  const activeEditorSourceChunkPreviews =
    selectedDraftDetail?.questions.find(question => question.id === activeEditorQuestion?.id)?.source_chunk_previews ?? []

  const buildEditableExamPayload = useCallback(() => {
    if (!editableExam) return null
    return buildEditableExamPayloadFrom(editableExam, {
      savedExam: savedExamDetail?.exam ?? null,
      draftDetail: selectedDraftDetail,
    })
  }, [editableExam, savedExamDetail, selectedDraftDetail])

  useEffect(() => {
    if (!teacherId || !editableExam || !workspaceOrigin) {
      return
    }

    const blockingReason = getAutosaveBlockingReason(editableExam)
    const payload = buildEditableExamPayload()
    if (!payload) return

    const snapshot = JSON.stringify(payload)
    if (lastSavedSnapshotRef.current === snapshot) {
      setAutosaveStatus('saved')
      setAutosaveMessage('저장된 상태와 동일합니다.')
      return
    }

    const version = autosaveVersionRef.current + 1
    autosaveVersionRef.current = version
    clearAutosaveTimer()

    setAutosaveStatus('dirty')
    setAutosaveMessage(blockingReason ?? '변경사항을 곧 자동 저장합니다.')

    if (blockingReason) {
      return
    }

    autosaveTimerRef.current = setTimeout(() => {
      void (async () => {
        setAutosaveStatus('saving')
        setAutosaveMessage('변경사항을 자동 저장하는 중입니다.')

        try {
          const result = await patchEditorExam({
            examId: workspaceOrigin.examId,
            teacherId,
            payload,
          })
          if (autosaveVersionRef.current !== version) {
            return
          }
          lastSavedSnapshotRef.current = snapshot
          setEditableExamBaseline(cloneEditableExam(editableExam))
          if (result.exam) {
            syncSavedExamState(result.exam, editableExam, result.question_count)
          }
          setAutosaveStatus('saved')
          setAutosaveMessage(`자동 저장됨 · ${formatAutosaveTimestamp(new Date())}`)
        } catch (autosaveError) {
          if (autosaveVersionRef.current !== version) {
            return
          }
          setAutosaveStatus('error')
          setAutosaveMessage(autosaveError instanceof Error ? autosaveError.message : '자동 저장에 실패했습니다.')
        }
      })()
    }, 1200)

    return () => clearAutosaveTimer()
  }, [buildEditableExamPayload, clearAutosaveTimer, editableExam, teacherId, workspaceOrigin, savedExamDetail, selectedDraftDetail])

  const handleSaveEditedExam = async () => {
    if (!course || !teacherId || !editableExam || !workspaceOrigin) return
    const payload = buildEditableExamPayload()
    if (!payload) return

    const snapshot = JSON.stringify(payload)
    autosaveVersionRef.current += 1
    clearAutosaveTimer()
    setSavingEditedExam(true)
    setError('')
    setFeedback('')

    try {
      const result = await updateEditorExam({
        examId: workspaceOrigin.examId,
        teacherId,
        payload,
      })
      const savedExamId = result.exam?.id ?? workspaceOrigin.examId
      await refreshExams(course.id, savedExamId)
      if (result.exam) {
        syncSavedExamState(result.exam, editableExam, result.question_count)
      }
      setEditableExamBaseline(cloneEditableExam(editableExam))
      lastSavedSnapshotRef.current = snapshot
      setAutosaveStatus('saved')
      setAutosaveMessage(`수동 저장 완료 · ${formatAutosaveTimestamp(new Date())}`)
      setFeedback(`'${result.exam?.title ?? editableExam.title}' 변경사항을 저장했습니다.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '시험 저장에 실패했습니다.')
      setAutosaveStatus('error')
      setAutosaveMessage(saveError instanceof Error ? saveError.message : '저장에 실패했습니다.')
    } finally {
      setSavingEditedExam(false)
    }
  }

  const handleImportPreset = async (presetId?: string, loadingId = 'all') => {
    if (!course || !teacherId) return
    setPresetLoadingId(loadingId)
    setError('')
    setFeedback('')

    try {
      const result = await importPresetExams(course.id, teacherId, presetId ? [presetId] : undefined)
      await refreshExams(course.id)
      const createdCount = Array.isArray(result.created) ? result.created.length : 0
      setFeedback(`예시 시험 ${createdCount}개를 반 시험 목록으로 가져왔습니다.`)
    } catch (presetError) {
      setError(presetError instanceof Error ? presetError.message : '예시 시험 가져오기에 실패했습니다.')
    } finally {
      setPresetLoadingId(null)
    }
  }

  const handlePublishExam = async (examId: string, assignmentType: 'exam' | 'homework') => {
    if (!course) return
    setPublishLoadingId(examId)
    setError('')
    setFeedback('')
    try {
      const result = await publishExam(examId, {
        publishAt: publishStartAt,
        dueAt: publishDueDate,
        assignmentType,
      })
      await refreshExams(course.id)
      setFeedback(
        result.scheduled
          ? `'${result.exam?.title ?? '시험'}'을 ${formatDateTime(result.exam?.published_at)}에 배포되도록 예약했습니다.`
          : `'${result.exam?.title ?? '시험'}'을 학생에게 배포했습니다. 알림 ${result.notifications_created ?? 0}건을 준비했습니다.`,
      )
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '시험 배포에 실패했습니다.')
    } finally {
      setPublishLoadingId(null)
    }
  }

  const updateEditableExam = (updater: (current: EditableExam) => EditableExam) => {
    setEditableExam(current => {
      if (!current) return current
      const next = updater(current)
      return {
        ...next,
        questions: next.questions.map((question, index) => ({
          ...question,
          order: index + 1,
        })),
        totalPoints: next.questions.reduce((sum, question) => sum + question.points, 0),
      }
    })
  }

  const updateCurrentQuestion = (updater: (question: EditableQuestion) => EditableQuestion) => {
    if (!activeEditorQuestion) return
    updateEditableExam(current => ({
      ...current,
      questions: current.questions.map(question =>
        question.id === activeEditorQuestion.id ? updater(question) : question,
      ),
    }))
  }

  const addQuestion = () => {
    const nextId = makeLocalId('question')
    updateEditableExam(current => {
      const nextQuestion: EditableQuestion = {
        id: nextId,
        order: current.questions.length + 1,
        concept: selectedDraftDetail?.draft.section_title ?? '자료 기반 학습',
        prompt: '',
        points: 10,
        answer: 'A',
        explanation: '',
        choices: [
          { label: 'A', text: '' },
          { label: 'B', text: '' },
          { label: 'C', text: '' },
          { label: 'D', text: '' },
        ],
        sourcePages: selectedDraftDetail?.draft.page_start ? [selectedDraftDetail.draft.page_start] : [],
        evidenceExcerpt: '',
      }
      return {
        ...current,
        questions: [...current.questions, nextQuestion],
      }
    })
    setSelectedEditorQuestionId(nextId)
  }

  useEffect(() => {
    if (!editableExam) return
    if (!editableExam.questions.some(question => question.id === selectedEditorQuestionId)) {
      setSelectedEditorQuestionId(editableExam.questions[0]?.id ?? null)
    }
  }, [editableExam, selectedEditorQuestionId])

  useEffect(() => {
    setStudentPreviewPage(current => Math.min(current, Math.max(0, totalStudentPreviewPages - 1)))
  }, [totalStudentPreviewPages])

  const deleteCurrentQuestion = () => {
    if (!activeEditorQuestion) return
    updateEditableExam(current => ({
      ...current,
      questions: current.questions.filter(question => question.id !== activeEditorQuestion.id),
    }))
  }

  const resetEditableState = () => {
    if (!editableExamBaseline) return
    const resetExam = cloneEditableExam(editableExamBaseline)
    setEditableExam(resetExam)
    setSelectedEditorQuestionId(resetExam.questions[0]?.id ?? null)
    setStudentPreviewAnswers({})
    setStudentPreviewPage(0)
    setShowAnswerKey(false)
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>
  }

  if (!course) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">시험을 제작할 반이 없습니다.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            현재 로그인한 교사 계정에 연결된 반이 없어서 시험지 제작실을 열 수 없습니다.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#fff9ef,#f8fafc_48%,#eef2ff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
              <Sparkles className="h-3.5 w-3.5" />
              Teacher Exam Studio
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">시험지 제작실</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              왼쪽에서 업로드한 PDF 자료 기반 초안을 순서대로 고르면 전용 워크스페이스 팝업이 열립니다. 팝업 안에서 자료 보기, 시험 편집, 학생용 시험지 확인을 각각 분리해서 진행합니다.
            </p>
            <p className="mt-3 text-sm font-medium text-blue-700">현재 반: {course.title}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">검토 가능한 초안</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{workspaceSources.length}</p>
              <p className="mt-1 text-sm text-slate-500">업로드 PDF 기반 생성 문제</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">배포 중 시험</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{publishedExamCount}</p>
              <p className="mt-1 text-sm text-slate-500">학생이 실제 응시 중</p>
            </div>
            <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">미제출 학생 합계</p>
              <p className="mt-3 text-3xl font-black text-red-600">{pendingSubmissionCount}</p>
              <p className="mt-1 text-sm text-slate-500">마감 전 확인 필요</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/teacher/dashboard?course=${course.id}`}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
          >
            반 분석 보기
          </Link>
          <Link
            href={`/teacher/materials?course=${course.id}`}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
          >
            자료실 보기
          </Link>
        </div>
      </section>

      <CoursePicker courses={courses} selectedCourseId={course.id} label="시험을 제작할 반 선택" />

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

      <section className="grid gap-6 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className="space-y-4">
          <SelectionSection
            title="1. 과목 선택"
            subtitle="먼저 업로드한 PDF 자료 기반 초안이 묶여 있는 과목을 고릅니다."
            options={subjectOptions}
            selectedValue={selectedSubject}
            onSelect={value => {
              setSelectedSubject(value)
              setSelectedTextbookSlug(null)
              setSelectedSection(null)
              setSelectedDraftId(null)
            }}
          />
          <SelectionSection
            title="2. PDF 자료 선택"
            subtitle="해당 과목 안에서 업로드된 PDF 자료 파일을 고릅니다."
            options={textbookOptions}
            selectedValue={selectedTextbookSlug}
            onSelect={value => {
              setSelectedTextbookSlug(value)
              setSelectedSection(null)
              setSelectedDraftId(null)
            }}
          />
          <SelectionSection
            title="3. 목차 선택"
            subtitle="시험지를 만들 단원이나 자료 범위를 선택합니다."
            options={sectionOptions}
            selectedValue={selectedSection}
            onSelect={value => {
              setSelectedSection(value)
              setSelectedDraftId(null)
            }}
          />
          <SelectionSection
            title="4. 시험지 선택"
            subtitle="해당 목차나 자료 범위에 연결된 AI 생성 시험지를 선택하면 워크스페이스가 열립니다."
            options={draftOptions}
            selectedValue={selectedDraftId}
            onSelect={value => setSelectedDraftId(value)}
          />
        </div>

        <div className="space-y-6">
          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                  선택 상태
                </div>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">제작 워크스페이스 준비</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">
                  왼쪽 네 단계를 모두 고르면 시험 워크스페이스 팝업이 자동으로 열립니다. 팝업 안에서 기능을 섞지 않고 단계별로 진행할 수 있습니다.
                </p>
              </div>
              {selectedDraftDetail && (
                <button
                  type="button"
                  onClick={() => setWorkspaceOpen(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  <Maximize2 className="h-4 w-4" />
                  워크스페이스 다시 열기
                </button>
              )}
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">현재 선택</p>
                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <p>과목: {selectedSubject ?? '선택 전'}</p>
                  <p>PDF 자료: {textbookOptions.find(option => option.value === selectedTextbookSlug)?.label ?? '선택 전'}</p>
                  <p>목차: {selectedSection ?? '선택 전'}</p>
                  <p>시험지: {selectedDraftDetail?.draft.title ?? selectedWorkspaceSource?.title ?? '선택 전'}</p>
                </div>
              </div>

              <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5">
                {selectedDraftDetail ? (
                  <>
                    <p className="text-sm font-semibold text-slate-900">{selectedDraftDetail.draft.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{selectedDraftDetail.draft.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedWorkspaceSource && (
                        <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                          {selectedWorkspaceSource.sourceLabel}
                        </span>
                      )}
                      <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                        {selectedDraftDetail.draft.textbook_title}
                      </span>
                      <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                        {selectedDraftDetail.draft.section_title}
                      </span>
                      {selectedDraftDetail.draft.page_start && selectedDraftDetail.draft.page_end && (
                        <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                          {selectedDraftDetail.draft.page_start}-{selectedDraftDetail.draft.page_end}p
                        </span>
                      )}
                    </div>
                    {selectedWorkspaceSource?.learningObjective && (
                      <p className="mt-4 text-sm leading-6 text-slate-600">{selectedWorkspaceSource.learningObjective}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm leading-6 text-slate-500">
                    네 단계 선택이 끝나면 해당 시험지의 PDF 범위, 문항 수, 작업 팝업 진입 상태가 여기 표시됩니다.
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <ClipboardCheck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-950">현재 반 시험 현황</h2>
                <p className="mt-1 text-sm text-slate-500">배포한 시험과 교사 검수 초안을 간단하게 확인합니다.</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">공지 시작 시각</label>
                <input
                  type="datetime-local"
                  value={publishStartAt}
                  onChange={event => setPublishStartAt(event.target.value)}
                  className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">기본 마감일</label>
                <input
                  type="date"
                  value={publishDueDate}
                  onChange={event => setPublishDueDate(event.target.value)}
                  className="mt-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-blue-300"
                />
              </div>
              <p className="pb-1 text-xs leading-5 text-slate-500">
                시작 시각이 미래면 `예약됨`, 지금보다 이르면 바로 배포됩니다.
              </p>
              <button
                type="button"
                onClick={() => void handleImportPreset(undefined, 'all')}
                disabled={presetLoadingId !== null}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
              >
                {presetLoadingId === 'all' ? '가져오는 중...' : '예시 시험 전체 가져오기'}
              </button>
            </div>

            {scheduleStatus && (
              <div className="mt-5 rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fbff,#ffffff_55%,#fff7ed)] p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Schedule Ops</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-950">현재 반 공지 운영 상태</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      예약 활성화, 미제출 마감 알림, 완료 후 정리 상태를 같은 기준으로 보여줍니다.
                    </p>
                  </div>
                  <p className="text-xs text-slate-400">최근 동기화 {formatDateTime(scheduleStatus.last_reconciled_at)}</p>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-blue-700">
                      <AlarmClockCheck className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">예약됨</span>
                    </div>
                    <p className="mt-3 text-3xl font-black text-slate-950">{scheduleStatus.scheduled_exams}</p>
                    <p className="mt-2 text-xs text-slate-500">이번 조회에서 자동 시작 {scheduleStatus.activated_now}건</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-emerald-700">
                      <Clock3 className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">진행 중</span>
                    </div>
                    <p className="mt-3 text-3xl font-black text-slate-950">{scheduleStatus.active_exams}</p>
                    <p className="mt-2 text-xs text-slate-500">현재 학생에게 열린 시험 {scheduleStatus.published_exams}건</p>
                  </div>
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-amber-700">
                      <BellDot className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">알림 대기</span>
                    </div>
                    <p className="mt-3 text-3xl font-black text-slate-950">{scheduleStatus.pending_notifications}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      신규 {scheduleStatus.assigned_notifications}건 · 마감 {scheduleStatus.overdue_notifications}건
                    </p>
                  </div>
                  <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-4">
                    <div className="flex items-center gap-2 text-rose-700">
                      <TriangleAlert className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-[0.18em]">마감 지남</span>
                    </div>
                    <p className="mt-3 text-3xl font-black text-slate-950">{scheduleStatus.overdue_exams}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      이번 조회에서 생성 {scheduleStatus.overdue_created_now}건 · 정리 {scheduleStatus.cleared_now}건
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <h4 className="text-sm font-semibold text-slate-900">곧 시작될 예약 시험</h4>
                    <div className="mt-3 space-y-3">
                      {scheduleStatus.upcoming_schedule.length === 0 && (
                        <p className="text-sm text-slate-500">현재 대기 중인 예약 시험이 없습니다.</p>
                      )}
                      {scheduleStatus.upcoming_schedule.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedExamId(item.id)}
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50"
                        >
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.assignment_type === 'exam' ? '시험형' : '숙제형'} · 시작 {formatDateTime(item.published_at)}
                            {item.due_at ? ` · 마감 ${formatDate(item.due_at)}` : ''}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                    <h4 className="text-sm font-semibold text-slate-900">바로 확인할 마감 지난 시험</h4>
                    <div className="mt-3 space-y-3">
                      {scheduleStatus.overdue_queue.length === 0 && (
                        <p className="text-sm text-slate-500">아직 마감이 지난 미제출 시험은 없습니다.</p>
                      )}
                      {scheduleStatus.overdue_queue.map(item => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedExamId(item.id)}
                          className="w-full rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-left transition hover:border-rose-200"
                        >
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {item.assignment_type === 'exam' ? '시험형' : '숙제형'} · 마감 {formatDateTime(item.due_at)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {exams.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                  아직 반 시험 목록이 비어 있습니다.
                </p>
              )}

              {exams.map(exam => (
                <article
                  key={exam.id}
                  className={`rounded-[26px] border px-5 py-5 ${
                    selectedExam?.id === exam.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <button type="button" onClick={() => setSelectedExamId(exam.id)} className="w-full text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge source={exam.source_format} />
                      <WorkflowBadge status={exam.workflow_status} />
                    </div>
                    <p className={`mt-3 text-lg font-semibold ${selectedExam?.id === exam.id ? 'text-white' : 'text-slate-900'}`}>
                      {exam.title}
                    </p>
                    <p className={`mt-2 text-sm ${selectedExam?.id === exam.id ? 'text-slate-200' : 'text-slate-500'}`}>
                      {exam.assignment_type === 'homework' ? '숙제형' : '시험형'} · {exam.question_count}문항 · {exam.total_points}점
                    </p>
                    {exam.learning_objective && (
                      <p className={`mt-2 text-sm leading-6 ${selectedExam?.id === exam.id ? 'text-slate-200' : 'text-slate-500'}`}>
                        {exam.learning_objective}
                      </p>
                    )}
                  </button>

                  {selectedExam?.id === exam.id && (
                    <div className="mt-4 space-y-3">
                      <p className="text-sm text-slate-200">
                        제출 {exam.submitted_student_count ?? exam.attempt_count}/{exam.total_students ?? '-'}명
                        {exam.published_at ? ` · 시작 ${formatDateTime(exam.published_at)}` : ''}
                        {exam.due_at ? ` · 마감 ${formatDate(exam.due_at)}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {exam.attempt_count === 0 && (
                          <button
                            type="button"
                            onClick={() => void openSavedExamEditor(exam.id, { syncSelection: true })}
                            disabled={loadingEditorExamId !== null}
                            className="rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            {loadingEditorExamId === exam.id ? '불러오는 중...' : '시험 수정'}
                          </button>
                        )}
                        {exam.workflow_status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => void handlePublishExam(exam.id, exam.assignment_type ?? 'homework')}
                            disabled={publishLoadingId !== null}
                            className="rounded-full bg-white px-4 py-2 text-xs font-medium text-slate-900 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            {publishLoadingId === exam.id ? '처리 중...' : exam.workflow_status === 'scheduled' ? '예약 수정' : '학생에게 배포'}
                          </button>
                        )}
                      </div>
                      {exam.attempt_count > 0 && (
                        <p className="text-xs text-slate-300">학생 응시가 시작된 시험은 원본 문항 수정이 잠깁니다.</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>

      {workspaceOpen && selectedDraftDetail && editableExam && (
        <FullscreenOverlay
          title={selectedDraftDetail.draft.title}
          subtitle={workspaceSubtitle}
          onClose={() => setWorkspaceOpen(false)}
        >
          <div className="mx-auto max-w-7xl space-y-6">
            <WorkspaceSelector value={workspaceMode} onChange={setWorkspaceMode} />

            {workspaceMode === 'reader' && (
              <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">자료 보기</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      업로드한 PDF에서 만든 페이지 미리보기를 1페이지씩 넘기며 볼 수 있습니다.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {selectedDraftDetail.draft.textbook_slug ? (
                        <a
                          href={getApiUrl(`/api/exams/textbooks/${selectedDraftDetail.draft.textbook_slug}/pdf`)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                        >
                          <BookOpenText className="h-4 w-4" />
                          원본 PDF 열기
                        </a>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
                          페이지 미리보기만 제공됩니다. 원본 PDF 관리는 자료실에서 진행합니다.
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setWorkspaceMode('editor')}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                      >
                        시험 편집으로 이동
                      </button>
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">페이지 이동</p>
                    <div className="mt-4 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setReaderPageNumber(readerPages[Math.max(0, currentReaderIndex - 1)] ?? readerPageNumber)}
                        disabled={currentReaderIndex === 0}
                        className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <p className="text-sm font-medium text-slate-700">
                        {readerPageNumber ?? '-'}p / {readerPages[readerPages.length - 1] ?? '-'}p
                      </p>
                      <button
                        type="button"
                        onClick={() => setReaderPageNumber(readerPages[Math.min(readerPages.length - 1, currentReaderIndex + 1)] ?? readerPageNumber)}
                        disabled={currentReaderIndex >= readerPages.length - 1}
                        className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-blue-300 hover:text-blue-700 disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4 max-h-[380px] space-y-2 overflow-y-auto pr-1">
                      {readerPages.map(page => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setReaderPageNumber(page)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                            readerPageNumber === page
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                          }`}
                        >
                          {page}페이지
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
                  {readerPageNumber && selectedDraftDetail.draft.textbook_slug ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                        {selectedDraftDetail.draft.book_title} · {selectedDraftDetail.draft.section_title} · {readerPageNumber}p
                      </div>
                      <img
                        src={getApiUrl(`/api/exams/textbooks/${selectedDraftDetail.draft.textbook_slug}/pages/${readerPageNumber}`)}
                        alt={`${selectedDraftDetail.draft.book_title} ${readerPageNumber}페이지`}
                        className="w-full rounded-[24px] bg-slate-50 object-contain"
                      />
                    </div>
                  ) : readerPageNumber && selectedDraftDetail.draft.material_id ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                        {selectedDraftDetail.draft.section_title} · {readerPageNumber}p
                      </div>
                      <img
                        src={getApiUrl(`/api/materials/${selectedDraftDetail.draft.material_id}/pages/${readerPageNumber}/image`)}
                        alt={`${selectedDraftDetail.draft.section_title} ${readerPageNumber}페이지`}
                        className="w-full rounded-[24px] bg-slate-50 object-contain"
                        onError={e => {
                          const target = e.currentTarget
                          if (materialPageText) {
                            target.style.display = 'none'
                          }
                        }}
                      />
                      {materialPageText && (
                        <div className="whitespace-pre-wrap rounded-[24px] border border-slate-100 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                          {materialPageText.text_content}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                      확인할 자료 페이지가 없습니다.
                    </div>
                  )}
                </div>
              </section>
            )}

            {workspaceMode === 'editor' && (
              <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-slate-950">문항 목록</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">질문을 선택해서 수정하거나, 새 문항을 추가할 수 있습니다.</p>
                    <button
                      type="button"
                      onClick={addQuestion}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      문항 추가
                    </button>
                  </div>

                  <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
                    {editableExam.questions.map(question => (
                      <button
                        key={question.id}
                        type="button"
                        onClick={() => setSelectedEditorQuestionId(question.id)}
                        className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                          activeEditorQuestion?.id === question.id
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${activeEditorQuestion?.id === question.id ? 'text-white' : 'text-slate-900'}`}>
                          {question.order}번
                        </p>
                        <p className={`mt-2 line-clamp-2 text-sm ${activeEditorQuestion?.id === question.id ? 'text-slate-200' : 'text-slate-500'}`}>
                          {question.prompt || '문항 내용을 입력하세요.'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                    <div className={`mb-5 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${autosaveTone.panel}`}>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${autosaveTone.badge}`}>
                        {workspaceOrigin?.kind === 'saved-exam' ? autosaveTone.label : '첫 저장 필요'}
                      </span>
                      <span>
                        {workspaceOrigin?.kind === 'saved-exam'
                          ? autosaveMessage || '변경사항이 자동 저장됩니다.'
                          : '이 초안을 한 번 저장하면 이후부터는 편집 중 자동 저장됩니다.'}
                      </span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="block text-sm font-medium text-slate-700">
                        시험 제목
                        <input
                          value={editableExam.title}
                          onChange={event => setEditableExam(current => current ? { ...current, title: event.target.value } : current)}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700">
                        시험 날짜
                        <input
                          type="date"
                          value={editableExam.examDate}
                          onChange={event => setEditableExam(current => current ? { ...current, examDate: event.target.value } : current)}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                        설명
                        <textarea
                          value={editableExam.description}
                          onChange={event => setEditableExam(current => current ? { ...current, description: event.target.value } : current)}
                          className="mt-2 min-h-[100px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                        />
                      </label>
                      <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                        교육 목적
                        <textarea
                          value={editableExam.learningObjective}
                          onChange={event =>
                            setEditableExam(current => current ? { ...current, learningObjective: event.target.value } : current)
                          }
                          className="mt-2 min-h-[100px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                          placeholder="이 시험으로 학생이 무엇을 이해하고 설명할 수 있어야 하는지 적어주세요."
                        />
                      </label>
                    </div>
                  </div>

                  {activeEditorQuestion && (
                    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h3 className="text-xl font-semibold text-slate-950">{activeEditorQuestion.order}번 문항 편집</h3>
                          <p className="mt-2 text-sm text-slate-500">문항 수정, 선택지 변경, 정답 지정, 해설 편집을 여기서 진행합니다.</p>
                        </div>
                        <button
                          type="button"
                          onClick={deleteCurrentQuestion}
                          disabled={editableExam.questions.length <= 1}
                          className="inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          현재 문항 삭제
                        </button>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <label className="block text-sm font-medium text-slate-700">
                          개념 태그
                          <input
                            value={activeEditorQuestion.concept}
                            onChange={event => updateCurrentQuestion(question => ({ ...question, concept: event.target.value }))}
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                          />
                        </label>
                        <label className="block text-sm font-medium text-slate-700">
                          배점
                          <input
                            type="number"
                            min={1}
                            value={activeEditorQuestion.points}
                            onChange={event =>
                              updateCurrentQuestion(question => ({
                                ...question,
                                points: Number(event.target.value) || 10,
                              }))
                            }
                            className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                          />
                        </label>
                        <label className="block text-sm font-medium text-slate-700 lg:col-span-2">
                          문제
                          <textarea
                            value={activeEditorQuestion.prompt}
                            onChange={event => updateCurrentQuestion(question => ({ ...question, prompt: event.target.value }))}
                            className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                          />
                        </label>
                      </div>

                      <div className="mt-5 grid gap-3">
                        {activeEditorQuestion.choices.map((choice, index) => (
                          <div key={`${activeEditorQuestion.id}-${choice.label}`} className="grid gap-3 lg:grid-cols-[100px_minmax(0,1fr)_140px]">
                            <input
                              value={choice.label}
                              onChange={event =>
                                updateCurrentQuestion(question => ({
                                  ...question,
                                  choices: question.choices.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, label: event.target.value.toUpperCase().slice(0, 1) || item.label } : item,
                                  ),
                                }))
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                            />
                            <input
                              value={choice.text}
                              onChange={event =>
                                updateCurrentQuestion(question => ({
                                  ...question,
                                  choices: question.choices.map((item, itemIndex) =>
                                    itemIndex === index ? { ...item, text: event.target.value } : item,
                                  ),
                                }))
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                            />
                            <button
                              type="button"
                              onClick={() => updateCurrentQuestion(question => ({ ...question, answer: choice.label }))}
                              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                                activeEditorQuestion.answer === choice.label
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'border border-slate-200 bg-white text-slate-700'
                              }`}
                            >
                              정답으로 선택
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() =>
                            updateCurrentQuestion(question => ({
                              ...question,
                              choices: [
                                ...question.choices,
                                { label: String.fromCharCode(65 + question.choices.length), text: '' },
                              ],
                            }))
                          }
                          className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          선택지 추가
                        </button>
                      </div>

                      <div className="mt-5 grid gap-4 lg:grid-cols-2">
                        <label className="block text-sm font-medium text-slate-700">
                          해설
                          <textarea
                            value={activeEditorQuestion.explanation}
                            onChange={event => updateCurrentQuestion(question => ({ ...question, explanation: event.target.value }))}
                            className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                          />
                        </label>
                        <div className="space-y-4">
                          <label className="block text-sm font-medium text-slate-700">
                            자료 근거 요약
                            <textarea
                              value={activeEditorQuestion.evidenceExcerpt}
                              onChange={event => updateCurrentQuestion(question => ({ ...question, evidenceExcerpt: event.target.value }))}
                              className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                            />
                          </label>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                            근거 페이지: {activeEditorQuestion.sourcePages.length > 0 ? activeEditorQuestion.sourcePages.join(', ') : '없음'}
                            {activeEditorQuestion.sourcePages.length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReaderPageNumber(activeEditorQuestion.sourcePages[0])
                                  setWorkspaceMode('reader')
                                }}
                                className="mt-3 block rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                              >
                                이 문항 근거 페이지 보기
                              </button>
                            )}
                          </div>
                          {activeEditorSourceChunkPreviews.length > 0 && (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">DB 근거 텍스트</p>
                              <div className="mt-3 space-y-3">
                                {activeEditorSourceChunkPreviews.map(chunk => (
                                  <div key={chunk.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                                    <p className="text-xs font-semibold text-slate-500">
                                      {chunk.page_label ?? (chunk.page_number ? `${chunk.page_number}p` : '자료 텍스트')}
                                    </p>
                                    <p className="mt-2 text-sm leading-6 text-slate-700">{chunk.content}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-6 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={handleSaveEditedExam}
                          disabled={savingEditedExam}
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                        >
                          <Save className="h-4 w-4" />
                          {savingEditedExam ? '저장 중...' : workspaceOrigin?.kind === 'saved-exam' ? '변경사항 저장' : '이 시험 저장'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorkspaceMode('student-paper')}
                          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                        >
                          학생용 시험지 확인
                        </button>
                        <button
                          type="button"
                          onClick={resetEditableState}
                          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                        >
                          {workspaceOrigin?.kind === 'saved-exam' ? '마지막 저장 상태로 되돌리기' : '원본 초안으로 되돌리기'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            {workspaceMode === 'student-paper' && (
              <section className="space-y-5">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-950">학생에게 전달될 시험지 확인</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        한 페이지에 최대 6문항씩 보여주고, 다음 페이지로 넘겨가며 학생 화면처럼 확인합니다. 선택한 답안 UI도 함께 미리 볼 수 있습니다.
                      </p>
                      <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${autosaveTone.panel}`}>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${autosaveTone.badge}`}>
                          {workspaceOrigin?.kind === 'saved-exam' ? autosaveTone.label : '첫 저장 필요'}
                        </span>
                        <span>
                          {workspaceOrigin?.kind === 'saved-exam'
                            ? autosaveMessage || '변경사항이 자동 저장됩니다.'
                            : '학생용 미리보기 상태는 첫 저장 후부터 자동 저장됩니다.'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => setWorkspaceMode('editor')}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                      >
                        시험 편집으로 돌아가기
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEditedExam}
                        disabled={savingEditedExam}
                        className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                        {savingEditedExam ? '저장 중...' : workspaceOrigin?.kind === 'saved-exam' ? '이 상태로 저장' : '이 상태로 첫 저장'}
                      </button>
                    </div>
                  </div>
                </div>

                <StudentPaperPreview
                  preview={editablePreview}
                  currentPage={studentPreviewPage}
                  totalPages={totalStudentPreviewPages}
                  onPageChange={setStudentPreviewPage}
                  answers={studentPreviewAnswers}
                  onSelectAnswer={(questionId, choiceLabel) =>
                    setStudentPreviewAnswers(current => ({
                      ...current,
                      [questionId]: choiceLabel,
                    }))
                  }
                  showAnswerKey={showAnswerKey}
                  onToggleAnswerKey={() => setShowAnswerKey(current => !current)}
                />
              </section>
            )}
          </div>
        </FullscreenOverlay>
      )}
    </div>
  )
}
