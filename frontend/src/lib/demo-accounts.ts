export type DemoAccount = {
  id: string
  label: string
  role: 'teacher' | 'student'
  email: string
  password: string
  summary: string
  destination: string
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    id: 'teacher-demo',
    label: '김서윤 선생님 (도덕)',
    role: 'teacher',
    email: 'teacher01@socrateach.school',
    password: 'SocraTeachTeacher!2026',
    summary: '반 전체 분석, 자료 관리, 시험 출제, 개념 히트맵을 확인할 수 있는 교사 계정입니다.',
    destination: '/teacher/dashboard',
  },
  {
    id: 'student-demo',
    label: '강도윤 학생 (중1 1반)',
    role: 'student',
    email: 'student021@socrateach.school',
    password: 'SocraTeachStudent!2026',
    summary: '학생 대시보드, 시험 응시, AI 튜터 흐름을 체험할 수 있는 학생 계정입니다.',
    destination: '/student/dashboard',
  },
]

export function buildDemoLoginHref(account: DemoAccount) {
  const params = new URLSearchParams({
    email: account.email,
    password: account.password,
    role: account.role,
  })

  return `/auth/login?${params.toString()}`
}
