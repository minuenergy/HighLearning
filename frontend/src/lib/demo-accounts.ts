export const DEFAULT_SIMULATION_SLUG = 'sim-middle-2025-03-01'
export const DEFAULT_SIMULATION_PASSWORD = 'SocraTeachDemo!2026'

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
    label: '시뮬레이션 교사',
    role: 'teacher',
    email: `${DEFAULT_SIMULATION_SLUG}.teacher@sim.socrateach.local`,
    password: DEFAULT_SIMULATION_PASSWORD,
    summary: '반 전체 분석, 자료 관리, 개념 히트맵을 바로 확인할 수 있는 기본 교사 계정입니다.',
    destination: '/teacher/dashboard',
  },
  {
    id: 'student-demo',
    label: '시뮬레이션 학생',
    role: 'student',
    email: `${DEFAULT_SIMULATION_SLUG}.student01@sim.socrateach.local`,
    password: DEFAULT_SIMULATION_PASSWORD,
    summary: '학생 대시보드와 AI 튜터 흐름을 바로 체험할 수 있는 예시 학생 계정입니다.',
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
