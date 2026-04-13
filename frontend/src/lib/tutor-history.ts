export type TutorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type TutorHistoryEntry = {
  id: string
  courseId: string
  concept: string
  preview: string
  updatedAt: string
  messageCount: number
}

const CONVERSATION_PREFIX = 'socrateach:tutor:conversation'
const INDEX_PREFIX = 'socrateach:tutor:index'
const MAX_RECENT_SESSIONS = 6

function normalizeStudentId(studentId: string) {
  return studentId.trim() || 'guest'
}

function getConversationKey(studentId: string, courseId: string, concept: string) {
  return `${CONVERSATION_PREFIX}:${normalizeStudentId(studentId)}:${courseId}:${concept}`
}

function getIndexKey(studentId: string) {
  return `${INDEX_PREFIX}:${normalizeStudentId(studentId)}`
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function createSessionId(courseId: string, concept: string) {
  return `${courseId}:${concept}`
}

function extractPreview(messages: TutorMessage[]) {
  const reversed = [...messages].reverse()

  for (const message of reversed) {
    const trimmed = message.content.trim()
    if (trimmed) {
      return trimmed.slice(0, 80)
    }
  }

  return '새 학습 대화를 시작해보세요.'
}

export function loadConversation(studentId: string, courseId: string, concept: string) {
  if (!canUseStorage()) return [] as TutorMessage[]

  const raw = window.localStorage.getItem(getConversationKey(studentId, courseId, concept))
  if (!raw) return [] as TutorMessage[]

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [] as TutorMessage[]

    return parsed.filter(
      (message): message is TutorMessage =>
        typeof message === 'object' &&
        message !== null &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string'
    )
  } catch {
    return [] as TutorMessage[]
  }
}

export function loadRecentSessions(studentId: string) {
  if (!canUseStorage()) return [] as TutorHistoryEntry[]

  const raw = window.localStorage.getItem(getIndexKey(studentId))
  if (!raw) return [] as TutorHistoryEntry[]

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [] as TutorHistoryEntry[]

    return parsed.filter(
      (entry): entry is TutorHistoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.id === 'string' &&
        typeof entry.courseId === 'string' &&
        typeof entry.concept === 'string' &&
        typeof entry.preview === 'string' &&
        typeof entry.updatedAt === 'string' &&
        typeof entry.messageCount === 'number'
    )
  } catch {
    return [] as TutorHistoryEntry[]
  }
}

export function saveConversation(studentId: string, courseId: string, concept: string, messages: TutorMessage[]) {
  if (!canUseStorage()) return [] as TutorHistoryEntry[]

  const normalizedMessages = messages.filter(message => message.content.trim().length > 0)
  if (normalizedMessages.length === 0) {
    clearConversation(studentId, courseId, concept)
    return loadRecentSessions(studentId)
  }

  const conversationKey = getConversationKey(studentId, courseId, concept)
  const indexKey = getIndexKey(studentId)
  const sessionId = createSessionId(courseId, concept)
  const updatedAt = new Date().toISOString()

  window.localStorage.setItem(conversationKey, JSON.stringify(normalizedMessages))

  const existing = loadRecentSessions(studentId).filter(entry => entry.id !== sessionId)
  const nextEntry: TutorHistoryEntry = {
    id: sessionId,
    courseId,
    concept,
    preview: extractPreview(normalizedMessages),
    updatedAt,
    messageCount: normalizedMessages.length,
  }

  const nextIndex = [nextEntry, ...existing].slice(0, MAX_RECENT_SESSIONS)
  window.localStorage.setItem(indexKey, JSON.stringify(nextIndex))

  return nextIndex
}

export function clearConversation(studentId: string, courseId: string, concept: string) {
  if (!canUseStorage()) return [] as TutorHistoryEntry[]

  const conversationKey = getConversationKey(studentId, courseId, concept)
  const indexKey = getIndexKey(studentId)
  const sessionId = createSessionId(courseId, concept)

  window.localStorage.removeItem(conversationKey)

  const remaining = loadRecentSessions(studentId).filter(entry => entry.id !== sessionId)
  window.localStorage.setItem(indexKey, JSON.stringify(remaining))

  return remaining
}
