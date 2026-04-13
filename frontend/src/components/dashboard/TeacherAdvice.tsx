'use client'
import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Stat = { concept: string; total_stuck: number; total_resolved: number; student_count: number }

function buildAdvice(stat: Stat): string {
  const resolveRate = stat.total_resolved / (stat.total_stuck + stat.total_resolved + 0.001)
  if (resolveRate < 0.3) {
    return `📌 "${stat.concept}" 개념에서 ${stat.student_count}명이 총 ${stat.total_stuck}번 막혔어요. 추가 예시나 시각 자료를 보강해보세요.`
  }
  return `💡 "${stat.concept}" 개념은 학생들이 노력 중이에요. 연습 문제를 더 제공해보세요.`
}

export default function TeacherAdvice({ stats }: { stats: Stat[] }) {
  const advice = useMemo(() => (
    [...stats]
      .sort((a, b) => b.total_stuck - a.total_stuck)
      .slice(0, 3)
      .map(buildAdvice)
  ), [stats])

  return (
    <Card className="border-blue-100 bg-blue-50">
      <CardHeader>
        <CardTitle className="text-blue-800 text-base">🤖 AI 교수법 조언</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {advice.length === 0
          ? <p className="text-sm text-slate-500">데이터가 쌓이면 조언이 나타납니다.</p>
          : advice.map((a, i) => <p key={i} className="text-sm text-blue-900">{a}</p>)
        }
      </CardContent>
    </Card>
  )
}
