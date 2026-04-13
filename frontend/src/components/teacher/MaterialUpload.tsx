'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, FileText, CheckCircle, Loader2, Sparkles, BookOpenCheck, FileQuestion } from 'lucide-react'
import { getApiUrl, getDirectApiUrl } from '@/lib/api'
import {
  getMaterialPipelineProgress,
  getMaterialPipelineSteps,
  getMaterialPrimaryStatus,
  type MaterialPipelineLike,
} from '@/lib/material-status'

type Props = { courseId: string; onUploaded?: (materialId?: string) => void | Promise<void> }
type UploadState = 'idle' | 'uploading' | 'processing' | 'done' | 'failed'

type MaterialStatus = MaterialPipelineLike & {
  id: string
  processing_status: 'uploaded' | 'queued' | 'parsing' | 'indexing' | 'completed' | 'failed'
}

function DropZone({ file, onSelect }: { file: File | null; onSelect: (f: File) => void }) {
  return (
    <div
      className="cursor-pointer rounded-[24px] border-2 border-dashed border-slate-200 p-8 text-center transition-colors hover:border-blue-400"
      onClick={() => document.getElementById('file-input')?.click()}
    >
      {file ? (
        <div className="flex items-center justify-center gap-2 text-slate-700">
          <FileText className="w-5 h-5" />
          <span className="text-sm font-medium">{file.name}</span>
        </div>
      ) : (
        <>
          <Upload className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p className="text-sm text-slate-500">PDF 파일을 클릭해서 선택하세요</p>
          <p className="mt-1 text-xs text-slate-400">큰 PDF도 업로드할 수 있지만 200MB 이하를 권장합니다</p>
        </>
      )}
      <input
        id="file-input"
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) onSelect(f)
        }}
      />
    </div>
  )
}

async function uploadWithBackend(courseId: string, file: File) {
  const formData = new FormData()
  formData.append('course_id', courseId)
  formData.append('file', file)
  const response = await fetch(getDirectApiUrl('/api/materials/upload'), {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '자료 업로드에 실패했습니다.')
  }

  return response.json()
}

async function fetchMaterialStatus(materialId: string): Promise<MaterialStatus> {
  const response = await fetch(getApiUrl(`/api/materials/${materialId}`), {
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? '자료 상태를 확인하지 못했습니다.')
  }

  return response.json()
}

