'use client'

import { type AccessibleCourse } from '@/lib/course-access'

type Props = {
  courses: AccessibleCourse[]
  selectedCourseId: string | null
  label?: string
}

export default function CoursePicker({
  courses,
  selectedCourseId,
  label = '학습 반 선택',
}: Props) {
  if (courses.length === 0) {
    return null
  }

  const resolvedCourseId = selectedCourseId ?? courses[0]?.id ?? ''

  const handleChange = (nextCourseId: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('course', nextCourseId)
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
          <p className="mt-1 text-sm text-slate-500">
            현재 계정이 접근 가능한 반 중에서 바로 전환할 수 있습니다.
          </p>
        </div>
        <div className="min-w-[240px]">
          <select
            value={resolvedCourseId}
            onChange={event => handleChange(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white"
          >
            {courses.map(course => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
