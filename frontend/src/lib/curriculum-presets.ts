export type SchoolLevel = '초등' | '중등' | '고등'

export type CurriculumPreset = {
  id: string
  schoolLevel: SchoolLevel
  gradeBand: string
  subject: string
  concept: string
  title: string
  summary: string
  samplePrompt: string
}

// Representative starter examples inferred from the 2022 revised Korean curriculum.
// They are intended as built-in tutor entry points, not as an exhaustive curriculum map.
export const CURRICULUM_PRESETS: CurriculumPreset[] = [
  {
    id: 'elem-fraction',
    schoolLevel: '초등',
    gradeBand: '초등 3-4학년',
    subject: '수학',
    concept: '초등 수학 · 분수의 의미',
    title: '분수를 처음 이해하기',
    summary: '전체와 부분의 관계를 생활 예시로 연결해 분수의 뜻을 스스로 떠올리게 돕는 코스',
    samplePrompt:
      '초등학생 수준에서 피자나 초콜릿을 나누는 상황으로 분수의 뜻을 스스로 말해볼 수 있게 질문으로 도와줘.',
  },
  {
    id: 'elem-ecosystem',
    schoolLevel: '초등',
    gradeBand: '초등 5-6학년',
    subject: '과학',
    concept: '초등 과학 · 생태계와 먹이 관계',
    title: '생태계의 연결 이해하기',
    summary: '생물 사이의 먹고 먹히는 관계와 환경 변화의 영향을 관찰 중심으로 생각해보는 코스',
    samplePrompt:
      '초등 과학에서 먹이사슬을 배운다고 생각하고, 숲속 생물들이 어떻게 연결되는지 내가 스스로 설명하도록 질문해줘.',
  },
  {
    id: 'elem-reading',
    schoolLevel: '초등',
    gradeBand: '초등 5-6학년',
    subject: '국어',
    concept: '초등 국어 · 중심 내용 찾기',
    title: '글의 중심 내용 찾기',
    summary: '설명문이나 이야기에서 중요한 문장을 찾고 핵심을 요약하는 기본 읽기 코스',
    samplePrompt:
      '초등 국어 시간이라고 생각하고, 글의 중심 내용을 찾을 때 무엇을 먼저 봐야 하는지 질문으로 이끌어줘.',
  },
  {
    id: 'middle-linear',
    schoolLevel: '중등',
    gradeBand: '중학교 1-2학년',
    subject: '수학',
    concept: '중학 수학 · 일차함수와 그래프',
    title: '일차함수 감각 익히기',
    summary: '변화량, 기울기, 그래프의 의미를 상황과 연결해 스스로 해석하게 돕는 코스',
    samplePrompt:
      '중학생 수준에서 일차함수 그래프를 볼 때 x가 늘어나면 y가 어떻게 변하는지 스스로 설명하도록 질문해줘.',
  },
  {
    id: 'middle-matter',
    schoolLevel: '중등',
    gradeBand: '중학교 1-2학년',
    subject: '과학',
    concept: '중학 과학 · 물질의 상태 변화',
    title: '입자 관점으로 상태 변화 보기',
    summary: '고체, 액체, 기체 변화가 왜 일어나는지 입자 배열과 운동으로 연결하는 코스',
    samplePrompt:
      '중학 과학에서 물이 얼거나 끓을 때 입자들이 어떻게 달라지는지 내가 추론해보도록 질문으로 도와줘.',
  },
  {
    id: 'middle-argument',
    schoolLevel: '중등',
    gradeBand: '중학교 전학년',
    subject: '국어',
    concept: '중학 국어 · 주장과 근거',
    title: '주장과 근거 구분하기',
    summary: '글이나 발표에서 주장과 근거를 구분하고 설득 구조를 읽는 기본 논증 코스',
    samplePrompt:
      '중학교 국어 시간이라고 생각하고, 어떤 문장이 주장이고 어떤 문장이 근거인지 내가 구분하게 질문해줘.',
  },
  {
    id: 'high-calculus',
    schoolLevel: '고등',
    gradeBand: '고등 공통수학/선택수학',
    subject: '수학',
    concept: '고등 수학 · 변화율과 함수 해석',
    title: '변화율 감각 세우기',
    summary: '함수의 변화와 그래프 해석을 바탕으로 미적 사고의 출발점을 잡는 코스',
    samplePrompt:
      '고등학생 수준에서 함수가 빠르게 증가한다는 말을 그래프와 변화율로 어떻게 이해할지 질문으로 이끌어줘.',
  },
  {
    id: 'high-genetics',
    schoolLevel: '고등',
    gradeBand: '고등 과학',
    subject: '생명과학',
    concept: '고등 과학 · 유전 정보의 전달',
    title: '유전 정보 흐름 이해하기',
    summary: 'DNA, 유전자, 단백질의 관계를 단계적으로 연결해 보는 탐구 코스',
    samplePrompt:
      '고등 생명과학에서 DNA와 단백질이 어떤 관계인지 내가 단계적으로 정리해보도록 질문으로 도와줘.',
  },
  {
    id: 'high-social',
    schoolLevel: '고등',
    gradeBand: '고등 통합사회/국어',
    subject: '사회·국어',
    concept: '고등 사회 · 사회 문제 분석과 논증',
    title: '사회 이슈를 근거로 분석하기',
    summary: '사회 현상을 보고 주장, 자료, 반론 가능성을 함께 검토하는 사고 확장 코스',
    samplePrompt:
      '고등학생 수준에서 사회 문제를 볼 때 주장만 말하지 않고 근거와 반론까지 생각해보도록 질문해줘.',
  },
]

export const SCHOOL_LEVEL_ORDER: SchoolLevel[] = ['초등', '중등', '고등']

export function getCurriculumPreset(presetId: string | null) {
  if (!presetId) return null
  return CURRICULUM_PRESETS.find(preset => preset.id === presetId) ?? null
}
