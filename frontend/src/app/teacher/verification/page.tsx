'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import {
  CircleAlert,
  Clock3,
  Copy,
  GraduationCap,
  RefreshCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import { createClient } from '@/lib/supabase'
import {
  createTeacherInviteCode,
  fetchTeacherVerificationRequests,
  fetchWorkspaceProfile,
  listTeacherInviteCodes,
  updateTeacherVerificationRequest,
  type InviteCodeRecord,
  type TeacherVerificationRequest,
  type WorkspaceProfileBundle,
} from '@/lib/workspace-api'

type QueueFilter = 'open' | 'pending' | 'manual_review' | 'verified'

function formatDateTime(value?: string | null) {
  if (!value) return '정보 없음'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function joinList(value: unknown) {
  return Array.isArray(value) ? value.filter(Boolean).join(', ') : ''
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function resolveAdminFlag(bundle: WorkspaceProfileBundle | null) {
  return Boolean(bundle?.settings?.is_admin)
}

function verificationTone(status?: string | null) {
  if (status === 'verified') return 'bg-emerald-50 text-emerald-700'
  if (status === 'manual_review') return 'bg-amber-50 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}

function verificationLabel(status?: string | null) {
  if (status === 'verified') return '인증 완료'
  if (status === 'manual_review') return '수동 검토'
  return '검토 대기'
}

function InviteCard({ invite, onCopy }: { invite: InviteCodeRecord; onCopy: (value: string) => void }) {
  return (
    <article className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{invite.label || '교사 초대 코드'}</p>
          <p className="mt-2 font-mono text-lg font-black tracking-[0.08em] text-slate-950">{invite.code}</p>
        </div>
        <button
          type="button"
          onClick={() => onCopy(invite.code)}
          className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
        >
          <Copy className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-white px-3 py-1">사용 {invite.used_count}/{invite.max_uses}</span>
        <span className="rounded-full bg-white px-3 py-1">만료 {formatDateTime(invite.expires_at)}</span>
        <span className={`rounded-full px-3 py-1 font-semibold ${invite.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {invite.active ? '사용 가능' : '사용 종료'}
        </span>
      </div>
    </article>
  )
}

function VerificationQueueCard({
  request,
  note,
  onNoteChange,
  onDecision,
  busy,
}: {
  request: TeacherVerificationRequest
  note: string
  onNoteChange: (value: string) => void
  onDecision: (status: 'verified' | 'manual_review' | 'pending') => void
  busy: boolean
}) {
  return (
    <article className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${verificationTone(request.verification_status)}`}>
              {verificationLabel(request.verification_status)}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
              {request.verification_method === 'invite_code' ? '초대코드 가입' : '학교 이메일 가입'}
            </span>
          </div>
          <h3 className="mt-3 text-xl font-semibold text-slate-950">{request.full_name || request.email || '이름 미입력 교사'}</h3>
          <p className="mt-2 text-sm text-slate-500">{request.email || '이메일 정보 없음'}</p>
          <p className="mt-2 text-sm text-slate-600">
            {request.school_name || '학교명 미기입'}
            {request.school_email ? ` · ${request.school_email}` : ''}
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          <p>가입 시각 {formatDateTime(request.joined_at)}</p>
          <p className="mt-2">최근 업데이트 {formatDateTime(request.updated_at)}</p>
          {request.verified_at ? <p className="mt-2">승인 시각 {formatDateTime(request.verified_at)}</p> : null}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">담당 과목</p>
          <p className="mt-3 text-sm font-medium text-slate-900">{request.subject_names?.join(', ') || '미입력'}</p>
        </div>
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">담당 학년</p>
          <p className="mt-3 text-sm font-medium text-slate-900">{request.grade_levels?.join(', ') || '미입력'}</p>
        </div>
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">담당 반</p>
          <p className="mt-3 text-sm font-medium text-slate-900">{request.class_labels?.join(', ') || '미입력'}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
        <p className="text-sm font-semibold text-slate-900">승인 메모</p>
        <textarea
          value={note}
          onChange={event => onNoteChange(event.target.value)}
          className="mt-3 min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
          placeholder="승인 사유, 추가 확인 필요 항목, 내부 메모를 남겨주세요."
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onDecision('verified')}
            disabled={busy}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            승인 완료
          </button>
          <button
            type="button"
            onClick={() => onDecision('manual_review')}
            disabled={busy}
            className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:border-amber-300 disabled:opacity-60"
          >
            수동 검토로 이동
          </button>
          <button
            type="button"
            onClick={() => onDecision('pending')}
            disabled={busy}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
          >
            대기 상태로 유지
          </button>
        </div>
      </div>
    </article>
  )
}

function TeacherVerificationPageContent() {
  const supabase = useMemo(() => createClient(), [])
  const [teacherId, setTeacherId] = useState('')
  const [bundle, setBundle] = useState<WorkspaceProfileBundle | null>(null)
  const [inviteCodes, setInviteCodes] = useState<InviteCodeRecord[]>([])
  const [requests, setRequests] = useState<TeacherVerificationRequest[]>([])
  const [filter, setFilter] = useState<QueueFilter>('open')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [decisionTargetId, setDecisionTargetId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [inviteDraft, setInviteDraft] = useState({
    label: '',
    subject_names: '',
    max_uses: '5',
    expires_days: '30',
  })
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})

  const loadQueue = async (
    currentTeacherId: string,
    nextFilter: QueueFilter,
    currentBundle: WorkspaceProfileBundle | null = bundle,
  ) => {
    if (!resolveAdminFlag(currentBundle)) {
      setRequests([])
      setNoteDrafts({})
      return
    }
    const rows = await fetchTeacherVerificationRequests(currentTeacherId, { status: nextFilter })
    setRequests(rows)
    setNoteDrafts(prev => {
      const next: Record<string, string> = {}
      rows.forEach(row => {
        next[row.teacher_id] = prev[row.teacher_id] ?? row.verification_note ?? ''
      })
      return next
    })
  }

  const loadPage = async (nextFilter: QueueFilter, forceTeacherId?: string) => {
    const currentTeacherId = forceTeacherId || teacherId
    if (!currentTeacherId) return
    const [nextBundle, nextInviteCodes] = await Promise.all([
      fetchWorkspaceProfile(currentTeacherId),
      listTeacherInviteCodes(currentTeacherId, { role: 'teacher' }),
    ])
    setBundle(nextBundle)
    setInviteCodes(nextInviteCodes)
    await loadQueue(currentTeacherId, nextFilter, nextBundle)
  }

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return

        setTeacherId(user.id)
        const nextBundle = await fetchWorkspaceProfile(user.id)
        const [nextInviteCodes, nextRequests] = await Promise.all([
          listTeacherInviteCodes(user.id, { role: 'teacher' }),
          resolveAdminFlag(nextBundle)
            ? fetchTeacherVerificationRequests(user.id, { status: 'open' })
            : Promise.resolve([]),
        ])
        if (!active) return

        setBundle(nextBundle)
        setInviteCodes(nextInviteCodes)
        setRequests(nextRequests)
        setInviteDraft(prev => ({
          ...prev,
          label:
            prev.label ||
            `${String(nextBundle.settings.school_name ?? '').trim() || '우리 학교'} 교사 초대`,
          subject_names: prev.subject_names || joinList(nextBundle.settings.subject_names),
        }))
        setNoteDrafts(
          nextRequests.reduce<Record<string, string>>((acc, row) => {
            acc[row.teacher_id] = row.verification_note ?? ''
            return acc
          }, {}),
        )
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '승인 관리 화면을 불러오지 못했습니다.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [supabase])

  useEffect(() => {
    if (!teacherId || !resolveAdminFlag(bundle)) {
      setRequests([])
      return
    }
    let active = true

    async function refreshQueueByFilter() {
      try {
        setRefreshing(true)
        const rows = await fetchTeacherVerificationRequests(teacherId, { status: filter })
        if (!active) return
        setRequests(rows)
        setNoteDrafts(prev => {
          const next: Record<string, string> = {}
          rows.forEach(row => {
            next[row.teacher_id] = prev[row.teacher_id] ?? row.verification_note ?? ''
          })
          return next
        })
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : '승인 큐를 새로고침하지 못했습니다.')
      } finally {
        if (active) {
          setRefreshing(false)
        }
      }
    }

    void refreshQueueByFilter()
    return () => {
      active = false
    }
  }, [bundle, filter, teacherId])

  const activeInviteCount = inviteCodes.filter(code => code.active).length
  const pendingCount = requests.filter(item => item.verification_status === 'pending').length
  const manualReviewCount = requests.filter(item => item.verification_status === 'manual_review').length
  const myVerificationStatus = String(bundle?.settings.verification_status ?? 'pending')
  const myVerificationNote = String(bundle?.settings.verification_note ?? '')
  const isAdmin = resolveAdminFlag(bundle)

  const handleCreateInvite = async () => {
    if (!teacherId) return
    setCreatingInvite(true)
    setFeedback('')
    setError('')

    try {
      await createTeacherInviteCode(teacherId, {
        role: 'teacher',
        label: inviteDraft.label.trim() || '교사 초대 코드',
        subject_names: splitCsv(inviteDraft.subject_names),
        max_uses: Number(inviteDraft.max_uses) || 5,
        expires_days: Number(inviteDraft.expires_days) || 30,
      })
      const refreshed = await listTeacherInviteCodes(teacherId, { role: 'teacher' })
      setInviteCodes(refreshed)
      setFeedback('교사용 초대코드를 발급했습니다.')
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '교사용 초대코드 발급에 실패했습니다.')
    } finally {
      setCreatingInvite(false)
    }
  }

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setFeedback(`초대코드 ${value} 를 클립보드에 복사했습니다.`)
      setError('')
    } catch {
      setError('클립보드 복사에 실패했습니다.')
    }
  }

  const handleDecision = async (
    targetTeacherId: string,
    verificationStatus: 'verified' | 'manual_review' | 'pending',
  ) => {
    if (!teacherId) return
    setDecisionTargetId(targetTeacherId)
    setFeedback('')
    setError('')

    try {
      await updateTeacherVerificationRequest(teacherId, targetTeacherId, {
        verification_status: verificationStatus,
        verification_note: noteDrafts[targetTeacherId] ?? '',
      })
      await loadPage(filter, teacherId)
      setFeedback('교사 인증 상태를 업데이트했습니다.')
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : '교사 인증 상태 변경에 실패했습니다.')
    } finally {
      setDecisionTargetId(null)
    }
  }

  const handleRefresh = async () => {
    if (!teacherId) return
    try {
      setRefreshing(true)
      setFeedback('')
      setError('')
      await loadPage(filter, teacherId)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : '승인 관리 화면을 새로고침하지 못했습니다.')
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">승인 관리 화면을 준비하는 중입니다.</div>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eefbf3,#ffffff_46%,#eff6ff)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              <Sparkles className="h-3.5 w-3.5" />
              Teacher Verification
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">교사 승인과 초대코드를 한곳에서 관리합니다</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              최초 어드민 교사는 교사용 초대코드와 승인 큐를 관리하고, 일반 교사는 반 초대코드로 학생 가입만 운영합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </section>

      {(feedback || error) && (
        <div
          className={`rounded-2xl border px-4 py-4 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error || feedback}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">내 인증 상태</p>
          <p className="mt-4 text-2xl font-black text-slate-950">{verificationLabel(myVerificationStatus)}</p>
          <p className="mt-2 text-sm text-slate-500">{myVerificationNote || '현재 계정 인증 상태를 표시합니다.'}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">사용 가능한 초대코드</p>
          <p className="mt-4 text-4xl font-black text-blue-600">{activeInviteCount}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">대기 요청</p>
          <p className="mt-4 text-4xl font-black text-amber-600">{pendingCount}</p>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">수동 검토</p>
          <p className="mt-4 text-4xl font-black text-red-600">{manualReviewCount}</p>
        </div>
      </section>

      {myVerificationStatus !== 'verified' && (
        <section className="rounded-[28px] border border-amber-200 bg-amber-50/85 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-3 text-amber-700">
              <CircleAlert className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">현재 계정은 아직 최종 승인 전입니다</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                현재는 어드민 교사가 발급한 교사 초대코드 기반 가입을 기본 흐름으로 사용합니다. 초대코드 없이 가입한 계정은 운영자가 별도로 검토하기 전까지 제한될 수 있습니다.
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-950">교사 초대코드 발급</h2>
              <p className="mt-1 text-sm text-slate-500">어드민 교사만 동료 교사 가입용 초대코드를 발급할 수 있습니다.</p>
            </div>
          </div>

          {isAdmin ? (
            <>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">
                  코드 이름
                  <input
                    value={inviteDraft.label}
                    onChange={event => setInviteDraft(prev => ({ ...prev, label: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                    placeholder="소크라중학교 교사 초대"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  담당 과목
                  <input
                    value={inviteDraft.subject_names}
                    onChange={event => setInviteDraft(prev => ({ ...prev, subject_names: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                    placeholder="수학, 과학"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  허용 사용 수
                  <input
                    type="number"
                    min={1}
                    value={inviteDraft.max_uses}
                    onChange={event => setInviteDraft(prev => ({ ...prev, max_uses: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                  />
                </label>
                <label className="text-sm font-medium text-slate-700">
                  유효 기간(일)
                  <input
                    type="number"
                    min={1}
                    value={inviteDraft.expires_days}
                    onChange={event => setInviteDraft(prev => ({ ...prev, expires_days: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-300"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void handleCreateInvite()}
                disabled={creatingInvite}
                className="mt-5 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {creatingInvite ? '초대코드 발급 중...' : '교사용 초대코드 발급'}
              </button>
            </>
          ) : (
            <div className="mt-5 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm leading-6 text-slate-600">
              현재 계정은 일반 교사 권한입니다. 교사 초대코드 발급은 최초 어드민 교사 계정에서만 가능합니다.
            </div>
          )}

          <div className="mt-6 space-y-3">
            {inviteCodes.length === 0 && (
              <p className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                아직 발급된 교사용 초대코드가 없습니다.
              </p>
            )}
            {inviteCodes.map(code => (
              <InviteCard key={code.id} invite={code} onCopy={value => void handleCopy(value)} />
            ))}
          </div>
        </section>

        <section className="space-y-5">
          {!isAdmin && (
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">어드민 전용 운영 영역</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    교사 승인 큐와 교사용 초대코드는 최초 어드민 교사 계정에서만 관리됩니다.
                    현재 계정은 학생 초대코드 발급과 수업 운영 기능을 계속 사용할 수 있습니다.
                  </p>
                </div>
              </div>
            </section>
          )}

          {isAdmin && (
            <>
          <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">교사 승인 큐</h2>
                  <p className="mt-1 text-sm text-slate-500">같은 학교 범위로 묶인 교사 가입 요청만 보여줍니다.</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {(['open', 'pending', 'manual_review', 'verified'] as QueueFilter[]).map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      filter === item
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {item === 'open'
                      ? '열린 요청'
                      : item === 'pending'
                        ? '대기'
                        : item === 'manual_review'
                          ? '수동 검토'
                          : '승인 완료'}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {requests.length === 0 && (
            <section className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
              현재 필터에서 표시할 교사 승인 요청이 없습니다.
            </section>
          )}

          {requests.map(request => (
            <VerificationQueueCard
              key={request.teacher_id}
              request={request}
              note={noteDrafts[request.teacher_id] ?? ''}
              onNoteChange={value =>
                setNoteDrafts(prev => ({
                  ...prev,
                  [request.teacher_id]: value,
                }))
              }
              onDecision={status => void handleDecision(request.teacher_id, status)}
              busy={decisionTargetId === request.teacher_id}
            />
          ))}

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Clock3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">운영 원칙</h2>
                <p className="mt-1 text-sm text-slate-500">현재 구현 기준에서 교사 인증이 어떻게 동작하는지 정리했습니다.</p>
              </div>
            </div>

            <div className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
              <p className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                최초 어드민 교사 계정이 준비된 뒤부터는 교사 회원가입이 어드민 초대코드 기반으로 고정됩니다.
              </p>
              <p className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                기존 학교 이메일 가입 요청이나 운영자가 별도 확인이 필요한 건만 `수동 검토` 로 남겨두면 됩니다.
              </p>
              <p className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                교사 초대코드는 동료 교사 온보딩 전용이며, 학생 반 초대코드와 별도로 운영됩니다.
              </p>
            </div>
          </section>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default function TeacherVerificationPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <TeacherVerificationPageContent />
    </Suspense>
  )
}
