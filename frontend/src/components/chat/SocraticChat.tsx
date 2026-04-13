'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCcw, Send, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSocraticChatUrl, type TutorMessage } from '@/lib/workspace-api'

type Message = TutorMessage

type Props = {
  courseId: string
  concept: string
  studentId: string
  conversationId?: string | null
  initialMessages?: TutorMessage[]
  starterPrompt?: string
  sourceType?: string
  sourceReferenceId?: string
  focusQuestion?: string
  contextTitle?: string
  learningObjective?: string
  sourceReference?: string
  compact?: boolean
  onConversationIdChange?: (conversationId: string | null) => void
  onConversationCommitted?: () => void
}

const STARTER_PROMPTS = [
  '이 개념이 왜 필요한지부터 질문으로 알려줘.',
  '시험에 자주 나오는 포인트를 스스로 떠올리게 도와줘.',
  '아주 쉬운 예시부터 단계적으로 이해하고 싶어.',
]

function MessageBubble({ msg, compact }: { msg: Message; compact?: boolean }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`rounded-[22px] px-4 py-3 text-sm leading-7 shadow-sm ${
          compact ? 'max-w-[88%]' : 'max-w-[90%] md:max-w-[78%] md:text-[17px]'
        } ${
          isUser
            ? 'bg-[linear-gradient(135deg,#1d4ed8,#3b82f6)] text-white shadow-blue-200/80'
            : 'border border-slate-200/80 bg-white text-slate-800 shadow-slate-200/70'
        }`}
      >
        {!compact && (
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">
            <span>{isUser ? 'You' : 'Tutor'}</span>
          </div>
        )}
        {msg.content || <span className="animate-pulse text-slate-400">생각을 정리하고 있어요...</span>}
      </div>
    </div>
  )
}

