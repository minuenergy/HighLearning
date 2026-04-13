import { fetchJson, getApiUrl } from '@/lib/api'

export type WorkspaceProfileBundle = {
  profile: {
    id: string
    email: string
    full_name?: string | null
    role: 'teacher' | 'student'
    phone_number?: string | null
    created_at?: string
  }
  settings: Record<string, unknown>
}

export type SignupValidationResult = {
  verification_status: 'pending' | 'verified' | 'manual_review'
  verification_method: string
  invite_code_used?: string | null
  verified_at?: string | null
  verification_note?: string | null
  school_email?: string | null
  school_class_id?: string | null
  class_label?: string | null
  course_id?: string | null
}

export type TeacherClassOverview = {
  id: string
  scope_type: 'school_class' | 'course'
  title: string
  grade_level?: string | null
  class_label?: string | null
  course_ids: string[]
  subject_labels: string[]
  student_count: number
  students: Array<{
    id: string
    full_name: string
    email?: string | null
    average_first_score?: number | null
    needs_support_count: number
    mastered_count: number
    recent_conversation_count: number
    note_preview?: string | null
  }>
}

export type TeacherStudentsOverview = {
  classes: TeacherClassOverview[]
}

export type TeacherStudentDetail = {
  student: {
    id: string
    email?: string | null
    full_name: string
    phone_number?: string | null
    student_number?: string | null
    class_label?: string | null
  }
  group: {
    id: string
    scope_type: 'school_class' | 'course'
    title: string
    subject_labels: string[]
  }
  summary: {
    average_first_score?: number | null
    needs_support_count: number
    mastered_count: number
    recent_conversation_count: number
  }
  note: string
  note_updated_at?: string | null
  subject_scores: Array<{
    subject: string
    average_score?: number | null
    question_count: number
    resolved_after_review_count: number
    sections: Array<{
      section: string
      average_score?: number | null
      question_count: number
    }>
  }>
  ai_analysis: Array<{
    subject: string
    understood_concepts: string[]
    confusing_concepts: string[]
    repeated_misconceptions: string[]
    helpful_prompt_styles: string[]
    conversation_patterns: string[]
    transcript_highlights: string[]
    conversation_count: number
    support_signal: 'stable' | 'watch' | 'intensive'
    teaching_tips: string[]
  }>
  class_concept_summary: {
    difficult: Array<{
      label: string
      average_first_score?: number | null
      student_count: number
      question_count: number
    }>
    strong: Array<{
      label: string
      average_first_score?: number | null
      student_count: number
      question_count: number
    }>
  }
  llm_briefing: {
    executive_summary: string
    class_difficult_concepts: Array<{
      label: string
      average_first_score?: number | null
      student_count: number
      question_count: number
    }>
    class_strong_concepts: Array<{
      label: string
      average_first_score?: number | null
      student_count: number
      question_count: number
    }>
    unresolved_concepts: Array<{
      label: string
      subject: string
      reason: string
      unresolved_question_count: number
    }>
  }
  recent_conversations: Array<{
    id: string
    course_id: string
    concept_tag?: string | null
    summary?: string | null
    ended_at?: string | null
    source_type?: string | null
    focus_question?: string | null
    preview?: string | null
    message_count?: number
  }>
}

export type TeacherSubjectOverview = {
  subjects: Array<{
    subject: string
    average_first_score?: number | null
    student_count: number
    course_count: number
    sections: Array<{
      section: string
      average_score?: number | null
      question_count: number
    }>
    class_breakdown: Array<{
      group_id: string
      title: string
      average_score?: number | null
    }>
    class_sections: Array<{
      group_id: string
      title: string
      sections: Array<{
        section: string
        average_score?: number | null
        question_count: number
      }>
    }>
    hardest_questions: Array<{
      question_id: string
      exam_title: string
      question_order: number
      prompt: string
      accuracy_rate?: number | null
    }>
    conversation_count: number
    common_confusions: string[]
    helpful_prompt_styles: string[]
    conversation_patterns: string[]
    teaching_signals: string[]
  }>
}

