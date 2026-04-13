'use client'
import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildDemoLoginHref, DEMO_ACCOUNTS } from '@/lib/demo-accounts'
import {
  finalizeStudentSignup,
  finalizeTeacherSignup,
  validateStudentSignup,
  validateTeacherSignup,
} from '@/lib/workspace-api'

type Props = { mode: 'login' | 'signup' }

function humanizeAuthError(message: string) {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('ssl certificate') ||
    normalized.includes('certificate verification failed') ||
    normalized.includes('fetch failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network error')
  ) {
    return '로컬 Supabase 인증 서버 연결에 실패했습니다. `npm run supabase:env:start`로 로컬 스택과 env를 먼저 맞춘 뒤 다시 시도해주세요.'
  }

  return message
}

function getInitialAuthValues(): {
  email: string
  password: string
  role: 'teacher' | 'student'
} {
  if (typeof window === 'undefined') {
    return {
      email: '',
      password: '',
      role: 'student' as const,
    }
  }

  const params = new URLSearchParams(window.location.search)
  const roleParam = params.get('role')

  return {
    email: params.get('email') ?? '',
    password: params.get('password') ?? '',
    role: roleParam === 'teacher' || roleParam === 'student' ? roleParam : ('student' as const),
  }
}

export default function AuthForm({ mode }: Props) {
  const initialValues = getInitialAuthValues()
  const [email, setEmail] = useState(initialValues.email)
  const [password, setPassword] = useState(initialValues.password)
  const [name, setName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [role, setRole] = useState<'teacher' | 'student'>(initialValues.role)
  const [schoolName, setSchoolName] = useState('')
  const [schoolEmail, setSchoolEmail] = useState('')
  const verificationMethod: 'school_email' | 'invite_code' = 'invite_code'
  const [subjectNames, setSubjectNames] = useState('')
  const [gradeLevels, setGradeLevels] = useState('')
  const [classLabels, setClassLabels] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [studentClassLabel, setStudentClassLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const router = useRouter()
  const supabase = createClient()

  const splitCsv = (value: string) =>
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)

  const handleSignup = async () => {
    let validationNote = ''

    if (role === 'teacher') {
      const validation = await validateTeacherSignup({
        email,
        school_email: schoolEmail || email,
        verification_method: verificationMethod,
        invite_code: inviteCode || undefined,
      })
      validationNote = validation.verification_note ?? ''
    } else {
      const validation = await validateStudentSignup({
        invite_code: inviteCode,
        student_number: studentNumber,
      })
      setStudentClassLabel(validation.class_label ?? '')
      validationNote = validation.class_label
        ? `${validation.class_label} 반 코드 확인 완료`
        : '학생 초대코드 확인 완료'
    }

    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return error.message

    const userId = data.user?.id
    if (!userId) {
      return '회원가입은 완료되었지만 사용자 정보를 확인하지 못했습니다.'
    }

    await supabase.from('profiles').insert({
      id: userId,
      email,
      full_name: name,
      role,
      phone_number: phoneNumber,
    })

    if (role === 'teacher') {
      await finalizeTeacherSignup({
        user_id: userId,
        email,
        full_name: name,
        phone_number: phoneNumber,
        school_name: schoolName,
        school_email: schoolEmail || email,
        verification_method: verificationMethod,
        invite_code: inviteCode || undefined,
        subject_names: splitCsv(subjectNames),
        grade_levels: splitCsv(gradeLevels),
        class_labels: splitCsv(classLabels),
      })
    } else {
      await finalizeStudentSignup({
        user_id: userId,
        email,
        full_name: name,
        phone_number: phoneNumber,
        student_number: studentNumber,
        invite_code: inviteCode,
      })
    }

    setStatusMessage(validationNote)
    router.push(role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
    return null
  }

  const handleLogin = async () => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return error.message
    const { data: profile } = await supabase.from('profiles')
      .select('role').eq('id', data.user.id).single()
    router.push(profile?.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setStatusMessage('')
    try {
      const err = mode === 'signup' ? await handleSignup() : await handleLogin()
      if (err) setError(humanizeAuthError(err))
    } catch (err) {
      setError(humanizeAuthError(err instanceof Error ? err.message : '알 수 없는 로그인 오류가 발생했습니다.'))
    } finally {
      setLoading(false)
    }
  }

  const fillDemoAccount = (nextEmail: string, nextPassword: string, nextRole: 'teacher' | 'student') => {
    setEmail(nextEmail)
    setPassword(nextPassword)
    setRole(nextRole)
    setError('')
    setStatusMessage('')
  }

  return (
    <Card className="w-full max-w-xl mx-auto border-slate-200/80 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.10)] backdrop-blur">
      <CardHeader>
        <div className="inline-flex w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-700">
          SocraTeach Access
        </div>
        <CardTitle className="text-center text-2xl">
          {mode === 'login' ? '학습 공간에 바로 들어가기' : '새 학습 계정 만들기'}
        </CardTitle>
        <p className="text-center text-sm leading-6 text-slate-500">
          {mode === 'login'
            ? '시뮬레이션 교사/학생 계정으로 바로 체험하거나, 기존 계정으로 이어서 로그인할 수 있습니다.'
            : '교사는 어드민 초대코드로, 학생은 반 초대코드로 바로 가입할 수 있습니다.'}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {mode === 'login' && (
          <div className="grid gap-3 md:grid-cols-2">
            {DEMO_ACCOUNTS.map(account => (
              <button
                key={account.id}
                type="button"
                onClick={() => fillDemoAccount(account.email, account.password, account.role)}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-white hover:shadow-sm"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">{account.role}</p>
                <p className="mt-2 text-base font-semibold text-slate-900">{account.label}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{account.summary}</p>
                <p className="mt-3 text-xs text-blue-600">{account.email}</p>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div>
                <Label>이름</Label>
                <Input value={name} onChange={e => setName(e.target.value)} required placeholder="홍길동" />
              </div>
              <div>
                <Label>역할</Label>
                <select
                  value={role}
                  onChange={e => setRole(e.target.value as 'teacher' | 'student')}
                  className="w-full border rounded-md px-3 py-2 mt-1 text-sm"
                >
                  <option value="student">학생</option>
                  <option value="teacher">교사</option>
                </select>
              </div>
              <div>
                <Label>전화번호</Label>
                <Input
                  value={phoneNumber}
                  onChange={e => setPhoneNumber(e.target.value)}
                  placeholder="010-1234-5678"
                />
              </div>
              {role === 'teacher' ? (
                <>
                  <div>
                    <Label>학교명</Label>
                    <Input value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="소크라중학교" />
                  </div>
                  <div>
                    <Label>학교 이메일</Label>
                    <Input
                      type="email"
                      value={schoolEmail}
                      onChange={e => setSchoolEmail(e.target.value)}
                      placeholder="teacher@school.kr"
                    />
                  </div>
                  <div>
                    <Label>교사 가입 방식</Label>
                    <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
                      교사 회원가입은 어드민 교사가 발급한 초대코드로 진행합니다. 학교 이메일은 학교 정보 확인용으로만 함께 저장됩니다.
                    </div>
                  </div>
                  <div>
                    <Label>교사 초대 코드</Label>
                    <Input
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="TCH-ABCDEFGH"
                      required
                    />
                  </div>
                  <div>
                    <Label>담당 과목</Label>
                    <Input value={subjectNames} onChange={e => setSubjectNames(e.target.value)} placeholder="수학, 과학" />
                  </div>
                  <div>
                    <Label>담당 학년</Label>
                    <Input value={gradeLevels} onChange={e => setGradeLevels(e.target.value)} placeholder="중1, 중2" />
                  </div>
                  <div>
                    <Label>담당 반</Label>
                    <Input value={classLabels} onChange={e => setClassLabels(e.target.value)} placeholder="1반, 3반, 4반" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label>학번</Label>
                    <Input value={studentNumber} onChange={e => setStudentNumber(e.target.value)} placeholder="12" />
                  </div>
                  <div>
                    <Label>반 초대 코드</Label>
                    <Input
                      value={inviteCode}
                      onChange={e => setInviteCode(e.target.value.toUpperCase())}
                      placeholder="STD-ABCDEFGH"
                      required
                    />
                  </div>
                  <div>
                    <Label>반 정보</Label>
                    <Input
                      value={studentClassLabel}
                      onChange={e => setStudentClassLabel(e.target.value)}
                      placeholder="2학년 3반"
                    />
                  </div>
                </>
              )}
            </>
          )}
          <div>
            <Label>이메일</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="email@example.com" />
          </div>
          <div>
            <Label>비밀번호</Label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          {statusMessage && <p className="rounded bg-blue-50 p-2 text-sm text-blue-700">{statusMessage}</p>}
          {error && <p className="text-red-500 text-sm bg-red-50 p-2 rounded">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '가입하기'}
          </Button>
          <p className="text-center text-sm text-gray-500">
            {mode === 'login' ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}
            <Link
              href={mode === 'login' ? '/auth/signup' : '/auth/login'}
              className="ml-1 text-blue-600 hover:underline"
            >
              {mode === 'login' ? '회원가입' : '로그인'}
            </Link>
          </p>
        </form>

        {mode === 'login' && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-500">
            <p className="font-semibold text-slate-700">빠른 진입 링크</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DEMO_ACCOUNTS.map(account => (
                <Link
                  key={account.id}
                  href={buildDemoLoginHref(account)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
                >
                  {account.label} 자동 입력
                </Link>
              ))}
            </div>
            <p className="mt-4 text-xs leading-6 text-slate-400">
              로그인 시 `SSL certificate verification failed`가 보이면, 브라우저나 Next 개발 서버가 Supabase 인증서를 신뢰하지 못하는 상태일 수 있습니다.
              VPN, 프록시, Charles, Proxyman, Clash 같은 HTTPS 가로채기 도구를 먼저 확인해보세요.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
