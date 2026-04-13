'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

type ConceptStat = {
  concept: string
  total_stuck: number
  total_resolved: number
  student_count: number
}

function getColor(stuck: number, resolved: number): string {
  const ratio = resolved / (stuck + resolved + 0.001)
  if (ratio > 0.7) return '#22c55e'
  if (ratio > 0.4) return '#f59e0b'
  return '#ef4444'
}

export default function ConceptHeatmap({ stats }: { stats: ConceptStat[] }) {
  const sorted = [...stats].sort((a, b) => b.total_stuck - a.total_stuck)

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border">
      <h2 className="font-bold text-lg mb-1">개념별 이해도 히트맵</h2>
      <p className="text-sm text-slate-500 mb-4">🔴 많이 막힘 · 🟡 보통 · 🟢 잘 이해함</p>
      {sorted.length === 0 ? (
        <p className="text-center text-slate-400 py-12">아직 학습 데이터가 없습니다.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(300, sorted.length * 40)}>
          <BarChart data={sorted} layout="vertical">
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="concept" width={220} tick={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value, name) => [value, name === 'total_stuck' ? '막힌 횟수' : '해결 횟수']}
            />
            <Bar dataKey="total_stuck" name="total_stuck" radius={[0, 4, 4, 0]}>
              {sorted.map((entry, i) => (
                <Cell key={i} fill={getColor(entry.total_stuck, entry.total_resolved)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