export type TeacherSubjectBriefing = {
  subject: string
  executive_summary: string
  priority_sections: string[]
  misconceptions: Array<{
    concept: string
    pattern: string
    evidence: string
  }>
  question_patterns: Array<{
    type: string
    example: string
    teacher_move: string
  }>
  teacher_actions: string[]
  teacher_talk_track: string[]
}

export type StudentPerformanceOverview = {
  summary: {
    subject_count: number
    average_first_score?: number | null
    completed_exams: number
  }
  subjects: Array<{
    subject: string
    average_score?: number | null
    question_count: number
    sections: Array<{
      section: string
      average_score?: number | null
      question_count: number
    }>
  }>
  exam_cards: Array<{
    exam_id: string
    title: string
    average_score?: number | null
    subjects: string[]
    wrong_count: number
  }>
}

export type TutorHistoryEntry = {
  id: string
  courseId: string
  concept: string
  preview: string
  updatedAt: string
  messageCount: number
  sourceType?: string
}

export type TutorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type TutorConversationThread = {
  conversation: {
    id: string
    student_id: string
    course_id: string
    concept_tag: string
    summary?: string | null
    source_type?: string | null
    focus_question?: string | null
  }
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    message_order: number
    created_at: string
  }>
}

export type InviteCodeRecord = {
  id: string
  code: string
  role: 'teacher' | 'student'
  purpose: 'teacher_onboarding' | 'student_onboarding'
  created_by?: string | null
  school_class_id?: string | null
  course_id?: string | null
  label?: string | null
  subject_names?: string[]
  max_uses: number
  used_count: number
  active: boolean
  expires_at?: string | null
  created_at: string
  updated_at?: string | null
}

export type TeacherVerificationRequest = {
  teacher_id: string
  is_admin?: boolean
  email?: string | null
  full_name?: string | null
  joined_at?: string | null
  school_name?: string | null
  school_email?: string | null
  phone_number?: string | null
  verification_status: 'pending' | 'verified' | 'manual_review'
  verification_method?: string | null
  verified_at?: string | null
  verification_note?: string | null
  subject_names?: string[]
  grade_levels?: string[]
  class_labels?: string[]
  updated_at?: string | null
}

export async function fetchWorkspaceProfile(userId: string) {
  return fetchJson<WorkspaceProfileBundle>(`/api/workspace/profile/${userId}`)
}

