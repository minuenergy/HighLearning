'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOpenText,
  ChartColumnBig,
  FileQuestion,
  GraduationCap,
  Home,
  LibraryBig,
  Menu,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  fetchWorkspaceProfile,
  updateWorkspaceProfile,
  type WorkspaceProfileBundle,
} from '@/lib/workspace-api'

type AppRole = 'teacher' | 'student'

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: Record<AppRole, NavItem[]> = {
  teacher: [
    { href: '/teacher/dashboard', label: 'Teacher Home', icon: Home },
    { href: '/teacher/verification', label: '승인 관리', icon: GraduationCap },
    { href: '/teacher/students', label: '학생 관리', icon: Users },
{ href: '/teacher/materials', label: '교재 관리', icon: LibraryBig },
    { href: '/teacher/exams', label: '시험지 제작', icon: FileQuestion },
  ],
  student: [
    { href: '/student/dashboard', label: 'Student Home', icon: Home },
    { href: '/student/performance', label: '시험 성적', icon: ChartColumnBig },
    { href: '/student/exams', label: '시험', icon: FileQuestion },
  ],
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function joinCsv(value: unknown) {
  return Array.isArray(value) ? value.join(', ') : ''
}

function buildDraft(role: AppRole, bundle: WorkspaceProfileBundle | null): Record<string, string> {
  if (!bundle) return {}

  if (role === 'teacher') {
    return {
      full_name: bundle.profile.full_name ?? '',
      phone_number: String(bundle.profile.phone_number ?? ''),
      school_name: String(bundle.settings.school_name ?? ''),
      school_email: String(bundle.settings.school_email ?? bundle.profile.email ?? ''),
      verification_method: String(bundle.settings.verification_method ?? 'school_email'),
      verification_status: String(bundle.settings.verification_status ?? 'pending'),
      subject_names: joinCsv(bundle.settings.subject_names),
      grade_levels: joinCsv(bundle.settings.grade_levels),
      class_labels: joinCsv(bundle.settings.class_labels),
    }
  }

  return {
    full_name: bundle.profile.full_name ?? '',
    phone_number: String(bundle.profile.phone_number ?? ''),
    student_number: String(bundle.settings.student_number ?? ''),
    class_label: String(bundle.settings.class_label ?? ''),
  }
}

function SettingsModal({
  open,
  role,
  bundle,
  saving,
  onClose,
  onSave,
  onLogout,
}: {
  open: boolean
  role: AppRole
  bundle: WorkspaceProfileBundle | null
  saving: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => buildDraft(role, bundle))

  if (!open || !bundle) return null

  const submit = async () => {
    const payload: Record<string, unknown> = {
      full_name: draft.full_name ?? '',
      phone_number: draft.phone_number ?? '',
    }

    if (role === 'teacher') {
      payload.school_name = draft.school_name ?? ''
      payload.school_email = draft.school_email ?? ''
      payload.verification_method = draft.verification_method ?? 'school_email'
      payload.verification_status = draft.verification_status ?? 'pending'
      payload.subject_names = splitCsv(draft.subject_names ?? '')
      payload.grade_levels = splitCsv(draft.grade_levels ?? '')
      payload.class_labels = splitCsv(draft.class_labels ?? '')
    } else {
      payload.student_number = draft.student_number ?? ''
      payload.class_label = draft.class_label ?? ''
    }

    await onSave(payload)
  }

  const fieldClass =
    'mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.24)]">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[linear-gradient(135deg,#fffaf0,#ffffff_45%,#eff6ff)] px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">Settings</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">
              {role === 'teacher' ? '교사 설정' : '학생 설정'}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              회원가입 이후에도 필요한 인증 방식에 맞춰 정보를 수정할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
            <h3 className="text-lg font-semibold text-slate-950">Individual Settings</h3>
            <p className="mt-1 text-sm text-slate-500">로그인 정보와 개인 연락처를 관리합니다.</p>

            <label className="mt-5 block text-sm font-medium text-slate-700">
              이름
              <input
                className={fieldClass}
                value={draft.full_name ?? ''}
                onChange={event => setDraft(prev => ({ ...prev, full_name: event.target.value }))}
                placeholder="홍길동"
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              이메일
              <input className={fieldClass} value={bundle.profile.email ?? ''} disabled />
            </label>

            <label className="mt-4 block text-sm font-medium text-slate-700">
              전화번호
              <input
                className={fieldClass}
                value={draft.phone_number ?? ''}
                onChange={event => setDraft(prev => ({ ...prev, phone_number: event.target.value }))}
                placeholder="010-1234-5678"
              />
            </label>
          </section>

          {role === 'teacher' ? (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5">
              <h3 className="text-lg font-semibold text-slate-950">Teaching Settings</h3>
              <p className="mt-1 text-sm text-slate-500">담당 학교, 과목, 학년, 반 정보를 관리합니다.</p>

              <label className="mt-5 block text-sm font-medium text-slate-700">
                학교명
                <input
                  className={fieldClass}
                  value={draft.school_name ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, school_name: event.target.value }))}
                  placeholder="소크라중학교"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                학교 이메일
                <input
                  className={fieldClass}
                  value={draft.school_email ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, school_email: event.target.value }))}
                  placeholder="teacher@school.kr"
                />
              </label>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  인증 방식
                  <select
                    className={fieldClass}
                    value={draft.verification_method ?? 'school_email'}
                    onChange={event => setDraft(prev => ({ ...prev, verification_method: event.target.value }))}
                  >
                    <option value="school_email">학교 이메일</option>
                    <option value="invite_code">초대 코드</option>
                    <option value="manual_review">수동 검토</option>
                  </select>
                </label>

                <label className="block text-sm font-medium text-slate-700">
                  인증 상태
                  <select
                    className={fieldClass}
                    value={draft.verification_status ?? 'pending'}
                    onChange={event => setDraft(prev => ({ ...prev, verification_status: event.target.value }))}
                  >
                    <option value="pending">검토 대기</option>
                    <option value="verified">인증 완료</option>
                    <option value="manual_review">수동 검토</option>
                  </select>
                </label>
              </div>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                담당 과목
                <input
                  className={fieldClass}
                  value={draft.subject_names ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, subject_names: event.target.value }))}
                  placeholder="수학, 과학"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                담당 학년
                <input
                  className={fieldClass}
                  value={draft.grade_levels ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, grade_levels: event.target.value }))}
                  placeholder="중1, 중2"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                담당 반
                <input
                  className={fieldClass}
                  value={draft.class_labels ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, class_labels: event.target.value }))}
                  placeholder="1반, 3반, 4반"
                />
              </label>
            </section>
          ) : (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5">
              <h3 className="text-lg font-semibold text-slate-950">Student Settings</h3>
              <p className="mt-1 text-sm text-slate-500">학번과 반 정보를 관리합니다.</p>

              <label className="mt-5 block text-sm font-medium text-slate-700">
                학번
                <input
                  className={fieldClass}
                  value={draft.student_number ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, student_number: event.target.value }))}
                  placeholder="12"
                />
              </label>

              <label className="mt-4 block text-sm font-medium text-slate-700">
                반 정보
                <input
                  className={fieldClass}
                  value={draft.class_label ?? ''}
                  onChange={event => setDraft(prev => ({ ...prev, class_label: event.target.value }))}
                  placeholder="2학년 3반"
                />
              </label>
            </section>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={() => void onLogout()}
            className="rounded-2xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50"
          >
            로그아웃
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarContent({
  role,
  expanded,
  pathname,
  bundle,
  onSettingsClick,
}: {
  role: AppRole
  expanded: boolean
  pathname: string
  bundle: WorkspaceProfileBundle | null
  onSettingsClick: () => void
}) {
  const navItems = NAV_ITEMS[role]

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#f59e0b,#f97316)] text-slate-950 shadow-lg shadow-amber-500/20">
            <Sparkles className="h-5 w-5" />
          </div>
          {expanded && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-200/80">SocraTeach</p>
              <h1 className="mt-1 text-lg font-semibold text-white">
                {role === 'teacher' ? 'Teacher Workspace' : 'Student Workspace'}
              </h1>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 py-4">
        {expanded && bundle && (
          <div className="rounded-[24px] border border-white/10 bg-white/6 px-4 py-4 text-white/90">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
              {role === 'teacher' ? '교사 프로필' : '학생 프로필'}
            </p>
            <p className="mt-3 text-base font-semibold text-white">{bundle.profile.full_name || '이름 없음'}</p>
            <p className="mt-1 text-sm text-white/55">{bundle.profile.email}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-2 px-3">
        {navItems.map(item => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-[22px] px-4 py-3 text-sm font-medium transition',
                active
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-white/72 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {expanded && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onSettingsClick}
          className="flex w-full items-center gap-3 rounded-[22px] border border-white/10 bg-white/6 px-4 py-3 text-sm font-medium text-white/85 transition hover:bg-white/10"
        >
          <Settings className="h-5 w-5 shrink-0" />
          {expanded && <span>설정</span>}
        </button>
      </div>
    </div>
  )
}

export default function WorkspaceShell({
  role,
  children,
}: {
  role: AppRole
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const [bundle, setBundle] = useState<WorkspaceProfileBundle | null>(null)
  const [userId, setUserId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const expanded = pinned || hovered

  useEffect(() => {
    let active = true

    async function loadBundle() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!active) return

      if (!user) {
        router.replace(`/auth/login?role=${role}`)
        return
      }

      setUserId(user.id)

      try {
        const nextBundle = await fetchWorkspaceProfile(user.id)
        if (!active) return
        setBundle(nextBundle)
      } catch {
        if (!active) return
        setBundle(null)
      }
    }

    void loadBundle()
    return () => {
      active = false
    }
  }, [role, router, supabase])

  const saveBundle = async (payload: Record<string, unknown>) => {
    if (!userId) return
    setSaving(true)
    try {
      const updated = await updateWorkspaceProfile(userId, payload)
      setBundle(updated)
      setSettingsOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace(`/auth/login?role=${role}`)
  }

  const contentPadding = expanded ? 'lg:pl-[18.5rem]' : 'lg:pl-[6.5rem]'

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.10),_transparent_20%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.12),_transparent_26%),linear-gradient(180deg,#fffdf8_0%,#f8fafc_45%,#f3f7fb_100%)]">
      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-white/12 bg-[linear-gradient(180deg,#0f172a,#172554_72%,#111827)] shadow-[0_28px_70px_rgba(15,23,42,0.24)] transition-all duration-300 lg:block',
          expanded ? 'w-[18.5rem]' : 'w-[6.5rem]',
        )}
      >
        <button
          type="button"
          onClick={() => setPinned(value => !value)}
          className="absolute right-3 top-3 rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-medium text-white/80 transition hover:bg-white/12"
        >
          {pinned ? '고정 해제' : '고정'}
        </button>
        <SidebarContent
          role={role}
          expanded={expanded}
          pathname={pathname}
          bundle={bundle}
          onSettingsClick={() => setSettingsOpen(true)}
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm lg:hidden">
          <div className="h-full w-[19rem] border-r border-white/10 bg-[linear-gradient(180deg,#0f172a,#172554_72%,#111827)] shadow-2xl">
            <div className="flex items-center justify-end p-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-2xl border border-white/10 bg-white/10 p-3 text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              role={role}
              expanded
              pathname={pathname}
              bundle={bundle}
              onSettingsClick={() => {
                setSettingsOpen(true)
                setMobileOpen(false)
              }}
            />
          </div>
        </div>
      )}

      <div className={cn('transition-all duration-300', contentPadding)}>
        <header className="sticky top-0 z-30 border-b border-white/60 bg-white/72 backdrop-blur">
          <div className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-600 shadow-sm lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex h-11 w-11 items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#f59e0b,#fb923c)] text-slate-950 shadow-lg shadow-amber-500/20">
                {role === 'teacher' ? <GraduationCap className="h-5 w-5" /> : <BookOpenText className="h-5 w-5" />}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-slate-400">
                  {role === 'teacher' ? 'Teacher Flow' : 'Student Flow'}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">
                  {bundle?.profile.full_name || (role === 'teacher' ? '교사 워크스페이스' : '학생 워크스페이스')}
                </h2>
              </div>
            </div>

          </div>
        </header>

        <main className="px-4 py-4 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <SettingsModal
        key={`${role}-${bundle?.profile.id ?? 'guest'}-${settingsOpen ? 'open' : 'closed'}`}
        open={settingsOpen}
        role={role}
        bundle={bundle}
        saving={saving}
        onClose={() => setSettingsOpen(false)}
        onSave={saveBundle}
        onLogout={handleLogout}
      />
    </div>
  )
}
