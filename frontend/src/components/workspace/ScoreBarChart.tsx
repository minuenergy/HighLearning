'use client'

type ChartItem = {
  label: string
  value?: number | null
  meta?: string
}

export default function ScoreBarChart({
  title,
  caption,
  items,
  accent = 'blue',
  emptyMessage = '표시할 점수 데이터가 없습니다.',
}: {
  title: string
  caption?: string
  items: ChartItem[]
  accent?: 'blue' | 'amber' | 'emerald' | 'rose'
  emptyMessage?: string
}) {
  const accentClasses =
    accent === 'amber'
      ? 'from-amber-400 to-orange-500'
      : accent === 'emerald'
        ? 'from-emerald-400 to-teal-500'
        : accent === 'rose'
          ? 'from-rose-400 to-pink-500'
          : 'from-blue-500 to-cyan-500'

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      {caption && <p className="mt-2 text-sm leading-6 text-slate-500">{caption}</p>}

      <div className="mt-5 space-y-4">
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            {emptyMessage}
          </div>
        )}

        {items.map(item => {
          const value = typeof item.value === 'number' ? Math.max(0, Math.min(100, item.value)) : null

          return (
            <div key={`${item.label}-${item.meta ?? ''}`} className="space-y-2">
              <div className="flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.label}</p>
                  {item.meta && <p className="mt-1 text-xs text-slate-400">{item.meta}</p>}
                </div>
                <p className="shrink-0 text-sm font-semibold text-slate-700">
                  {value === null ? '미응시' : `${value.toFixed(1)}점`}
                </p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${accentClasses} transition-all`}
                  style={{ width: `${value ?? 0}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
