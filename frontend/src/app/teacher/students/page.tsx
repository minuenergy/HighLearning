'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BookOpenText,
  Brain,
  CircleAlert,
  Clock3,
  MessageSquareQuote,
  NotebookPen,
  Save,
  Sparkles,
  Users,
} from 'lucide-react'
import ScoreBarChart from '@/components/workspace/ScoreBarChart'
import { createClient } from '@/lib/supabase'
import {
  createTeacherInviteCode,
  fetchTeacherStudentDetail,
  fetchTeacherStudentsOverview,
  fetchTeacherSubjectsOverview,
  listTeacherInviteCodes,
  saveTeacherNote,
  type InviteCodeRecord,
  type TeacherStudentDetail,
  type TeacherStudentsOverview,
  type TeacherSubjectOverview,
} from '@/lib/workspace-api'

function getSupportSignalMeta(signal: TeacherStudentDetail['ai_analysis'][number]['support_signal']) {
  if (signal === 'intensive') {
    return {
      label: '집중 보강 필요',
      className: 'border-red-200 bg-red-50 text-red-700',
    }
  }
  if (signal === 'watch') {
    return {
      label: '관찰 필요',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }
  return {
    label: '안정',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
}

function StudentsPageContent() {
  const searchParams = useSearchParams()
  const requestedGroupId = searchParams.get('group')
  const supabase = useMemo(() => createClient(), [])
  const [teacherId, setTeacherId] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingNote, setSavingNote] = useState(false)
  const [overview, setOverview] = useState<TeacherStudentsOverview | null>(null)
  const [subjects, setSubjects] = useState<TeacherSubjectOverview | null>(null)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(requestedGroupId)
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null)
  const [detail, setDetail] = useState<TeacherStudentDetail | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [inviteCodes, setInviteCodes] = useState<InviteCodeRecord[]>([])
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return

        setTeacherId(user.id)
        const [nextOverview, nextSubjects] = await Promise.all([
          fetchTeacherStudentsOverview(user.id),
          fetchTeacherSubjectsOverview(user.id),
        ])
        if (!active) return

        setOverview(nextOverview)
        setSubjects(nextSubjects)

        const firstGroup = nextOverview.classes.find(group => group.id === requestedGroupId) ?? nextOverview.classes[0]
        if (firstGroup) {
          setSelectedGroupId(firstGroup.id)
          setSelectedStudentId(firstGroup.students[0]?.id ?? null)
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPage()
    return () => {
      active = false
    }
  }, [requestedGroupId, supabase])

  const groups = overview?.classes ?? []
  const selectedGroup = groups.find(group => group.id === selectedGroupId) ?? groups[0] ?? null
  const subjectItems = (subjects?.subjects ?? []).filter(subject =>
    subject.class_breakdown.some(item => item.group_id === selectedGroup?.id),
  )
  const activeSubject = subjectItems.find(subject => subject.subject === selectedSubject) ?? subjectItems[0] ?? null
  const activeClassSections =
    activeSubject?.class_sections.find(section => section.group_id === selectedGroup?.id)?.sections ?? []

  useEffect(() => {
    if (!selectedGroup) return
    setSelectedSubject(current => {
      if (current && subjectItems.some(subject => subject.subject === current)) {
        return current
      }
      return subjectItems[0]?.subject ?? null
    })
  }, [selectedGroupId, subjectItems, selectedGroup])

  useEffect(() => {
    if (!teacherId || !selectedGroup) {
      setInviteCodes([])
      return
    }

    let active = true

    async function loadInviteCodes() {
      const rows = await listTeacherInviteCodes(teacherId, {
        role: 'student',
        course_id: selectedGroup.scope_type === 'course' ? selectedGroup.course_ids[0] : null,
        school_class_id: selectedGroup.scope_type === 'school_class' ? selectedGroup.id : null,
      })
      if (!active) return
      setInviteCodes(rows)
    }

    void loadInviteCodes()
    return () => {
      active = false
    }
  }, [selectedGroup, teacherId])

  useEffect(() => {
    if (!teacherId || !selectedGroup || !selectedStudentId) {
      setDetail(null)
      return
    }

    let active = true
    const studentId = selectedStudentId
    const groupId = selectedGroup.id

    async function loadDetail() {
      const nextDetail = await fetchTeacherStudentDetail(teacherId, studentId, groupId)
      if (!active) return
      setDetail(nextDetail)
      setNoteDraft(nextDetail.note ?? '')
    }

    void loadDetail()
    return () => {
      active = false
    }
  }, [selectedGroup, selectedStudentId, teacherId])

  const saveNoteForStudent = async () => {
    if (!teacherId || !selectedStudentId || !selectedGroup) return

    setSavingNote(true)
    try {
      await saveTeacherNote(teacherId, selectedStudentId, {
        note: noteDraft,
        ...(selectedGroup.scope_type === 'school_class'
          ? { school_class_id: selectedGroup.id }
          : { course_id: selectedGroup.course_ids[0] }),
      })

      const refreshed = await fetchTeacherStudentDetail(teacherId, selectedStudentId, selectedGroup.id)
      setDetail(refreshed)
      setNoteDraft(refreshed.note ?? '')
    } finally {
      setSavingNote(false)
    }
  }

  const createInviteForGroup = async () => {
    if (!teacherId || !selectedGroup) return

    setCreatingInvite(true)
    setFeedback('')
    setError('')
    try {
      await createTeacherInviteCode(teacherId, {
        label: selectedGroup.title,
        course_id: selectedGroup.scope_type === 'course' ? selectedGroup.course_ids[0] : null,
        school_class_id: selectedGroup.scope_type === 'school_class' ? selectedGroup.id : null,
        subject_names: selectedGroup.subject_labels,
        max_uses: Math.max(selectedGroup.student_count + 5, 10),
        expires_days: 60,
      })

      const refreshed = await listTeacherInviteCodes(teacherId, {
        role: 'student',
        course_id: selectedGroup.scope_type === 'course' ? selectedGroup.course_ids[0] : null,
        school_class_id: selectedGroup.scope_type === 'school_class' ? selectedGroup.id : null,
      })
      setInviteCodes(refreshed)
      setFeedback('이 반의 학생 초대코드를 발급했습니다.')
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : '학생 초대코드 발급에 실패했습니다.')
    } finally {
      setCreatingInvite(false)
    }
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">학생 관리 화면을 준비하는 중입니다.</div>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eefbf3,#ffffff_48%,#eff6ff)] p-6 shadow-sm">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" />
            Student Management
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">반별 학생 관리와 AI 튜터 분석</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            왼쪽에서 반을 고르고, 가운데에서 반 진도를 보고, 오른쪽에서 개별 학생 메모와 이해 상태를 확인할 수 있습니다.
          </p>
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

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <aside className="space-y-4">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">담당 반</h2>
                <p className="mt-1 text-sm text-slate-500">특정 반을 누르면 해당 반 페이지가 열립니다.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {groups.map(group => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    setSelectedGroupId(group.id)
                    setSelectedStudentId(group.students[0]?.id ?? null)
                  }}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    selectedGroup?.id === group.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-semibold">{group.title}</p>
                  <p className={`mt-2 text-xs ${selectedGroup?.id === group.id ? 'text-white/70' : 'text-slate-500'}`}>
                    {group.student_count}명 · {group.subject_labels.join(', ')}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">반 초대 코드</h2>
                <p className="mt-1 text-sm text-slate-500">학생 회원가입에서 사용하는 실제 반 초대코드를 발급합니다.</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void createInviteForGroup()}
              disabled={!selectedGroup || creatingInvite}
              className="mt-5 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {creatingInvite ? '초대 코드 생성 중...' : '이 반 초대 코드 생성'}
            </button>

            <div className="mt-4 space-y-3">
              {inviteCodes.length === 0 && (
                <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                  아직 발급된 초대 코드가 없습니다.
                </p>
              )}

              {inviteCodes.slice(0, 3).map(code => (
                <article key={code.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">{code.code}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    사용 {code.used_count}/{code.max_uses}
                    {code.expires_at ? ` · 만료 ${new Date(code.expires_at).toLocaleDateString('ko-KR')}` : ''}
                  </p>
                  <p className={`mt-2 text-xs font-medium ${code.active ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {code.active ? '사용 가능' : '만료 또는 사용 완료'}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-5">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <BookOpenText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{selectedGroup?.title ?? '반 선택 필요'}</h2>
                <p className="mt-1 text-sm text-slate-500">반 진도 사항 버튼 역할을 하는 영역입니다. 과목을 골라 반 평균 흐름을 봅니다.</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {subjectItems.map(subject => (
                <button
                  key={subject.subject}
                  type="button"
                  onClick={() => setSelectedSubject(subject.subject)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeSubject?.subject === subject.subject
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {subject.subject}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <ScoreBarChart
                title={activeSubject ? `${activeSubject.subject} 목차별 평균 시험 성적` : '과목을 선택해주세요'}
                caption="최초 시험 점수를 기준으로 반 전체의 목차별 평균을 표시합니다."
                items={activeClassSections.map(section => ({
                  label: section.section,
                  value: section.average_score,
                  meta: `${section.question_count}문항`,
                }))}
                accent="blue"
                emptyMessage="선택한 반에 대한 과목별 목차 데이터가 아직 없습니다."
              />
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{selectedGroup?.title ?? '학생 목록'}</h2>
                <p className="mt-1 text-sm text-slate-500">학생을 클릭하면 OOO 학생 관리 페이지 역할의 상세 화면이 열립니다.</p>
              </div>
            </div>

            <div className="mt-5 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
              {selectedGroup?.students.map((student, index) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => setSelectedStudentId(student.id)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    selectedStudentId === student.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}번 · {student.full_name}
                    </p>
                    <span className="text-xs text-slate-400">
                      {student.average_first_score === null || student.average_first_score === undefined
                        ? '미집계'
                        : `${student.average_first_score.toFixed(1)}점`}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    보강 필요 {student.needs_support_count}개 · 이해 완료 {student.mastered_count}개
                  </p>
                  {student.note_preview && <p className="mt-2 text-xs text-slate-400">{student.note_preview}</p>}
                </button>
              ))}
            </div>
          </section>
        </section>

        <section className="space-y-5">
          {!detail && (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
              학생을 선택하면 개별 관리 화면이 나타납니다.
            </div>
          )}

          {detail && (
            <>
              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                    <NotebookPen className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{detail.student.full_name} 학생 관리</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {detail.student.class_label || detail.group.title}
                      {detail.student.student_number ? ` · ${detail.student.student_number}번` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">최초 평균</p>
                    <p className="mt-3 text-3xl font-black text-slate-950">
                      {detail.summary.average_first_score?.toFixed(1) ?? '미집계'}
                    </p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">보강 필요 개념</p>
                    <p className="mt-3 text-3xl font-black text-red-600">{detail.summary.needs_support_count}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">최근 튜터 대화</p>
                    <p className="mt-3 text-3xl font-black text-blue-600">{detail.summary.recent_conversation_count}</p>
                  </div>
                </div>

                <label className="mt-5 block">
                  <span className="text-sm font-medium text-slate-700">교사 메모</span>
                  <textarea
                    value={noteDraft}
                    onChange={event => setNoteDraft(event.target.value)}
                    rows={6}
                    className="mt-2 w-full rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-300"
                    placeholder="이 학생에 대한 관찰, 보강 계획, 수업 메모를 남겨두세요."
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void saveNoteForStudent()}
                  disabled={savingNote}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {savingNote ? '저장 중...' : '메모 저장'}
                </button>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#eff6ff,#ffffff_46%,#f0fdf4)] p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">학생 개별 Gemini 브리핑</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      반 전체 공통 어려움과 강점, 그리고 이 학생에게만 남아 있는 미해결 개념만 간단히 보여줍니다.
                    </p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Executive Summary</p>
                    <p className="mt-3 text-sm leading-7 text-slate-700">
                      {detail.llm_briefing.executive_summary || '최근 대화가 더 쌓이면 학생별 브리핑이 여기 정리됩니다.'}
                    </p>
                  </section>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <section className="rounded-[24px] border border-rose-100 bg-rose-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">반 전체가 공통적으로 어려워한 개념</p>
                      <div className="mt-3 space-y-3">
                        {detail.llm_briefing.class_difficult_concepts.length === 0 && (
                          <p className="text-sm text-rose-400">공통 어려움 신호가 아직 충분하지 않습니다.</p>
                        )}
                        {detail.llm_briefing.class_difficult_concepts.map(item => (
                          <article key={item.label} className="rounded-[18px] border border-rose-100 bg-white/90 px-4 py-3">
                            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              최초 평균 {item.average_first_score?.toFixed(1) ?? '미집계'}점 · {item.student_count}명 공통 · {item.question_count}문항
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-emerald-100 bg-emerald-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">반 전체가 비교적 잘한 개념</p>
                      <div className="mt-3 space-y-3">
                        {detail.llm_briefing.class_strong_concepts.length === 0 && (
                          <p className="text-sm text-emerald-500">공통 강점 신호가 아직 충분하지 않습니다.</p>
                        )}
                        {detail.llm_briefing.class_strong_concepts.map(item => (
                          <article key={item.label} className="rounded-[18px] border border-emerald-100 bg-white/90 px-4 py-3">
                            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                            <p className="mt-2 text-xs leading-5 text-slate-500">
                              최초 평균 {item.average_first_score?.toFixed(1) ?? '미집계'}점 · {item.student_count}명 공통 · {item.question_count}문항
                            </p>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-amber-100 bg-amber-50/80 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">이 학생에게만 남아 있는 미해결 개념</p>
                      <div className="mt-3 space-y-3">
                        {detail.llm_briefing.unresolved_concepts.length === 0 && (
                          <p className="text-sm text-amber-600">현재는 별도로 남아 있는 미해결 개념 신호가 보이지 않습니다.</p>
                        )}
                        {detail.llm_briefing.unresolved_concepts.map(item => (
                          <article key={`${item.subject}-${item.label}`} className="rounded-[18px] border border-amber-100 bg-white/90 px-4 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                                {item.subject}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{item.reason}</p>
                            {item.unresolved_question_count > 0 && (
                              <p className="mt-2 text-xs leading-5 text-amber-700">
                                아직 풀리지 않은 최초 오답 문항 {item.unresolved_question_count}개
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </section>

              <ScoreBarChart
                title="학생의 교과별 평균 시험 성적"
                caption="과목별로 최초 시험 평균 점수를 동일한 막대그래프 형식으로 보여줍니다."
                items={detail.subject_scores.map(subject => ({
                  label: subject.subject,
                  value: subject.average_score,
                  meta: `${subject.question_count}문항 · 복기 후 해결 ${subject.resolved_after_review_count}개`,
                }))}
                accent="emerald"
                emptyMessage="이 학생의 과목별 시험 데이터가 아직 없습니다."
              />

              {detail.subject_scores.map(subject => (
                <ScoreBarChart
                  key={subject.subject}
                  title={`${subject.subject} 목차별 성적`}
                  caption="목차 순서별 성적을 확인하고, 낮은 단원부터 복기 흐름을 잡을 수 있습니다."
                  items={subject.sections.map(section => ({
                    label: section.section,
                    value: section.average_score,
                    meta: `${section.question_count}문항`,
                  }))}
                  accent="blue"
                  emptyMessage="목차별 세부 데이터가 아직 없습니다."
                />
              ))}

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">AI 튜터 분석</h2>
                    <p className="mt-1 text-sm text-slate-500">대화 히스토리를 바탕으로 현재 이해한 개념과 헷갈리는 개념을 정리합니다.</p>
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  {detail.ai_analysis.map(analysis => (
                    <article key={analysis.subject} className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-base font-semibold text-slate-900">{analysis.subject}</h3>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-500">
                            대화 {analysis.conversation_count}건
                          </span>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${getSupportSignalMeta(analysis.support_signal).className}`}
                          >
                            {getSupportSignalMeta(analysis.support_signal).label}
                          </span>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">이해한 개념</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {analysis.understood_concepts.length === 0 && <span className="text-sm text-slate-400">아직 없음</span>}
                            {analysis.understood_concepts.map(item => (
                              <span key={item} className="rounded-full bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-700">헷갈리는 개념</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {analysis.confusing_concepts.length === 0 && <span className="text-sm text-slate-400">아직 없음</span>}
                            {analysis.confusing_concepts.map(item => (
                              <span key={item} className="rounded-full bg-red-50 px-3 py-2 text-sm text-red-700">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-500">반복 오개념</p>
                          <div className="mt-2 space-y-2">
                            {analysis.repeated_misconceptions.length === 0 && (
                              <p className="text-sm text-slate-400">아직 원문 패턴이 충분하지 않습니다.</p>
                            )}
                            {analysis.repeated_misconceptions.map(item => (
                              <p key={item} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                                <CircleAlert className="mr-2 inline h-4 w-4 text-rose-400" />
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">대화 패턴</p>
                          <div className="mt-2 space-y-2">
                            {analysis.conversation_patterns.length === 0 && (
                              <p className="text-sm text-slate-400">분석할 대화가 아직 많지 않습니다.</p>
                            )}
                            {analysis.conversation_patterns.map(pattern => (
                              <p key={pattern} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                                <MessageSquareQuote className="mr-2 inline h-4 w-4 text-slate-400" />
                                {pattern}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">잘 반응한 질문 방식</p>
                          <div className="mt-2 space-y-2">
                            {analysis.helpful_prompt_styles.length === 0 && (
                              <p className="text-sm text-slate-400">아직 추천할 질문 방식이 많지 않습니다.</p>
                            )}
                            {analysis.helpful_prompt_styles.map(item => (
                              <p key={item} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                                {item}
                              </p>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">보강 수업 추천 문장</p>
                          <div className="mt-2 space-y-2">
                            {analysis.teaching_tips.map(tip => (
                              <p key={tip} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                                {tip}
                              </p>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">원문 하이라이트</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {analysis.transcript_highlights.length === 0 && (
                            <p className="text-sm text-slate-400">최근 원문 대화가 아직 충분하지 않습니다.</p>
                          )}
                          {analysis.transcript_highlights.map(item => (
                            <p key={item} className="rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                              <MessageSquareQuote className="mr-2 inline h-4 w-4 text-slate-400" />
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">최근 튜터 대화</h2>
                    <p className="mt-1 text-sm text-slate-500">교사가 바로 맥락을 읽을 수 있도록 최근 세션 핵심 문장을 붙였습니다.</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {detail.recent_conversations.length === 0 && (
                    <p className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">
                      아직 저장된 튜터 대화가 없습니다.
                    </p>
                  )}
                  {detail.recent_conversations.map(conversation => (
                    <article key={conversation.id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{conversation.concept_tag || '개념 학습'}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {conversation.source_type === 'exam_review' ? '오답 복기' : '튜터 세션'} · 메시지 {conversation.message_count ?? 0}개
                          </p>
                        </div>
                        <p className="text-xs text-slate-400">
                          {conversation.ended_at ? new Date(conversation.ended_at).toLocaleString('ko-KR') : '시간 정보 없음'}
                        </p>
                      </div>
                      {(conversation.focus_question || conversation.summary) && (
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          {conversation.focus_question || conversation.summary}
                        </p>
                      )}
                      {conversation.preview && (
                        <p className="mt-3 rounded-2xl border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                          <MessageSquareQuote className="mr-2 inline h-4 w-4 text-slate-400" />
                          {conversation.preview}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default function TeacherStudentsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <StudentsPageContent />
    </Suspense>
  )
}