export default function MaterialUpload({ courseId, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<UploadState>('idle')
  const [error, setError] = useState('')
  const [status, setStatus] = useState<MaterialStatus | null>(null)

  const handleUpload = async () => {
    if (!file) return
    setState('uploading')
    setError('')
    setStatus(null)

    try {
      const result = await uploadWithBackend(courseId, file)
      const materialId = result?.material?.id
      if (!materialId) {
        throw new Error('업로드 결과에서 자료 ID를 찾지 못했습니다.')
      }

      setState('processing')
      setStatus(result.material)
      setFile(null)
      await onUploaded?.(materialId)

      let attempts = 0
      while (attempts < 60) {
        await new Promise(resolve => window.setTimeout(resolve, 1500))
        const nextStatus = await fetchMaterialStatus(materialId)
        setStatus(nextStatus)
        await onUploaded?.(materialId)

        if (nextStatus.processing_status === 'completed' && nextStatus.draft_generation_status === 'completed') {
          setState('done')
          return
        }

        if (nextStatus.processing_status === 'failed') {
          setState('failed')
          setError(nextStatus.error_message || '자료 처리에 실패했습니다.')
          return
        }

        if (nextStatus.draft_generation_status === 'failed') {
          setState('failed')
          setError(nextStatus.draft_generation_error || '자료 학습은 완료됐지만 시험 초안 자동 생성에 실패했습니다.')
          return
        }

        attempts += 1
      }

      setState('processing')
    } catch (uploadError) {
      setState('failed')
      setError(uploadError instanceof Error ? uploadError.message : '자료 업로드에 실패했습니다.')
    }
  }

  const handleFileSelect = (f: File) => {
    setFile(f)
    setState('idle')
    setError('')
    setStatus(null)
  }

  const pipelineStatus = status ? getMaterialPrimaryStatus(status) : null
  const pipelineProgress = status ? getMaterialPipelineProgress(status) : 0
  const pipelineSteps = status ? getMaterialPipelineSteps(status) : []

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-slate-950">새 자료 올리기</h2>
          <p className="mt-1 text-sm text-slate-500">업로드한 자료는 AI가 학습하고, 이후 시험지 제작과 학생 질문 근거로 이어집니다.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Upload className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">1. 업로드</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">PDF 교재를 올리면 페이지별 텍스트를 추출해 학습 준비를 합니다.</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center gap-2 text-slate-500">
            <BookOpenCheck className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">2. 학습</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">AI 튜터가 자료를 참고해서 학생 질문과 오답 복기를 더 정확히 돕습니다.</p>
        </div>
        <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex items-center gap-2 text-slate-500">
            <FileQuestion className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.18em]">3. 활용</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">시험지 제작실에서 자료를 바탕으로 숙제나 형성평가를 만들 수 있습니다.</p>
        </div>
      </div>

      <div className="mt-5">
        <DropZone file={file} onSelect={handleFileSelect} />
      </div>

      {status && state !== 'idle' && (
        <div className="mt-4 rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#ffffff_55%,#eff6ff)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Live Upload</p>
              <p className="mt-2 text-base font-semibold text-slate-950">{pipelineStatus?.label}</p>
              <p className="mt-1 text-sm text-slate-500">
                {status.parser_used ? `parser ${status.parser_used} · ` : ''}
                {typeof status.chunk_count === 'number' && status.chunk_count > 0 ? `chunk ${status.chunk_count} · ` : ''}
                {typeof status.draft_generated_count === 'number' && status.draft_generated_count > 0
                  ? `draft ${status.draft_generated_count}개`
                  : 'AI가 자료를 읽고 초안을 준비하고 있습니다.'}
              </p>
            </div>
            <div className="rounded-[20px] border border-white/80 bg-white/90 px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">진행률</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{pipelineProgress}%</p>
            </div>
          </div>

          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
            <div
              className={`h-full rounded-full transition-all ${
                pipelineStatus?.tone === 'error'
                  ? 'bg-red-500'
                  : pipelineStatus?.tone === 'warning'
                    ? 'bg-amber-500'
                    : pipelineStatus?.tone === 'success'
                      ? 'bg-emerald-500'
                      : 'bg-blue-500'
              }`}
              style={{ width: `${pipelineProgress}%` }}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {pipelineSteps.map((step, index) => (
              <div
                key={step.id}
                className={`rounded-[22px] border px-4 py-4 ${
                  step.state === 'failed'
                    ? 'border-red-200 bg-red-50'
                    : step.state === 'complete'
                      ? 'border-emerald-200 bg-emerald-50'
                      : step.state === 'current'
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-slate-200 bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Step {index + 1}
                  </span>
                  <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    {step.state === 'failed'
                      ? '오류'
                      : step.state === 'complete'
                        ? '완료'
                        : step.state === 'current'
                          ? '진행 중'
                          : '대기'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">{step.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {state === 'done' && (
        <div className="mt-3 flex items-center gap-2 text-green-600">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">업로드 완료! 자료 학습과 시험 초안 자동 생성이 반 흐름에 연결되었습니다.</span>
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <Button
        onClick={handleUpload}
        disabled={!file || state !== 'idle'}
        className="mt-4 w-full"
      >
        {state === 'uploading' || state === 'processing' ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {state === 'uploading' ? '업로드 중...' : 'AI가 자료를 학습 중...'}
          </span>
        ) : '이 반 자료로 등록하기'}
      </Button>
    </div>
  )
}
