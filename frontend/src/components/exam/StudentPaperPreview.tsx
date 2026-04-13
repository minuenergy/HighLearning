'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

export type PreviewQuestion = {
  id: string
  order: number
  prompt: string
  concept?: string
  points?: number
  answer?: string
  choices: Array<{ label: string; text: string }>
}

export type PreviewExam = {
  title: string
  description?: string
  learningObjective?: string
  durationMinutes?: number
  totalPoints?: number
  examDate?: string
  sourceLabel?: string
  questions: PreviewQuestion[]
}

const QUESTIONS_PER_PAGE = 6

function formatDate(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}

export default function StudentPaperPreview({
  preview,
  currentPage,
  totalPages,
  onPageChange,
  answers,
  onSelectAnswer,
}: {
  preview: PreviewExam
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  answers: Record<string, string>
  onSelectAnswer: (questionId: string, choiceLabel: string) => void
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

      <div className="rounded-[36px] bg-[#ece3d5] p-4 shadow-inner">
        <div className="mx-auto rounded-[28px] border border-stone-200 bg-white px-6 py-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <span className="rounded-full border border-slate-300 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-slate-600">
              형성평가
            </span>
            {preview.sourceLabel && (
              <span className="text-[11px] font-medium text-slate-400">{preview.sourceLabel}</span>
            )}
          </div>

          <div className="mt-4 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400">SocraTeach Assessment</p>
            <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{preview.title}</h3>
            {preview.description && (
              <p className="mt-3 text-sm leading-7 text-slate-600">{preview.description}</p>
            )}
            {preview.learningObjective && (
              <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-left text-sm leading-7 text-blue-900">
                교육 목적: {preview.learningObjective}
              </p>
            )}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
            <div>시험일: {preview.examDate ? formatDate(preview.examDate) : '—'}</div>
            <div>제한 시간: {preview.durationMinutes ? `${preview.durationMinutes}분` : '—'}</div>
            <div>총점: {preview.totalPoints ? `${preview.totalPoints}점` : '—'}</div>
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
                          return (
                            <button
                              key={`${question.id}-${choice.label}`}
                              type="button"
                              onClick={() => onSelectAnswer(question.id, choice.label)}
                              className={`grid grid-cols-[28px_1fr] gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition ${
                                isSelected
                                  ? 'border-blue-300 bg-blue-50 text-blue-900'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                              }`}
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
            <span>현재 페이지 {questions.length}문항</span>
            <span>{currentPage + 1} / {totalPages} 페이지</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export { QUESTIONS_PER_PAGE }
