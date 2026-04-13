'use client'

import {
  ArrowUpRight,
  History,
  MessageSquareText,
  Plus,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import SocraticChat from '@/components/chat/SocraticChat'
import {
  deleteTutorConversation,
  fetchTutorConversationThread,
  listTutorConversations,
  type TutorHistoryEntry,
  type TutorMessage,
} from '@/lib/workspace-api'

type Props = {
  courseId: string
  studentId: string
  defaultConcept: string
  starterPrompt?: string
  sourceType?: string
  sourceReferenceId?: string
  focusQuestion?: string
  contextTitle?: string
  learningObjective?: string
  sourceReference?: string
  title?: string
  subtitle?: string
  autoSelectFirst?: boolean
  compact?: boolean
}

function formatRelativeTime(updatedAt: string) {
  const diffMs = Date.now() - new Date(updatedAt).getTime()
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)))

  if (diffMinutes < 60) return `${diffMinutes}분 전`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}시간 전`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}일 전`
}

export default function TutorWorkspacePanel({
  courseId,
  studentId,
  defaultConcept,
  starterPrompt,
  sourceType,
  sourceReferenceId,
  focusQuestion,
  contextTitle,
  learningObjective,
  sourceReference,
  title = 'AI 튜터 챗봇',
  subtitle = '세션별로 대화가 분리되며, 같은 계정이면 다른 기기에서도 이어집니다.',
  autoSelectFirst = false,
  compact = false,
}: Props) {
  const [sessions, setSessions] = useState<TutorHistoryEntry[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [threadMessages, setThreadMessages] = useState<TutorMessage[]>([])
  const [threadConcept, setThreadConcept] = useState(defaultConcept)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)

  const refreshSessions = useCallback(
    async (preferredConversationId?: string | null) => {
      if (!studentId || studentId === 'guest') {
        setSessions([])
        return
      }

      setLoadingSessions(true)
      try {
        const nextSessions = await listTutorConversations(studentId, courseId)
        setSessions(nextSessions)

        if (preferredConversationId) {
          setSelectedConversationId(preferredConversationId)
        } else if (!selectedConversationId && autoSelectFirst && nextSessions[0]) {
          setSelectedConversationId(nextSessions[0].id)
        }
      } finally {
        setLoadingSessions(false)
      }
    },
    [autoSelectFirst, courseId, selectedConversationId, studentId],
  )

  useEffect(() => {
    void refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    if (!selectedConversationId || !studentId || studentId === 'guest') {
      setThreadMessages([])
      setThreadConcept(defaultConcept)
      return
    }

    let active = true
    const conversationId = selectedConversationId

    async function loadThread() {
      setLoadingThread(true)
      try {
        const thread = await fetchTutorConversationThread(studentId, conversationId)
        if (!active) return
        const nextMessages: TutorMessage[] = []
        thread.messages.forEach(message => {
          if (message.role === 'user' || message.role === 'assistant') {
            nextMessages.push({
              role: message.role,
              content: message.content,
            })
          }
        })
        setThreadMessages(nextMessages)
        setThreadConcept(thread.conversation.concept_tag || defaultConcept)
      } finally {
        if (active) {
          setLoadingThread(false)
        }
      }
    }

    void loadThread()

    return () => {
      active = false
    }
  }, [defaultConcept, selectedConversationId, studentId])

  const currentConcept = useMemo(
    () => (selectedConversationId ? threadConcept : defaultConcept),
    [defaultConcept, selectedConversationId, threadConcept],
  )

  const startNewConversation = () => {
    setSelectedConversationId(null)
    setThreadMessages([])
    setThreadConcept(defaultConcept)
  }

  const removeConversation = async (conversationId: string) => {
    if (!studentId || studentId === 'guest') return

    setDeletingConversationId(conversationId)
    try {
      await deleteTutorConversation(studentId, conversationId)
      if (selectedConversationId === conversationId) {
        startNewConversation()
      }
      await refreshSessions()
    } finally {
      setDeletingConversationId(null)
    }
  }

  // compact 모드: 사이드바 전용 — 세션 picker/원칙 섹션 없이 chat만 꽉 채움
  if (compact) {
    return (
      <div className="flex h-full flex-col">
        {loadingThread && selectedConversationId ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            세션을 불러오는 중입니다...
          </div>
        ) : (
          <SocraticChat
            courseId={courseId}
            concept={currentConcept}
            studentId={studentId}
            conversationId={selectedConversationId}
            initialMessages={threadMessages}
            starterPrompt={starterPrompt}
            sourceType={sourceType}
            sourceReferenceId={sourceReferenceId}
            focusQuestion={focusQuestion}
            contextTitle={contextTitle}
            learningObjective={learningObjective}
            sourceReference={sourceReference}
            compact
            onConversationIdChange={nextConversationId => {
              setSelectedConversationId(nextConversationId)
              if (!nextConversationId) {
                setThreadMessages([])
                setThreadConcept(defaultConcept)
              }
            }}
            onConversationCommitted={() => void refreshSessions()}
          />
        )}
      </div>
    )
  }

  // full 모드: 기존 레이아웃 (세션 picker + chat + 원칙)
  return (
    <div className="space-y-5">
      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={startNewConversation}
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />
            새 세션
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-slate-500">
            <History className="h-4 w-4" />
            <p className="text-sm font-medium">세션 선택</p>
          </div>

          {loadingSessions && (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              세션을 불러오는 중입니다.
            </p>
          )}

          {!loadingSessions && sessions.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
              아직 저장된 대화가 없습니다. 현재 맥락으로 새 세션을 시작해보세요.
            </p>
          )}

          {sessions.map(session => (
            <div
              key={session.id}
              className={`rounded-[22px] border px-4 py-4 transition ${
                selectedConversationId === session.id
                  ? 'border-blue-200 bg-blue-50/70'
                  : 'border-slate-200 bg-slate-50/70 hover:border-slate-300'
              }`}
            >
              <button
                type="button"
                onClick={() => setSelectedConversationId(session.id)}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">{session.concept}</p>
                  <ArrowUpRight className="h-4 w-4 text-slate-400" />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{session.preview}</p>
                <p className="mt-3 text-xs text-slate-400">
                  {formatRelativeTime(session.updatedAt)} · 메시지 {session.messageCount}개
                </p>
              </button>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void removeConversation(session.id)}
                  disabled={deletingConversationId === session.id}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-red-200 hover:text-red-600 disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingConversationId === session.id ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] p-3 shadow-sm">
        {loadingThread && selectedConversationId ? (
          <div className="flex min-h-[24rem] items-center justify-center text-sm text-slate-500">
            선택한 세션을 불러오는 중입니다.
          </div>
        ) : (
          <SocraticChat
            courseId={courseId}
            concept={currentConcept}
            studentId={studentId}
            conversationId={selectedConversationId}
            initialMessages={threadMessages}
            starterPrompt={starterPrompt}
            sourceType={sourceType}
            sourceReferenceId={sourceReferenceId}
            focusQuestion={focusQuestion}
            contextTitle={contextTitle}
            learningObjective={learningObjective}
            sourceReference={sourceReference}
            onConversationIdChange={nextConversationId => {
              setSelectedConversationId(nextConversationId)
              if (!nextConversationId) {
                setThreadMessages([])
                setThreadConcept(defaultConcept)
              }
            }}
            onConversationCommitted={() => void refreshSessions()}
          />
        )}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">소크라테스식 운영 원칙</h3>
            <p className="mt-1 text-sm text-slate-500">
              정답을 바로 주기보다, 학생이 근거와 사고 순서를 말하도록 유도하는 흐름을 유지합니다.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
