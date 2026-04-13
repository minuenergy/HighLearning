# SocraTeach Local-Only Setup

Last updated: 2026-04-11

이 문서는 SocraTeach를 `외부 Supabase 없이`, 로컬 Supabase 스택만으로 실행하는 기준 절차를 정리합니다.

## 1. 이 문서의 목표

지금 SocraTeach는 아래 2가지를 Supabase에 의존합니다.
- 인증/세션
- 관계형 운영 데이터

그래서 `외부 관리형 Supabase`를 안 쓰려면, 현재 기준 가장 안전한 방법은:
- `로컬 Supabase`
- `로컬 FastAPI backend`
- `로컬 Next.js frontend`

조합으로 돌리는 것입니다.

즉, `local-only`는 가능합니다.
다만 현재 구조상 `Supabase를 완전히 제거`하는 것이 아니라, `Supabase를 내 컴퓨터에서 직접 띄우는 방식`이 기본 경로입니다.

## 2. 준비물

- Docker Desktop
- Python 3
- Node.js / npm

추가 메모:
- 전역 Supabase CLI는 필수가 아닙니다.
- 이 프로젝트는 루트 `package.json` 의 devDependency로 로컬 Supabase CLI를 사용합니다.

## 3. 현재 프로젝트 기준 로컬 실행 순서

1. 루트 의존성 설치
2. 로컬 Supabase 스택 시작 + env 동기화
3. 마이그레이션 적용
4. 앱 실행

권장 명령:

```bash
cd socrateach
npm install
python3 scripts/sync_local_supabase_env.py --start
npm run supabase:db:reset
npm run dev
```

설명:
- `sync_local_supabase_env.py --start`
  - 루트 `node_modules/.bin/supabase` 를 우선 사용합니다.
  - `backend/supabase/config.toml` 기준으로 로컬 Supabase를 시작합니다.
  - `backend/.env`, `frontend/.env.local` 을 로컬 값으로 자동 동기화합니다.
- `npm run supabase:db:reset`
  - 로컬 DB를 비우고 `backend/supabase/migrations/001 ~ 010` 을 순서대로 다시 적용합니다.
- `npm run dev`
  - 이제 `dev.sh` 가 remote Supabase URL을 막고 local-only 환경에서만 실행됩니다.

## 4. 생성/동기화되는 env 파일

백엔드:
- `backend/.env`

프론트엔드:
- `frontend/.env.local`

자동 반영되는 핵심 값:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

보존되는 값:
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- PostHog 값
- 문서 파서 관련 설정

## 5. local-only 강제 동작

이제 `dev.sh` 는 기본적으로 아래를 검사합니다.
- `backend/.env` 의 `SUPABASE_URL` 이 localhost/127.0.0.1 인지
- `frontend/.env.local` 의 `NEXT_PUBLIC_SUPABASE_URL` 이 localhost/127.0.0.1 인지

로컬 주소가 아니면 실행을 멈추고, 로컬 env 동기화 명령을 안내합니다.

예외적으로 이전 remote 설정으로 테스트해야 하면:

```bash
ALLOW_REMOTE_SUPABASE=1 npm run dev
```

하지만 이 경로는 임시 우회용이고, 기본 운영 방향은 local-only 입니다.

## 6. 자주 쓰는 명령

```bash
cd socrateach

# 로컬 Supabase 시작
npm run supabase:start

# env 파일만 다시 동기화
npm run supabase:env

# Supabase 시작 + env 동기화
npm run supabase:env:start

# 상태 확인
npm run supabase:status

# 마이그레이션 재적용
npm run supabase:db:reset

# 로컬 앱 실행
npm run dev

# 로컬 Supabase 중지
npm run supabase:stop
```

## 7. 주의할 점

- 학생/교사가 각자 다른 기기에서 접속하려면, 결국 이 로컬 스택이 떠 있는 머신이 항상 켜져 있어야 합니다.
- 즉 `외부 관리형 DB를 안 쓴다`는 가능하지만, 여러 사람이 접속하려면 `내가 관리하는 서버`에는 올려야 합니다.
- 그래도 그 서버가 직접 띄운 self-hosted Supabase라면, 요구한 `외부 DB 미사용` 조건은 유지됩니다.

## 8. 현재 한계

이번 변경으로 `local-only 기본 경로`와 `local Supabase 설정/동기화`는 잡혔습니다.

하지만 아래는 여전히 Supabase 기반입니다.
- 브라우저 인증
- 백엔드 table access
- seed 계정 생성

즉, 현재 상태는:
- `외부 Supabase 제거`는 완료
- `Supabase 자체 제거`는 아직 아님

후자를 원하면 별도 대형 리팩터링이 필요합니다.
