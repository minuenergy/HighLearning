import { createClient } from '@/lib/supabase'

export const DEMO_COURSE_ID = '00000000-0000-0000-0000-000000000001'

export type AccessibleCourse = {
  id: string
  title: string
  description: string | null
  created_at: string
  teacher_id: string | null
  subject_name?: string | null
}

type BrowserSupabaseClient = ReturnType<typeof createClient>

export async function listAccessibleCourses(supabase: BrowserSupabaseClient): Promise<AccessibleCourse[]> {
  const primaryQuery = () =>
    supabase
      .from('courses')
      .select('id, title, description, created_at, teacher_id, subject_name')
      .order('created_at', { ascending: false })

  const fallbackQuery = () =>
    supabase
      .from('courses')
      .select('id, title, description, created_at, teacher_id')
      .order('created_at', { ascending: false })

  const primaryResult = await primaryQuery()
  let data = (primaryResult.data ?? null) as AccessibleCourse[] | null
  let error = primaryResult.error

  if (error && `${error.message ?? ''}`.includes('subject_name')) {
    const fallbackResult = await fallbackQuery()
    data = (fallbackResult.data ?? null) as AccessibleCourse[] | null
    error = fallbackResult.error
  }

  if (error) {
    throw error
  }

  return data ?? []
}

export function pickAccessibleCourse(
  courses: AccessibleCourse[],
  requestedCourseId?: string | null
): AccessibleCourse | null {
  if (requestedCourseId) {
    const requestedCourse = courses.find(course => course.id === requestedCourseId)
    if (requestedCourse) {
      return requestedCourse
    }
  }

  return courses[0] ?? null
}
