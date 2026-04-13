export function normalizeSubjectLabel(value?: string | null) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '')
    .trim()
}

export function extractCourseSubjectLabel(course?: { subject_name?: string | null; title?: string | null } | null) {
  const explicit = String(course?.subject_name ?? '').trim()
  if (explicit) return explicit

  const title = String(course?.title ?? '').trim()
  if (!title) return null

  const tokens = title.split(/\s+/).filter(Boolean)
  return tokens[tokens.length - 1] ?? title
}

export function subjectLabelsMatch(expected?: string | null, candidate?: string | null) {
  const normalizedExpected = normalizeSubjectLabel(expected)
  if (!normalizedExpected) return true

  const normalizedCandidate = normalizeSubjectLabel(candidate)
  if (!normalizedCandidate) return false

  return (
    normalizedCandidate.includes(normalizedExpected) ||
    normalizedExpected.includes(normalizedCandidate)
  )
}
