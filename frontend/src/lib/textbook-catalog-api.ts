import { fetchJson } from '@/lib/api'

export type TextbookCatalogItem = {
  id: string
  slug: string
  title: string
  book_title?: string | null
  subject_label?: string | null
  page_count: number
  section_count: number
  source_type: 'filesystem' | 'upload' | 'external'
  synced_at?: string | null
  has_local_pdf?: boolean
}

export type TextbookCatalogSection = {
  id: string
  title: string
  slug: string
  depth: number
  node_order: number
  page_start?: number | null
  page_end?: number | null
  learning_objective?: string | null
}

export type TextbookCatalogPage = {
  id: string
  page_number: number
  page_label?: string | null
  image_path?: string | null
  text_preview?: string | null
}

export type TextbookCatalogDetail = {
  textbook: TextbookCatalogItem & {
    viewer_url?: string | null
    short_url?: string | null
    local_pdf_path?: string | null
  }
  sections: TextbookCatalogSection[]
  pages: TextbookCatalogPage[]
}

export type SyncTextbookCatalogResponse = {
  synced_count: number
  textbooks: Array<{
    slug: string
    textbook_id: string
    section_count: number
    page_count: number
  }>
}

export type BackfillTextbookCatalogResponse = {
  checked_count: number
  updated_count: number
  updated_question_count: number
  updated: Array<{
    exam_id: string
    title: string
    textbook_slug: string
    section_title?: string | null
    textbook_id?: string | null
    textbook_toc_node_id?: string | null
  }>
}

export function buildCatalogSectionKey(textbookSlug: string, sectionTitle: string) {
  return `${textbookSlug}::${sectionTitle.trim()}`
}

export async function fetchTextbookCatalog(): Promise<TextbookCatalogItem[]> {
  const data = await fetchJson<unknown>('/api/exams/textbooks/catalog')
  return Array.isArray(data) ? (data as TextbookCatalogItem[]) : []
}

export async function fetchTextbookCatalogDetail(textbookSlug: string): Promise<TextbookCatalogDetail> {
  return fetchJson<TextbookCatalogDetail>(`/api/exams/textbooks/catalog/${encodeURIComponent(textbookSlug)}`)
}

export async function syncTextbookCatalog(textbookSlug?: string | null): Promise<SyncTextbookCatalogResponse> {
  return fetchJson<SyncTextbookCatalogResponse>('/api/exams/textbooks/catalog/sync', {
    method: 'POST',
    body: JSON.stringify({
      textbook_slug: textbookSlug ?? null,
    }),
  })
}

export async function backfillTextbookCatalog(textbookSlug?: string | null): Promise<BackfillTextbookCatalogResponse> {
  return fetchJson<BackfillTextbookCatalogResponse>('/api/exams/textbooks/catalog/backfill', {
    method: 'POST',
    body: JSON.stringify({
      textbook_slug: textbookSlug ?? null,
    }),
  })
}