export async function updateWorkspaceProfile(userId: string, payload: Record<string, unknown>) {
  return fetchJson<WorkspaceProfileBundle>(`/api/workspace/profile/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function validateTeacherSignup(payload: {
  email: string
  school_email?: string
  verification_method: string
  invite_code?: string
}) {
  return fetchJson<SignupValidationResult>('/api/workspace/auth/teacher/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function finalizeTeacherSignup(payload: {
  user_id: string
  email: string
  full_name: string
  phone_number?: string
  school_name?: string
  school_email?: string
  verification_method: string
  invite_code?: string
  subject_names?: string[]
  grade_levels?: string[]
  class_labels?: string[]
}) {
  return fetchJson<Record<string, unknown>>('/api/workspace/auth/teacher/finalize', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function validateStudentSignup(payload: {
  invite_code: string
  student_number: string
}) {
  return fetchJson<SignupValidationResult>('/api/workspace/auth/student/validate', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function finalizeStudentSignup(payload: {
  user_id: string
  email: string
  full_name: string
  phone_number?: string
  student_number: string
  invite_code: string
}) {
  return fetchJson<Record<string, unknown>>('/api/workspace/auth/student/finalize', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchTeacherStudentsOverview(teacherId: string) {
  return fetchJson<TeacherStudentsOverview>(`/api/workspace/teacher/${teacherId}/students`)
}

export async function fetchTeacherStudentDetail(teacherId: string, studentId: string, groupId?: string | null) {
  const query = groupId ? `?group_id=${encodeURIComponent(groupId)}` : ''
  return fetchJson<TeacherStudentDetail>(`/api/workspace/teacher/${teacherId}/students/${studentId}${query}`)
}

export async function saveTeacherNote(
  teacherId: string,
  studentId: string,
  payload: {
    note: string
    school_class_id?: string | null
    course_id?: string | null
  },
) {
  return fetchJson<{ id: string; note: string; updated_at: string }>(
    `/api/workspace/teacher/${teacherId}/students/${studentId}/note`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export async function fetchTeacherSubjectsOverview(teacherId: string) {
  return fetchJson<TeacherSubjectOverview>(`/api/workspace/teacher/${teacherId}/subjects`)
}

export async function fetchTeacherSubjectBriefing(teacherId: string, subjectName: string) {
  return fetchJson<TeacherSubjectBriefing>(
    `/api/workspace/teacher/${teacherId}/subjects/${encodeURIComponent(subjectName)}`,
  )
}

export async function listTeacherInviteCodes(
  teacherId: string,
  options?: {
    role?: string
    course_id?: string | null
    school_class_id?: string | null
  },
) {
  const params = new URLSearchParams()
  if (options?.role) params.set('role', options.role)
  if (options?.course_id) params.set('course_id', options.course_id)
  if (options?.school_class_id) params.set('school_class_id', options.school_class_id)
  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchJson<InviteCodeRecord[]>(`/api/workspace/teacher/${teacherId}/invite-codes${query}`)
}

export async function createTeacherInviteCode(
  teacherId: string,
  payload: {
    role?: 'teacher' | 'student'
    label: string
    course_id?: string | null
    school_class_id?: string | null
    subject_names?: string[]
    max_uses?: number
    expires_days?: number
  },
) {
  return fetchJson<InviteCodeRecord>(`/api/workspace/teacher/${teacherId}/invite-codes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchTeacherVerificationRequests(
  teacherId: string,
  options?: {
    status?: 'open' | 'pending' | 'manual_review' | 'verified'
  },
) {
  const params = new URLSearchParams()
  if (options?.status) params.set('status', options.status)
  const query = params.toString() ? `?${params.toString()}` : ''
  return fetchJson<TeacherVerificationRequest[]>(
    `/api/workspace/teacher/${teacherId}/verification-requests${query}`,
  )
}

export async function updateTeacherVerificationRequest(
  teacherId: string,
  targetTeacherId: string,
  payload: {
    verification_status: 'pending' | 'verified' | 'manual_review'
    verification_note?: string
  },
) {
  return fetchJson<TeacherVerificationRequest>(
    `/api/workspace/teacher/${teacherId}/verification-requests/${targetTeacherId}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
}

export async function fetchStudentPerformance(studentId: string, courseId: string) {
  return fetchJson<StudentPerformanceOverview>(`/api/workspace/student/${studentId}/performance/${courseId}`)
}

export async function listTutorConversations(studentId: string, courseId?: string | null) {
  const query = courseId ? `?course_id=${encodeURIComponent(courseId)}` : ''
  return fetchJson<TutorHistoryEntry[]>(`/api/workspace/student/${studentId}/conversations${query}`)
}

export async function fetchTutorConversationThread(studentId: string, conversationId: string) {
  return fetchJson<TutorConversationThread>(
    `/api/workspace/student/${studentId}/conversations/${conversationId}`,
  )
}

export async function deleteTutorConversation(studentId: string, conversationId: string) {
  return fetchJson<{ deleted: true }>(`/api/workspace/student/${studentId}/conversations/${conversationId}`, {
    method: 'DELETE',
  })
}

export function getSocraticChatUrl() {
  return getApiUrl('/api/chat/socratic')
}
