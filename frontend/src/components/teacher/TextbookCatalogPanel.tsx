'use client'

import Image from 'next/image'
import { BookOpenText, DatabaseZap, RefreshCw, Rows3, ScanSearch } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getApiUrl } from '@/lib/api'
import {
  backfillTextbookCatalog,
  buildCatalogSectionKey,
  fetchTextbookCatalog,
  fetchTextbookCatalogDetail,
  syncTextbookCatalog,
  type TextbookCatalogDetail,
  type TextbookCatalogItem,
} from '@/lib/textbook-catalog-api'
import { subjectLabelsMatch } from '@/lib/subject-utils'

type TextbookCatalogPanelProps = {
  activeTextbookSlug?: string | null
  activeSectionTitle?: string | null
  visibleSubjectLabel?: string | null
  draftCountBySectionKey: Record<string, number>
  onSelectMatchingDraft: (scope: {
    subjectLabel: string
    textbookKey: string
    sectionTitle: string
  }) => void
}

function formatDateTime(value?: string | null) {
  if (!value) return '동기화 전'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function TextbookCatalogPanel({
  activeTextbookSlug,
  activeSectionTitle,
  visibleSubjectLabel,
  draftCountBySectionKey,
  onSelectMatchingDraft,
}: TextbookCatalogPanelProps) {
  const [catalog, setCatalog] = useState<TextbookCatalogItem[]>([])
  const [selectedSlug, setSelectedSlug] = useState<string | null>(activeTextbookSlug ?? null)
  const [selectedDetail, setSelectedDetail] = useState<TextbookCatalogDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [syncing, setSyncing] = useState<'all' | 'selected' | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const autoSyncedSlugsRef = useRef<Set<string>>(new Set())

  const loadCatalogDetail = useCallback(async (slug: string) => {
    setDetailLoading(true)
    setError('')

    try {
      const detail = await fetchTextbookCatalogDetail(slug)
      setSelectedDetail(detail)
    } catch (detailError) {
      setSelectedDetail(null)
      setError(detailError instanceof Error ? detailError.message : '교재 상세 정보를 불러오지 못했습니다.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const loadCatalog = useCallback(async (options?: { preferredSlug?: string | null; fallbackSlug?: string | null }) => {
    setLoading(true)
    setError('')

    try {
      const items = await fetchTextbookCatalog()
      setCatalog(items)

      const nextSlug =
        (options?.preferredSlug && items.some(item => item.slug === options.preferredSlug) ? options.preferredSlug : null) ??
        (activeTextbookSlug && items.some(item => item.slug === activeTextbookSlug) ? activeTextbookSlug : null) ??
        (options?.fallbackSlug && items.some(item => item.slug === options.fallbackSlug) ? options.fallbackSlug : null) ??
        items[0]?.slug ??
        null
      setSelectedSlug(nextSlug)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '교재 카탈로그를 불러오지 못했습니다.')
      setCatalog([])
      setSelectedSlug(null)
    } finally {
      setLoading(false)
    }
  }, [activeTextbookSlug])

  useEffect(() => {
    void loadCatalog({ preferredSlug: activeTextbookSlug })
  }, [activeTextbookSlug, loadCatalog])

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedDetail(null)
      return
    }

    void loadCatalogDetail(selectedSlug)
  }, [loadCatalogDetail, selectedSlug])

  useEffect(() => {
    if (!activeTextbookSlug) return
    if (catalog.some(item => item.slug === activeTextbookSlug)) {
      setSelectedSlug(activeTextbookSlug)
    }
  }, [activeTextbookSlug, catalog])

  const visibleCatalog = useMemo(
    () =>
      catalog.filter(item =>
        subjectLabelsMatch(visibleSubjectLabel, item.subject_label ?? item.book_title ?? item.title),
      ),
    [catalog, visibleSubjectLabel],
  )

  useEffect(() => {
    if (!visibleCatalog.length) {
      if (selectedSlug) {
        setSelectedSlug(null)
      }
      return
    }

    if (!selectedSlug || !visibleCatalog.some(item => item.slug === selectedSlug)) {
      setSelectedSlug(visibleCatalog[0]?.slug ?? null)
    }
  }, [selectedSlug, visibleCatalog])

  const runCatalogSync = useCallback(async (
    mode: 'all' | 'selected',
    options?: { auto?: boolean },
  ) => {
    const textbookSlug = mode === 'selected' ? selectedSlug : null
    const targetSlug = textbookSlug ?? selectedSlug
    setSyncing(mode)
    setError('')
    setFeedback('')

    try {
      const result = await syncTextbookCatalog(textbookSlug)
      const syncedSectionCount = result.textbooks[0]?.section_count ?? 0
      setFeedback(mode === 'selected'
        ? options?.auto
          ? syncedSectionCount > 0
            ? `선택한 교재를 자동으로 동기화해 단원 ${syncedSectionCount}개를 준비했습니다.`
            : '선택한 교재를 자동으로 동기화했지만 아직 만들 수 있는 단원 구조를 찾지 못했습니다.'
          : syncedSectionCount > 0
            ? `선택한 교재를 다시 동기화했습니다. 단원 ${syncedSectionCount}개를 확인했어요.`
            : '선택한 교재를 다시 동기화했습니다. 자동 단원 생성도 시도했지만 아직 구조를 만들지 못했습니다.'
        : `${result.synced_count}권 교재 카탈로그를 동기화했습니다.`)
      await loadCatalog({ preferredSlug: targetSlug, fallbackSlug: selectedSlug })
      if (targetSlug) {
        await loadCatalogDetail(targetSlug)
      }
    } catch (syncError) {
      if (options?.auto && targetSlug) {
        autoSyncedSlugsRef.current.delete(targetSlug)
      }
      setError(syncError instanceof Error ? syncError.message : '교재 카탈로그 동기화에 실패했습니다.')
    } finally {
      setSyncing(null)
    }
  }, [loadCatalog, loadCatalogDetail, selectedSlug])

  const handleBackfill = async () => {
    if (!selectedSlug) return

    setBackfilling(true)
    setError('')
    setFeedback('')

    try {
      const result = await backfillTextbookCatalog(selectedSlug)
      setFeedback(
        result.updated_count > 0 || result.updated_question_count > 0
          ? `기존 시험 ${result.updated_count}개와 문항 근거 ${result.updated_question_count}개를 다시 연결했습니다.`
          : `확인한 ${result.checked_count}개 시험은 이미 최신 교재 카탈로그 연결 상태입니다.`,
      )
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : '기존 시험 연결 보정에 실패했습니다.')
    } finally {
      setBackfilling(false)
    }
  }

  const activeSectionKey = useMemo(() => {
    if (!activeTextbookSlug || !activeSectionTitle) return null
    return buildCatalogSectionKey(activeTextbookSlug, activeSectionTitle)
  }, [activeSectionTitle, activeTextbookSlug])

  const selectedCatalogItem = useMemo(
    () => visibleCatalog.find(item => item.slug === selectedSlug) ?? null,
    [selectedSlug, visibleCatalog],
  )

  useEffect(() => {
    if (!selectedCatalogItem || loading || detailLoading || syncing !== null || backfilling) return

    const needsAutoSync =
      !selectedCatalogItem.synced_at ||
      selectedCatalogItem.section_count === 0

    if (!needsAutoSync) return
    if (autoSyncedSlugsRef.current.has(selectedCatalogItem.slug)) return

    autoSyncedSlugsRef.current.add(selectedCatalogItem.slug)
    void runCatalogSync('selected', { auto: true })
  }, [backfilling, detailLoading, loading, runCatalogSync, selectedCatalogItem, syncing])

  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <DatabaseZap className="h-3.5 w-3.5" />
            DB 교재 카탈로그
          </div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">교재 구조를 먼저 확인하고 시험 초안으로 연결</h2>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            교재를 고르면 필요할 때 카탈로그 동기화와 단원 구조 준비를 자동으로 시도합니다. 이미 생성된 단원별 초안이 있으면 바로 시험지 제작 흐름으로 이어집니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void loadCatalog({ preferredSlug: selectedSlug, fallbackSlug: selectedSlug })}
            disabled={loading || detailLoading || syncing !== null || backfilling}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
          >
            <RefreshCw className="h-4 w-4" />
            새로고침
          </button>
          <button
            type="button"
            onClick={() => void handleBackfill()}
            disabled={!selectedSlug || syncing !== null || backfilling}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
          >
            {backfilling ? '기존 시험 보정 중...' : '기존 시험 연결 보정'}
          </button>
          <button
            type="button"
            onClick={() => void runCatalogSync('all')}
            disabled={syncing !== null || backfilling}
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {syncing === 'all' ? '전체 동기화 중...' : '교재 전체 다시 동기화'}
          </button>
        </div>
      </div>

      {(feedback || error) && (
        <div
          className={`mt-5 rounded-2xl border px-4 py-4 text-sm ${
            error
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {error || feedback}
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">교재 목록</p>
              <p className="mt-2 text-sm text-slate-500">현재 연결된 PDF 교재 {visibleCatalog.length}권을 확인할 수 있습니다.</p>
            </div>
            <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              {loading ? '불러오는 중' : `${visibleCatalog.length}권`}
            </div>
          </div>

          <div className="mt-4 max-h-[520px] space-y-3 overflow-y-auto pr-1">
            {loading && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                교재 카탈로그를 불러오는 중입니다.
              </div>
            )}

            {!loading && visibleCatalog.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                현재 반 과목에 맞는 PDF 교재가 아직 없습니다. 자료실에서 PDF를 업로드한 뒤 시험 초안을 생성해주세요.
              </div>
            )}

            {visibleCatalog.map(item => {
              const isActive = selectedSlug === item.slug
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedSlug(item.slug)}
                  className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                    isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <p className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-900'}`}>
                    {item.book_title ?? item.title}
                  </p>
                  <p className={`mt-2 text-sm ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                    {item.subject_label ?? item.title}
                  </p>
                  <div className={`mt-3 flex flex-wrap gap-2 text-xs ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                    <span>{item.section_count}개 단원</span>
                    <span>{item.page_count}페이지</span>
                    <span>{item.has_local_pdf ? 'PDF 연결' : 'PDF 미연결'}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-5">
          {detailLoading && (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              선택한 교재 상세를 불러오는 중입니다.
            </div>
          )}

          {!detailLoading && !selectedDetail && (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
              왼쪽에서 교재를 고르면 단원 구조와 페이지 미리보기가 여기에 나타납니다.
            </div>
          )}

          {!detailLoading && selectedDetail && (
            <>
              <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ecfdf5,#f8fafc_52%,#eff6ff)] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">선택한 교재</p>
                    <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">
                      {selectedDetail.textbook.book_title ?? selectedDetail.textbook.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{selectedDetail.textbook.subject_label ?? selectedDetail.textbook.title}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                      {selectedDetail.sections.length}개 단원
                    </span>
                    <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                      {selectedDetail.textbook.page_count}페이지
                    </span>
                    <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                      {formatDateTime(selectedDetail.textbook.synced_at)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedDetail.textbook.has_local_pdf ? (
                    <a
                      href={getApiUrl(`/api/exams/textbooks/${selectedDetail.textbook.slug}/pdf`)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                    >
                      <BookOpenText className="h-4 w-4" />
                      원본 PDF 열기
                    </a>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm leading-6 text-slate-500">
                      교재 선택은 완료됐지만, 이 교재 원본에는 아직 연결된 PDF 파일이 없습니다.
                      <br />
                      현재는 페이지 이미지 기준으로만 미리보기를 제공합니다.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                      <Rows3 className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-lg font-semibold text-slate-950">단원 구조</h4>
                      <p className="mt-1 text-sm text-slate-500">단원을 눌러 이미 생성된 AI 초안이 있는지 바로 확인할 수 있습니다.</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {selectedDetail.sections.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        이 교재는 페이지 이미지만 등록되어 있고, 단원 구조 파일이 없어 단원 목록을 만들 수 없습니다.
                      </div>
                    )}

                    {selectedDetail.sections.map(section => {
                      const sectionKey = buildCatalogSectionKey(selectedDetail.textbook.slug, section.title)
                      const draftCount = draftCountBySectionKey[sectionKey] ?? 0
                      const isActive = activeSectionKey === sectionKey

                      return (
                        <div
                          key={section.id}
                          className={`rounded-[22px] border px-4 py-4 ${
                            isActive ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                          }`}
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{section.title}</p>
                              <p className="mt-2 text-sm text-slate-500">
                                {section.page_start && section.page_end
                                  ? `${section.page_start}-${section.page_end}p`
                                  : '페이지 범위 정보 없음'}
                              </p>
                              {section.learning_objective && (
                                <p className="mt-2 text-sm leading-6 text-slate-600">{section.learning_objective}</p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600">
                                생성 초안 {draftCount}개
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectMatchingDraft({
                                    subjectLabel: selectedDetail.textbook.subject_label ?? selectedDetail.textbook.title,
                                    textbookKey: selectedDetail.textbook.slug,
                                    sectionTitle: section.title,
                                  })
                                }
                                disabled={draftCount === 0}
                                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <ScanSearch className="h-4 w-4" />
                                {draftCount > 0 ? '초안 선택 흐름으로 열기' : '아직 초안 없음'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
                  <h4 className="text-lg font-semibold text-slate-950">페이지 미리보기</h4>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    교재 첫 페이지 일부를 빠르게 확인해서 동기화 상태와 자료 품질을 점검합니다.
                  </p>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {selectedDetail.pages.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 sm:col-span-2">
                        미리볼 페이지가 아직 없습니다.
                      </div>
                    )}

                    {selectedDetail.pages.slice(0, 6).map(page => (
                      <article key={page.id} className="overflow-hidden rounded-[22px] border border-slate-200 bg-slate-50">
                        <div className="relative aspect-[3/4] bg-slate-100">
                          <Image
                            src={getApiUrl(`/api/exams/textbooks/${selectedDetail.textbook.slug}/pages/${page.page_number}`)}
                            alt={`${selectedDetail.textbook.book_title ?? selectedDetail.textbook.title} ${page.page_number}페이지`}
                            fill
                            unoptimized
                            sizes="(max-width: 768px) 50vw, 240px"
                            className="object-cover"
                          />
                        </div>
                        <div className="px-3 py-3">
                          <p className="text-sm font-semibold text-slate-900">{page.page_label ?? `${page.page_number}p`}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
