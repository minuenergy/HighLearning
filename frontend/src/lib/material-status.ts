export type MaterialProcessingStatus =
  | 'uploaded'
  | 'queued'
  | 'parsing'
  | 'indexing'
  | 'completed'
  | 'failed'

export type MaterialDraftGenerationStatus = 'idle' | 'analyzing' | 'generating' | 'completed' | 'failed'

export type MaterialPipelineState = 'complete' | 'current' | 'pending' | 'failed'
export type MaterialPipelineTone = 'success' | 'warning' | 'error' | 'neutral' | 'processing'

export type MaterialPipelineLike = {
  indexed?: boolean
  processing_status?: MaterialProcessingStatus
  processing_stage?: string | null
  parser_used?: string | null
  chunk_count?: number | null
  extracted_char_count?: number | null
  error_message?: string | null
  page_count?: number | null
  processing_started_at?: string | null
  processing_completed_at?: string | null
  draft_generation_status?: MaterialDraftGenerationStatus
  draft_generation_stage?: string | null
  draft_generation_error?: string | null
  draft_generated_count?: number | null
  last_generated_at?: string | null
}

export type MaterialPipelineStep = {
  id: 'upload' | 'processing' | 'draft' | 'classroom'
  label: string
  description: string
  state: MaterialPipelineState
}

type MaterialPrimaryStatus = {
  label: string
  tone: MaterialPipelineTone
}

const stepWeights: Record<MaterialPipelineStep['id'], number> = {
  upload: 0.16,
  processing: 0.44,
  draft: 0.24,
  classroom: 0.16,
}

const stateProgress: Record<MaterialPipelineState, number> = {
  complete: 1,
  current: 0.55,
  failed: 0.55,
  pending: 0,
}

function formatMetric(value?: number | null) {
  return new Intl.NumberFormat('ko-KR').format(value ?? 0)
}

function isDraftActive(status?: MaterialDraftGenerationStatus) {
  return status === 'analyzing' || status === 'generating'
}

function isProcessingComplete(material: MaterialPipelineLike) {
  return material.processing_status === 'completed' || material.indexed
}

export function isMaterialPipelineActive(material: MaterialPipelineLike) {
  return (
    (!!material.processing_status && !['completed', 'failed'].includes(material.processing_status)) ||
    isDraftActive(material.draft_generation_status)
  )
}

