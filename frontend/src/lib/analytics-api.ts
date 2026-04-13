import { fetchJson } from '@/lib/api'

export type TeacherDashboardBriefing = {
  summary: {
    course_count: number
    concept_count: number
    total_stuck: number
    average_exam_score?: number | null
    pending_assignments: number
    conversation_count: number
  }
  course_snapshots: Array<{
    course_id: string
    course_title: string
    subject_name?: string | null
    class_label?: string | null
    grade_level?: string | null
    average_exam_score?: number | null
    pending_assignments: number
    conversation_count: number
    top_concept?: string | null
    top_concept_stuck: number
    strong_concept?: string | null
    lowest_accuracy_question?: number | null
  }>
  top_difficult_concepts: Array<{
    course_id: string
    course_title: string
    subject_name?: string | null
    class_label?: string | null
    concept: string
    total_stuck: number
    total_resolved: number
    student_count: number
    resolve_rate: number
    strength_score: number
  }>
  hardest_questions: Array<{
    course_id: string
    course_title: string
    subject_name?: string | null
    question_id: string
    exam_id: string
    exam_title: string
    question_order: number
    prompt: string
    concept_tag?: string | null
    attempted_count?: number
    incorrect_count?: number
    accuracy_rate?: number | null
    common_wrong_choice?: string | null
  }>
  conversation_examples: Array<{
    course_id: string
    course_title: string
    subject_name?: string | null
    class_label?: string | null
    conversation_id: string
    concept?: string | null
    student_name: string
    summary?: string | null
    source_type?: string | null
    focus_question?: string | null
    started_at?: string | null
    messages: Array<{
      role?: string
      content?: string
    }>
  }>
  llm_briefing: {
    executive_summary?: string
    misconceptions: Array<{
      concept: string
      pattern: string
      evidence?: string
    }>
    question_patterns: Array<{
      type: string
      example: string
      teacher_move?: string
    }>
    teaching_suggestions: string[]
    teacher_talk_track: string[]
  }
  intervention_recommendations: Array<{
    title: string
    reason: string
    actions: string[]
    course_id?: string
    course_title?: string
    subject_name?: string | null
  }>
}

export function fetchTeacherDashboardBriefing(teacherId: string) {
  return fetchJson<TeacherDashboardBriefing>(`/api/analytics/teacher/${teacherId}/overview`)
}
