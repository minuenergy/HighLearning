'use client'

import { X, Sparkles } from 'lucide-react'
import TutorWorkspacePanel from './TutorWorkspacePanel'

export default function TutorSidebar({
  open,
  onClose,
  courseId,
  studentId,
  concept,
  starterPrompt,
  focusQuestion,
  contextTitle,
  learningObjective,
  sourceReference,
  sourceType,
  sourceReferenceId,
}: {
  open: boolean
  onClose: () => void
  courseId: string
  studentId: string
  concept?: string
  starterPrompt?: string
  focusQuestion?: string
  contextTitle?: string
  learningObjective?: string
  sourceReference?: string
  sourceType?: string
  sourceReferenceId?: string
}) {
  return (
    <>
      {/* 배경 오버레이 */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* 슬라이드 패널 */}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l border-slate-200 bg-white shadow-[−28px_0_80px_rgba(15,23,42,0.16)] transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-[linear-gradient(135deg,#eef6ff,#ffffff_46%,#fff7ed)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#f59e0b,#f97316)] text-slate-950 shadow-md shadow-amber-500/20">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">AI Tutor</p>
              <h2 className="text-base font-semibold text-slate-950">소크라테스 튜터</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden" style={{ height: 0 }}>
          <TutorWorkspacePanel
            courseId={courseId}
            studentId={studentId}
            defaultConcept={concept}
            starterPrompt={starterPrompt}
            focusQuestion={focusQuestion}
            contextTitle={contextTitle}
            learningObjective={learningObjective}
            sourceReference={sourceReference}
            sourceType={sourceType}
            sourceReferenceId={sourceReferenceId}
            autoSelectFirst
            compact
            title=""
            subtitle=""
          />
        </div>
      </aside>
    </>
  )
}