export function formatMaterialDateTime(value?: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

export function getMaterialPrimaryStatus(material: MaterialPipelineLike): MaterialPrimaryStatus {
  if (material.processing_status === 'failed') {
    return {
      label: material.processing_stage || '자료 처리 실패',
      tone: 'error',
    }
  }

  if (material.draft_generation_status === 'failed') {
    return {
      label: material.draft_generation_stage || '단원별 초안 생성 실패',
      tone: 'warning',
    }
  }

  if (isDraftActive(material.draft_generation_status)) {
    return {
      label: material.draft_generation_stage || '단원별 시험 초안 생성 중',
      tone: 'processing',
    }
  }

  if (!isProcessingComplete(material)) {
    return {
      label: material.processing_stage || '자료 처리 중',
      tone: 'processing',
    }
  }

  if (material.draft_generation_status === 'completed') {
    const draftCount = material.draft_generated_count ?? 0
    return {
      label: draftCount > 0 ? `AI 학습 완료 · draft ${formatMetric(draftCount)}개` : 'AI 학습 및 초안 생성 완료',
      tone: 'success',
    }
  }

  if (material.indexed) {
    return {
      label: 'AI 학습 완료',
      tone: 'success',
    }
  }

  return {
    label: '업로드 완료',
    tone: 'neutral',
  }
}

export function getMaterialNextAction(material: MaterialPipelineLike) {
  if (material.processing_status === 'failed') {
    return '오류를 확인하고 다시 업로드'
  }

  if (material.draft_generation_status === 'failed') {
    return '초안 다시 생성으로 재시도'
  }

  if (material.draft_generation_status === 'completed') {
    return '시험지 또는 숙제로 연결'
  }

  if (material.indexed) {
    return '시험지 제작실에서 검수 시작'
  }

  return '처리 완료 후 다시 확인'
}

export function getMaterialPipelineSteps(material: MaterialPipelineLike): MaterialPipelineStep[] {
  const processingComplete = isProcessingComplete(material)
  const draftActive = isDraftActive(material.draft_generation_status)

  return [
    {
      id: 'upload',
      label: '자료 등록',
      description: '파일 업로드가 완료되어 자료 처리 큐에 들어갔습니다.',
      state: 'complete',
    },
    {
      id: 'processing',
      label: '파싱 · 인덱싱',
      description:
        material.processing_status === 'failed'
          ? material.error_message || material.processing_stage || '문서를 읽는 도중 오류가 발생했습니다.'
          : processingComplete
            ? `페이지 ${formatMetric(material.page_count)}장 · 청크 ${formatMetric(material.chunk_count)}개 정리 완료`
            : material.processing_stage || '문서 텍스트를 추출하고 지식 청크를 만드는 중입니다.',
      state:
        material.processing_status === 'failed'
          ? 'failed'
          : processingComplete
            ? 'complete'
            : 'current',
    },
    {
      id: 'draft',
      label: '단원별 초안 생성',
      description:
        material.processing_status === 'failed'
          ? '자료 학습이 끝나면 단원별 시험 초안 생성을 시작합니다.'
          : material.draft_generation_status === 'failed'
            ? material.draft_generation_error || '자료 학습은 끝났지만 시험 초안 자동 생성에 실패했습니다.'
            : material.draft_generation_status === 'completed'
              ? material.draft_generated_count
                ? `draft ${formatMetric(material.draft_generated_count)}개 준비 완료`
                : '시험 초안 생성이 완료되었습니다.'
              : draftActive
                ? material.draft_generation_stage || '단원별 시험 초안을 정리하고 있습니다.'
                : material.indexed
                  ? '필요하면 지금 다시 생성해서 새 초안을 만들 수 있습니다.'
                  : '자료 학습이 끝나면 자동으로 시작됩니다.',
      state:
        material.processing_status === 'failed'
          ? 'pending'
          : material.draft_generation_status === 'failed'
            ? 'failed'
            : material.draft_generation_status === 'completed'
              ? 'complete'
              : draftActive || material.indexed
                ? 'current'
                : 'pending',
    },
    {
      id: 'classroom',
      label: '교실 연결',
      description:
        material.processing_status === 'failed'
          ? '오류를 해결한 뒤 다시 업로드해야 시험 제작과 튜터 근거에 연결됩니다.'
          : material.draft_generation_status === 'completed'
            ? '시험지 제작실에서 바로 검수하고 학생용 과제로 배포할 수 있습니다.'
            : material.draft_generation_status === 'failed'
              ? '자료는 튜터 근거로 사용할 수 있고, 초안 생성만 다시 시도하면 됩니다.'
              : material.indexed
                ? '학생 질문 근거 자료로는 이미 활용할 수 있고, 시험 초안이 이어서 준비됩니다.'
                : '자료 분석이 끝나면 시험 제작실과 AI 튜터가 이 자료를 활용합니다.',
      state:
        material.draft_generation_status === 'completed'
          ? 'complete'
          : material.processing_status === 'failed'
            ? 'pending'
            : material.indexed
              ? 'current'
              : 'pending',
    },
  ]
}

export function getMaterialPipelineProgress(material: MaterialPipelineLike) {
  const steps = getMaterialPipelineSteps(material)
  const score = steps.reduce((sum, step) => sum + stepWeights[step.id] * stateProgress[step.state], 0)
  return Math.min(100, Math.max(0, Math.round(score * 100)))
}
