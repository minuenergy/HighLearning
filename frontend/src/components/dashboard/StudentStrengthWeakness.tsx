'use client'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'

type ConceptStat = {
  concept: string
  stuck_count: number
  resolved_count: number
}

function getUnderstandingScore(stat: ConceptStat): number {
  return Math.round((stat.resolved_count / (stat.stuck_count + stat.resolved_count + 0.001)) * 100)
}

function shortenLabel(label: string): string {
  return label.length > 8 ? label.slice(0, 8) + '…' : label
}

function StrengthCard({ stats }: { stats: ConceptStat[] }) {
  const strengths = stats.filter(s => s.resolved_count > s.stuck_count)
  return (
    <div className="bg-green-50 rounded-2xl p-5 border border-green-100">
      <h3 className="font-semibold text-green-700 mb-3">🟢 잘하고 있는 개념</h3>
      {strengths.length === 0
        ? <p className="text-sm text-slate-400">아직 데이터가 없어요</p>
        : strengths.map(s => (
          <div key={s.concept} className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0" />
            <span className="text-sm text-green-800">{s.concept}</span>
          </div>
        ))
      }
    </div>
  )
}

function WeaknessCard({ stats }: { stats: ConceptStat[] }) {
  const weaknesses = stats.filter(s => s.stuck_count >= s.resolved_count && s.stuck_count > 0)
  return (
    <div className="bg-red-50 rounded-2xl p-5 border border-red-100">
      <h3 className="font-semibold text-red-700 mb-3">🔴 보강이 필요한 개념</h3>
      {weaknesses.length === 0
        ? <p className="text-sm text-slate-400">막힌 개념이 없어요! 🎉</p>
        : weaknesses.map(s => (
          <div key={s.concept} className="flex items-center gap-2 mb-2">
            <span className="w-2 h-2 bg-red-400 rounded-full flex-shrink-0" />
            <span className="text-sm text-red-800">
              {s.concept}
              <span className="text-xs text-red-400 ml-1">({s.stuck_count}회 막힘)</span>
            </span>
          </div>
        ))
      }
    </div>
  )
}

export default function StudentStrengthWeakness({ stats }: { stats: ConceptStat[] }) {
  const radarData = stats.map(s => ({
    concept: shortenLabel(s.concept),
    이해도: getUnderstandingScore(s),
  }))

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl p-6 shadow-sm border">
        <h2 className="font-bold text-lg mb-4">📊 개념별 이해도</h2>
        {radarData.length === 0 ? (
          <p className="text-center text-slate-400 py-8">아직 학습 데이터가 없어요. 튜터와 대화해보세요!</p>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <RadarChart data={radarData}>
              <PolarGrid />
              <PolarAngleAxis dataKey="concept" tick={{ fontSize: 11 }} />
              <Radar dataKey="이해도" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StrengthCard stats={stats} />
        <WeaknessCard stats={stats} />
      </div>
    </div>
  )
}
