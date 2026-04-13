import Link from 'next/link'
import { ArrowRight, BookOpenText, Bot, ChartColumnBig, GraduationCap, Sparkles } from 'lucide-react'
import { buildDemoLoginHref, DEMO_ACCOUNTS } from '@/lib/demo-accounts'

const featureCards = [
  {
    icon: Sparkles,
    title: '소크라테스식 AI 튜터',
    description: '직접 답을 주기보다 질문으로 사고 과정을 끌어내는 대화형 학습 공간입니다.',
  },
  {
    icon: ChartColumnBig,
    title: '교사 대시보드',
    description: '막힘이 많은 개념과 해결 추이를 한 화면에서 보고, 다음 수업 포인트를 빠르게 잡을 수 있습니다.',
  },
  {
    icon: BookOpenText,
    title: '시뮬레이션 코호트',
    description: '교사 1명, 학생 30명, 1년치 학습 로그를 넣어 바로 데모처럼 둘러볼 수 있습니다.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(245,158,11,0.14),_transparent_22%),linear-gradient(180deg,#f8fbff_0%,#eef4ff_48%,#ffffff_100%)]">
      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8 lg:py-14">
        <section className="overflow-hidden rounded-[40px] border border-white/70 bg-white/80 shadow-[0_32px_110px_rgba(15,23,42,0.14)] backdrop-blur">
          <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-12">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700">
                <GraduationCap className="h-4 w-4" />
                AI Learning Studio
              </div>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-slate-950 md:text-6xl">
                AI 튜터, 학생 대시보드, 교사 분석을 한 번에 체험하는
                <span className="block text-blue-700">SocraTeach 워크스페이스</span>
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 md:text-lg">
                시뮬레이션 데이터까지 넣어둔 상태라서, 지금은 단순 소개 페이지보다 실제 반이 돌아가는 데모에 가깝게 볼 수 있습니다.
                교사 계정으로는 반 전체 이해도 분석과 자료 관리를, 학생 계정으로는 AI 튜터와 개인 복습 흐름을 확인해보세요.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={buildDemoLoginHref(DEMO_ACCOUNTS[0])}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  교사 데모 바로 보기
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href={buildDemoLoginHref(DEMO_ACCOUNTS[1])}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
                >
                  학생 데모 바로 보기
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center gap-2 rounded-2xl border border-transparent px-5 py-3 text-sm font-medium text-slate-500 transition hover:text-slate-900"
                >
                  새 계정 만들기
                </Link>
              </div>
            </div>

            <div className="space-y-4 rounded-[32px] bg-[linear-gradient(180deg,#0f172a,#1e293b)] p-6 text-white shadow-inner">
              <div className="flex items-center gap-2 text-blue-100">
                <Bot className="h-5 w-5" />
                <p className="text-sm font-semibold uppercase tracking-[0.22em]">Demo Access</p>
              </div>
              <p className="text-sm leading-7 text-slate-300">
                기본 시뮬레이션은 중등 반 한 개와 학생 30명, 1년치 학습 기록을 기준으로 채워져 있습니다.
              </p>
              <div className="space-y-3">
                {DEMO_ACCOUNTS.map(account => (
                  <div key={account.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold">{account.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-blue-100">{account.role}</p>
                      </div>
                      <Link
                        href={buildDemoLoginHref(account)}
                        className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/15"
                      >
                        자동 입력
                      </Link>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{account.summary}</p>
                    <div className="mt-4 rounded-2xl bg-slate-950/40 px-4 py-3 text-xs leading-6 text-slate-300">
                      <div>{account.email}</div>
                      <div>{account.password}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-3">
          {featureCards.map(card => {
            const Icon = card.icon
            return (
              <article
                key={card.title}
                className="rounded-[28px] border border-white/70 bg-white/85 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur"
              >
                <div className="inline-flex rounded-2xl bg-blue-50 p-3 text-blue-700">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{card.description}</p>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
