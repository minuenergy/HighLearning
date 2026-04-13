'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

export type CalendarBoardEvent = {
  id: string
  title: string
  date: string
  subtitle?: string
  href?: string
  tone?: 'blue' | 'amber' | 'emerald' | 'red'
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function addDays(date: Date, delta: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + delta)
  return next
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function dateKeyFromValue(value: string) {
  return dateKey(new Date(value))
}

function buildCalendarDays(cursor: Date) {
  const firstDay = startOfMonth(cursor)
  const gridStart = addDays(firstDay, -firstDay.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function toneClasses(tone: CalendarBoardEvent['tone']) {
  if (tone === 'amber') return 'bg-amber-50 text-amber-800 border-amber-200'
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (tone === 'red') return 'bg-red-50 text-red-800 border-red-200'
  return 'bg-blue-50 text-blue-800 border-blue-200'
}

export default function AssignmentCalendarBoard({
  title,
  caption,
  events,
  emptyMessage,
}: {
  title: string
  caption: string
  events: CalendarBoardEvent[]
  emptyMessage: string
}) {
  const initialMonth = useMemo(() => {
    const datedEvents = events
      .map(event => new Date(event.date))
      .filter(date => !Number.isNaN(date.getTime()))
      .sort((left, right) => left.getTime() - right.getTime())
    return datedEvents[0] ?? new Date()
  }, [events])
  const [cursor, setCursor] = useState(() => startOfMonth(initialMonth))

  const days = useMemo(() => buildCalendarDays(cursor), [cursor])
  const eventMap = useMemo(() => {
    const mapped = new Map<string, CalendarBoardEvent[]>()
    events.forEach(event => {
      const key = dateKeyFromValue(event.date)
      const bucket = mapped.get(key) ?? []
      bucket.push(event)
      mapped.set(key, bucket)
    })
    return mapped
  }, [events])

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{caption}</p>
        </div>

        <div className="flex items-center gap-2 self-start rounded-full border border-slate-200 bg-slate-50 px-2 py-2">
          <button
            type="button"
            onClick={() => setCursor(current => addMonths(current, -1))}
            className="rounded-full p-2 text-slate-500 transition hover:bg-white hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-28 text-center text-sm font-semibold text-slate-900">
            {cursor.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' })}
          </span>
          <button
            type="button"
            onClick={() => setCursor(current => addMonths(current, 1))}
            className="rounded-full p-2 text-slate-500 transition hover:bg-white hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="mt-5 rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
            {WEEKDAY_LABELS.map(label => (
              <div key={label} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map(day => {
              const key = dateKey(day)
              const items = eventMap.get(key) ?? []
              const isCurrentMonth = day.getMonth() === cursor.getMonth()
              const moreCount = items.length - 3

              return (
                <div
                  key={key}
                  className={`min-h-40 border-b border-r border-slate-200 px-2 py-3 align-top ${
                    isCurrentMonth ? 'bg-white' : 'bg-slate-50/80'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                        isCurrentMonth ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {day.getDate()}
                    </span>
                    {items.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                        {items.length}개
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {items.slice(0, 3).map(item => {
                      const content = (
                        <>
                          <p className="truncate text-[11px] font-semibold">{item.title}</p>
                          {item.subtitle ? <p className="mt-1 truncate text-[11px] opacity-80">{item.subtitle}</p> : null}
                        </>
                      )

                      if (item.href) {
                        return (
                          <Link
                            key={item.id}
                            href={item.href}
                            className={`block rounded-2xl border px-3 py-2 transition hover:brightness-[0.98] ${toneClasses(item.tone)}`}
                          >
                            {content}
                          </Link>
                        )
                      }

                      return (
                        <div key={item.id} className={`rounded-2xl border px-3 py-2 ${toneClasses(item.tone)}`}>
                          {content}
                        </div>
                      )
                    })}

                    {moreCount > 0 && (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
                        +{moreCount}개 더 있음
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