export default function SocraticChat({
  courseId,
  concept,
  studentId,
  conversationId,
  initialMessages = [],
  starterPrompt,
  sourceType,
  sourceReferenceId,
  focusQuestion,
  contextTitle,
  learningObjective,
  sourceReference,
  compact = false,
  onConversationIdChange,
  onConversationCommitted,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const resolvedStudentId = studentId || 'guest'

  const syncConversationId = (nextConversationId: string | null) => {
    setActiveConversationId(nextConversationId)
    onConversationIdChange?.(nextConversationId)
  }

  useEffect(() => {
    setMessages(initialMessages)
    setActiveConversationId(conversationId ?? null)
  }, [conversationId, initialMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!starterPrompt) return
    if (messages.length > 0) return
    if (input.trim()) return
    setInput(starterPrompt)
  }, [starterPrompt, messages, input])

  const appendAssistantChunk = (chunk: string) => {
    setMessages(prev => {
      const updated = [...prev]
      updated[updated.length - 1] = {
        role: 'assistant',
        content: (updated[updated.length - 1]?.content || '') + chunk,
      }
      return updated
    })
  }

  const processSseEvent = (event: string) => {
    const data = event
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.replace(/^data:\s?/, ''))
      .join('\n')

    if (!data) return false
    if (data === '[DONE]') return true

    try {
      appendAssistantChunk(JSON.parse(data))
    } catch {
      appendAssistantChunk(data)
    }

    return false
  }

  const readStream = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)

        if (event && processSseEvent(event)) {
          await reader.cancel()
          return
        }

        boundary = buffer.indexOf('\n\n')
      }

      if (done) break
    }

    const lastEvent = buffer.trim()
    if (lastEvent) {
      processSseEvent(lastEvent)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || streaming) return

    const trimmedInput = input.trim()
    const userMsg: Message = { role: 'user', content: trimmedInput }
    const history = [...messages, userMsg]
    setMessages([...history, { role: 'assistant', content: '' }])
    setInput('')
    setStreaming(true)

    try {
      const res = await fetch(getSocraticChatUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: courseId,
          concept,
          student_id: resolvedStudentId,
          conversation_id: activeConversationId,
          messages: history.map(message => ({ role: message.role, content: message.content })),
          student_query: trimmedInput,
          source_type: sourceType,
          source_reference_id: sourceReferenceId,
          focus_question: focusQuestion,
          context_title: contextTitle,
          learning_objective: learningObjective,
          source_reference: sourceReference,
        }),
      })

      if (!res.ok || !res.body) {
        throw new Error(`Request failed with status ${res.status}`)
      }

      const nextConversationId = res.headers.get('x-conversation-id')
      if (nextConversationId) {
        syncConversationId(nextConversationId)
      }

      await readStream(res.body)
      onConversationCommitted?.()
    } catch (error) {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: 'assistant',
          content: '응답을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
        }
        return updated
      })
      console.error(error)
    } finally {
      setStreaming(false)
    }
  }

  const resetConversation = () => {
    setMessages([])
    setInput(starterPrompt ?? '')
    syncConversationId(null)
  }

  /* ── COMPACT MODE (사이드바용) ── */
  if (compact) {
    return (
      <div className="flex h-full flex-col">
        {/* 맥락 박스 */}
        {focusQuestion && (
          <div className="shrink-0 border-b border-slate-100 bg-amber-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              {contextTitle ?? '학습 맥락'}
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-900">{focusQuestion}</p>
          </div>
        )}

        {/* 메시지 영역 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-1">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                이렇게 시작해보세요
              </p>
              <ul className="space-y-1">
                {[starterPrompt, ...STARTER_PROMPTS]
                  .filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i)
                  .map(prompt => (
                    <li key={prompt}>
                      <button
                        type="button"
                        onClick={() => setInput(prompt)}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-left text-sm leading-6 text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
                      >
                        {prompt}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, index) => (
                <MessageBubble key={`${msg.role}-${index}-${msg.content.slice(0, 12)}`} msg={msg} compact />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 입력 영역 */}
        <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3">
          <div className="flex items-end gap-2 rounded-[20px] border border-slate-200 bg-slate-50 px-3 py-2">
            <textarea
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              placeholder="막히는 개념이나 질문을 적어보세요."
              disabled={streaming}
              rows={2}
              className="min-h-[48px] flex-1 resize-none bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={streaming || !input.trim()}
              className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between px-1">
            <p className="text-[11px] text-slate-400">Enter 전송 · Shift+Enter 줄바꿈</p>
            <button
              type="button"
              onClick={resetConversation}
              className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-700"
            >
              <RefreshCcw className="h-3 w-3" />
              새 대화
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── FULL MODE (전체 튜터 페이지용) ── */
  return (
    <section className="relative overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
      <div className="border-b border-slate-200 bg-[linear-gradient(135deg,rgba(239,246,255,0.95),rgba(255,255,255,0.92))] px-6 py-5 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">
              <Sparkles className="h-3.5 w-3.5" />
              Socratic Session
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 md:text-3xl">
              질문으로 이해를 넓히는 튜터
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 md:text-base">
              직접 답을 주기보다, 스스로 개념의 구조를 떠올리게 돕는 방식으로 대화를 이어갑니다.
            </p>
            {focusQuestion && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                <p className="font-semibold">{contextTitle ?? '연결된 학습 맥락'}</p>
                <p className="mt-1">{focusQuestion}</p>
                {learningObjective && <p className="mt-2">교육 목적: {learningObjective}</p>}
                {sourceReference && <p className="mt-2">자료 범위: {sourceReference}</p>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600 shadow-sm">
              현재 개념
              <div className="mt-1 text-base font-semibold text-slate-900">{concept}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl border-slate-300 bg-white/80 px-4 text-sm font-medium text-slate-700 hover:bg-white"
              onClick={resetConversation}
            >
              <RefreshCcw className="h-4 w-4" />
              새 대화
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-[58vh] space-y-4 overflow-y-auto px-5 py-6 md:min-h-[68vh] md:px-8 md:py-8">
        {messages.length === 0 && (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/70 p-6 shadow-sm md:p-8">
            <p className="text-lg font-semibold text-slate-900 md:text-xl">바로 이렇게 시작해보세요.</p>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
              짧게 물어봐도 괜찮고, 막히는 지점만 적어도 괜찮아요. 튜터가 한 단계씩 질문으로 방향을 잡아줄 거예요.
            </p>
            <ul className="mt-6 space-y-2">
              {[starterPrompt, ...STARTER_PROMPTS]
                .filter((p, i, arr): p is string => !!p && arr.indexOf(p) === i)
                .map(prompt => (
                  <li key={prompt}>
                    <button
                      type="button"
                      onClick={() => setInput(prompt)}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm leading-6 text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                    >
                      {prompt}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}

        {messages.map((msg, index) => (
          <MessageBubble key={`${msg.role}-${index}-${msg.content.slice(0, 12)}`} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 bg-white/85 px-5 py-5 backdrop-blur md:px-8">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50/90 p-3 shadow-inner shadow-slate-200/60">
          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            placeholder="막히는 개념, 떠오른 가설, 헷갈리는 예시를 편하게 적어보세요."
            disabled={streaming}
            rows={3}
            className="min-h-[104px] w-full resize-none rounded-[22px] border-0 bg-transparent px-4 py-3 text-[15px] leading-7 text-slate-800 outline-none placeholder:text-slate-400 md:text-[17px]"
          />
          <div className="mt-3 flex flex-col gap-3 border-t border-slate-200 px-2 pt-3 md:flex-row md:items-center md:justify-between">
            <p className="text-xs leading-5 text-slate-500 md:text-sm">
              `Enter`로 전송하고, 줄바꿈은 `Shift + Enter`로 입력할 수 있어요.
            </p>
            <Button
              onClick={() => void sendMessage()}
              disabled={streaming || !input.trim()}
              className="h-12 rounded-2xl bg-[linear-gradient(135deg,#0f172a,#1d4ed8)] px-5 text-sm font-semibold text-white shadow-lg shadow-blue-300/40 hover:opacity-95"
            >
              {streaming ? '생각 중...' : '질문 보내기'}
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
