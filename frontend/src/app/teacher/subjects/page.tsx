'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Brain,
  BookOpenText,
  CircleAlert,
  MessageSquareQuote,
  School,
  Sparkles,
  Target,
} from 'lucide-react'
import ScoreBarChart from '@/components/workspace/ScoreBarChart'
import { createClient } from '@/lib/supabase'
import {
  fetchTeacherSubjectBriefing,
  fetchTeacherSubjectsOverview,
  type TeacherSubjectBriefing,
  type TeacherSubjectOverview,
} from '@/lib/workspace-api'

function SubjectsPageContent() {
  const searchParams = useSearchParams()
  const requestedSubject = searchParams.get('subject')
  const supabase = useMemo(() => createClient(), [])
  const [teacherId, setTeacherId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [overview, setOverview] = useState<TeacherSubjectOverview | null>(null)
  const [selectedSubject, setSelectedSubject] = useState<string | null>(requestedSubject)
  const [subjectBriefing, setSubjectBriefing] = useState<TeacherSubjectBriefing | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [briefingError, setBriefingError] = useState('')

  useEffect(() => {
    let active = true

    async function loadPage() {
      try {
        setError('')
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || !active) return
        setTeacherId(user.id)

        const nextOverview = await fetchTeacherSubjectsOverview(user.id)
        if (!active) return
        setOverview(nextOverview)

        const firstSubject =
          nextOverview.subjects.find(subject => subject.subject === requestedSubject)?.subject ??
          nextOverview.subjects[0]?.subject ??
          null
        setSelectedSubject(firstSubject)
      } catch (error) {
        if (!active) return
        setOverview(null)
        setSelectedSubject(null)
        setError(error instanceof Error ? error.message : '과목 관리 데이터를 불러오지 못했습니다.')
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
  }, [requestedSubject, supabase])

  const subjects = overview?.subjects ?? []
  const subject = subjects.find(item => item.subject === selectedSubject) ?? subjects[0] ?? null

  useEffect(() => {
    if (!teacherId || !subject?.subject) {
      setSubjectBriefing(null)
      return
    }

    let active = true

    async function loadBriefing() {
      setBriefingLoading(true)
      setBriefingError('')
      try {
        const nextBriefing = await fetchTeacherSubjectBriefing(teacherId, subject.subject)
        if (!active) return
        setSubjectBriefing(nextBriefing)
      } catch (loadError) {
        if (!active) return
        setSubjectBriefing(null)
        setBriefingError(loadError instanceof Error ? loadError.message : '과목 브리핑을 불러오지 못했습니다.')
      } finally {
        if (active) {
          setBriefingLoading(false)
        }
      }
    }

    void loadBriefing()
    return () => {
      active = false
    }
  }, [subject?.subject, teacherId])

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-slate-400">과목 관리 화면을 준비하는 중입니다.</div>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[36px] border border-slate-200 bg-[linear-gradient(135deg,#eff6ff,#ffffff_48%,#ecfeff)] p-6 shadow-sm">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">
            <Sparkles className="h-3.5 w-3.5" />
            Subject Management
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">담당 과목별 성적과 반별 편차를 관리합니다</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            모든 점수는 같은 양식의 막대그래프로 통일해서 보고, 과목 전체 평균과 반별 차이를 함께 확인할 수 있습니다.
          </p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                <BookOpenText className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">담당 과목</h2>
                <p className="mt-1 text-sm text-slate-500">과목을 클릭하면 상세 분석이 바뀝니다.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {subjects.map(item => (
                <button
                  key={item.subject}
                  type="button"
                  onClick={() => setSelectedSubject(item.subject)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    subject?.subject === item.subject
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <p className="text-sm font-semibold">{item.subject}</p>
                  <p className={`mt-2 text-xs ${subject?.subject === item.subject ? 'text-white/70' : 'text-slate-500'}`}>
                    최초 평균 {item.average_first_score ?? '미집계'}점
                  </p>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-5">
          {error && (
            <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm leading-6 text-rose-700 shadow-sm">
              {error}
            </div>
          )}

          {!subject && (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-sm">
              {error ? '서버 연결이 복구되면 과목 데이터를 다시 불러올 수 있습니다.' : '표시할 과목 데이터가 없습니다.'}
            </div>
          )}

          {subject && (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">최초 평균</p>
                  <p className="mt-4 text-4xl font-black text-slate-950">{subject.average_first_score ?? '미집계'}</p>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">반 수</p>
                  <p className="mt-4 text-4xl font-black text-blue-600">{subject.course_count}</p>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">학생 수</p>
                  <p className="mt-4 text-4xl font-black text-emerald-600">{subject.student_count}</p>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">튜터 대화</p>
                  <p className="mt-4 text-4xl font-black text-amber-600">{subject.conversation_count}</p>
                </div>
              </section>

              <ScoreBarChart
                title={`${subject.subject} 목차별 시험 점수`}
                caption="목차별 최초 시험 평균을 같은 형식의 그래프로 확인합니다."
                items={subject.sections.map(section => ({
                  label: section.section,
                  value: section.average_score,
                  meta: `${section.question_count}문항`,
                }))}
                accent="blue"
                emptyMessage="목차별 성적 데이터가 없습니다."
              />

              <ScoreBarChart
                title="반별 조회"
                caption="같은 과목이라도 반마다 차이가 어떻게 나는지 바로 확인할 수 있습니다."
                items={subject.class_breakdown.map(item => ({
                  label: item.title,
                  value: item.average_score,
                }))}
                accent="emerald"
                emptyMessage="반별 비교 데이터가 아직 없습니다."
              />

              <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#eff6ff,#ffffff_48%,#fefce8)] p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                    <Brain className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">과목별 Gemini 브리핑</h2>
                    <p className="mt-1 text-sm text-slate-500">시험 결과와 튜터 대화를 함께 읽고, 다음 수업에서 어디를 먼저 다룰지 정리합니다.</p>
                  </div>
                </div>

                {briefingError && (
                  <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {briefingError}
                  </div>
                )}

                <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
                  <div className="space-y-4">
                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Executive Summary</p>
                      <p className="mt-3 text-sm leading-7 text-slate-700">
                        {briefingLoading
                          ? 'Gemini 브리핑을 정리하는 중입니다.'
                          : subjectBriefing?.executive_summary || '과목 브리핑 데이터가 아직 충분하지 않습니다.'}
                      </p>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">우선 단원</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {briefingLoading && <span className="text-sm text-slate-400">정리 중...</span>}
                        {!briefingLoading && (subjectBriefing?.priority_sections?.length ?? 0) === 0 && (
                          <span className="text-sm text-slate-400">우선 단원 신호가 아직 충분하지 않습니다.</span>
                        )}
                        {subjectBriefing?.priority_sections.map(item => (
                          <span key={item} className="rounded-full bg-blue-50 px-3 py-2 text-sm text-blue-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">교사용 액션</p>
                      <div className="mt-3 space-y-2">
                        {briefingLoading && <p className="text-sm text-slate-400">정리 중...</p>}
                        {!briefingLoading && (subjectBriefing?.teacher_actions?.length ?? 0) === 0 && (
                          <p className="text-sm text-slate-400">아직 제안할 수업 액션이 충분하지 않습니다.</p>
                        )}
                        {subjectBriefing?.teacher_actions.map(item => (
                          <p key={item} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                            {item}
                          </p>
                        ))}
                      </div>
                    </section>
                  </div>

                  <div className="space-y-4">
                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2">
                        <MessageSquareQuote className="h-4 w-4 text-slate-400" />
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">질문 패턴</p>
                      </div>
                      <div className="mt-3 space-y-3">
                        {briefingLoading && <p className="text-sm text-slate-400">정리 중...</p>}
                        {!briefingLoading && (subjectBriefing?.question_patterns?.length ?? 0) === 0 && (
                          <p className="text-sm text-slate-400">질문 패턴 브리핑이 아직 없습니다.</p>
                        )}
                        {subjectBriefing?.question_patterns.map(pattern => (
                          <article key={`${pattern.type}-${pattern.example}`} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-sm font-semibold text-slate-900">{pattern.type}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{pattern.example}</p>
                            <p className="mt-2 text-xs leading-5 text-blue-700">교사 대응: {pattern.teacher_move}</p>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">오개념 근거</p>
                      <div className="mt-3 space-y-3">
                        {briefingLoading && <p className="text-sm text-slate-400">정리 중...</p>}
                        {!briefingLoading && (subjectBriefing?.misconceptions?.length ?? 0) === 0 && (
                          <p className="text-sm text-slate-400">대화 근거 기반 오개념이 아직 충분하지 않습니다.</p>
                        )}
                        {subjectBriefing?.misconceptions.map(item => (
                          <article key={`${item.concept}-${item.pattern}`} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-sm font-semibold text-slate-900">{item.concept || '개념 미분류'}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{item.pattern}</p>
                            {item.evidence && <p className="mt-2 text-xs leading-5 text-slate-400">근거: {item.evidence}</p>}
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">교사용 말하기 스크립트</p>
                      <div className="mt-3 space-y-2">
                        {briefingLoading && <p className="text-sm text-slate-400">정리 중...</p>}
                        {!briefingLoading && (subjectBriefing?.teacher_talk_track?.length ?? 0) === 0 && (
                          <p className="text-sm text-slate-400">수업 스크립트 초안이 아직 없습니다.</p>
                        )}
                        {subjectBriefing?.teacher_talk_track.map(item => (
                          <p key={item} className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                            {item}
                          </p>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                    <CircleAlert className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">가장 어려운 문항</h2>
                    <p className="mt-1 text-sm text-slate-500">오답률이 높았던 문항부터 수업에서 다시 다루기 좋습니다.</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {subject.hardest_questions.map(question => (
                    <article key={question.question_id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-sm font-semibold text-slate-900">
                        {question.exam_title} · {question.question_order}번
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{question.prompt}</p>
                      <p className="mt-3 text-xs text-slate-400">정답률 {question.accuracy_rate ?? '미집계'}점</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                        <School className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-slate-950">반별 세부 메모</h2>
                        <p className="mt-1 text-sm text-slate-500">각 반에서 어느 단원이 특히 약한지 빠르게 훑습니다.</p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-3">
                      {subject.class_sections.map(item => (
                        <article key={item.group_id} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <p className="mt-2 text-sm text-slate-500">
                            가장 낮은 목차: {item.sections[0]?.section ?? '없음'} · 평균 {item.sections[0]?.average_score ?? '미집계'}점
                          </p>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-rose-50 p-3 text-rose-700">
                          <Brain className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-slate-950">공통 혼동 패턴</h2>
                          <p className="mt-1 text-sm text-slate-500">튜터 대화 원문에서 공통으로 반복된 흐름입니다.</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {subject.common_confusions.length === 0 && <span className="text-sm text-slate-400">아직 원문 패턴이 충분하지 않습니다.</span>}
                        {subject.common_confusions.map(item => (
                          <span key={item} className="rounded-full bg-white px-3 py-2 text-sm text-rose-700 shadow-sm ring-1 ring-rose-100">
                            {item}
                          </span>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                          <MessageSquareQuote className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-slate-950">질문 방식 추천</h2>
                          <p className="mt-1 text-sm text-slate-500">복기 대화에서 자주 쓰인 질문 방식을 요약했습니다.</p>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {subject.helpful_prompt_styles.length === 0 && (
                          <p className="rounded-[18px] border border-white bg-white px-4 py-3 text-sm text-slate-400">
                            아직 추천할 질문 방식이 충분하지 않습니다.
                          </p>
                        )}
                        {subject.helpful_prompt_styles.map(item => (
                          <p key={item} className="rounded-[18px] border border-white bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                            {item}
                          </p>
                        ))}
                      </div>
                    </section>

                    <section className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                          <Target className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-slate-950">교사 추천 문장</h2>
                          <p className="mt-1 text-sm text-slate-500">보강 수업에서 바로 말할 수 있는 문장과 대화 패턴입니다.</p>
                        </div>
                      </div>

                      <div className="mt-4 space-y-3">
                        {subject.teaching_signals.map(signal => (
                          <p key={signal} className="rounded-[22px] border border-white bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                            {signal}
                          </p>
                        ))}
                        {subject.conversation_patterns.map(pattern => (
                          <p key={pattern} className="rounded-[22px] border border-white bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                            <MessageSquareQuote className="mr-2 inline h-4 w-4 text-slate-400" />
                            {pattern}
                          </p>
                        ))}
                      </div>
                    </section>
                  </div>
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default function TeacherSubjectsPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center text-slate-400">로딩 중...</div>}>
      <SubjectsPageContent />
    </Suspense>
  )
}
