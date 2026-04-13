# SocraTeach Final QA And Demo

Last updated: 2026-04-12

이 문서는 출시 직전 또는 시연 직전에 실행하는 최종 QA 체크리스트와 데모 진행 순서를 정리합니다.

## 1. 목적

- 핵심 사용자 흐름이 실제로 이어지는지 확인
- 데모 중 끊기기 쉬운 지점을 사전에 점검
- 반복 실행 가능한 자동 스모크 테스트와 수동 시연 체크리스트를 분리

## 2. 사전 조건

필수 조건:
- local-only Supabase 실행 중
- `backend/.env`, `frontend/.env.local` 동기화 완료
- 시드 데이터 생성 완료

핵심 시드 계정:
- 어드민 교사: `admin@socrateach.school / SocraTeachAdmin!2026`
- 교사 데모 계정: `teacher01@socrateach.school / SocraTeachTeacher!2026`
- 학생 데모 계정: `student001@socrateach.school / SocraTeachStudent!2026`

참고 CSV:
- [teacher_accounts.csv](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/backend/supabase/seeds/generated/teacher_accounts.csv)
- [student_accounts.csv](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/backend/supabase/seeds/generated/student_accounts.csv)
- [invite_codes.csv](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/backend/supabase/seeds/generated/invite_codes.csv)

## 3. 자동 스모크 테스트

실행 명령:

```bash
cd socrateach
npm run qa:final
```

내부적으로 하는 일:
- 백엔드 `8000`, 프론트엔드 `3000` 자동 기동
- 공개 프론트 페이지 응답 확인
- 교사 학생/과목 관리 API 및 Gemini 브리핑 확인
- 임시 시험 생성
- 예약 배포
- 학생 목록 조회 시 `scheduled -> published` 자동 활성화 확인
- 학생 알림 생성 확인
- 학생 시험 제출 확인
- 제출 후 알림 정리 확인
- 오답 복기 후 `resolved_via_tutor` 확인
- 마지막에 임시 시험 자동 정리

자동 스모크 스크립트:
- [final_demo_smoke.py](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/backend/scripts/final_demo_smoke.py)
- [run_final_qa.sh](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/scripts/run_final_qa.sh)

자동 스모크 통과 기준:
- 오류 없이 종료
- `총 4개 시나리오 통과` 출력

발표용 시연 대본:
- [DEMO_RUNBOOK.md](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/docs/DEMO_RUNBOOK.md)

발표용 1페이지 요약 문안:
- [PRESENTATION_BRIEF.md](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/docs/PRESENTATION_BRIEF.md)

발표 슬라이드용 제목/본문 문안:
- [PRESENTATION_SLIDES.md](/Users/asap/Documents/Claude/Projects/education_tech/socrateach/docs/PRESENTATION_SLIDES.md)

## 4. 수동 QA 체크리스트

### 4-1. 인증 / 가입

확인 항목:
- 로그인 페이지 진입 가능
- 교사 회원가입 폼에서 초대코드 입력 흐름 노출
- 학생 회원가입 폼에서 학생 초대코드 입력 흐름 노출
- 로그인 후 설정 팝업에서 개인 정보 수정 가능

통과 기준:
- 입력 폼이 깨지지 않고 저장 후 다시 불러오면 값이 유지됨

### 4-2. 교사 홈

확인 항목:
- 좌측 사이드바 이동 정상
- 설정 버튼은 좌측 하단만 존재
- 반별 운영 카드 노출
- 반별/교과별 달력 보드 노출
- AI 대화 브리핑 노출

통과 기준:
- 홈 진입 후 빈 화면이나 `Failed to fetch` 없이 카드와 달력이 렌더링됨

### 4-3. 학생 관리

확인 항목:
- 반 목록 선택 가능
- 학생 목록 스크롤 및 학생 선택 가능
- 교사 메모 저장 가능
- 학생 개별 Gemini 브리핑 노출
- AI 튜터 분석 카드에 오개념/질문 패턴/하이라이트가 표시됨
- 최근 튜터 대화 카드 노출

통과 기준:
- 학생 전환 시 상세 정보와 메모, 브리핑이 함께 갱신됨

### 4-4. 과목 관리

확인 항목:
- 과목 목록 선택 가능
- 목차별 점수 그래프 노출
- 반별 비교 그래프 노출
- 가장 어려운 문항 목록 노출
- 과목별 Gemini 브리핑 노출

통과 기준:
- 과목 전환 시 그래프와 브리핑이 함께 갱신됨

### 4-5. 시험지 제작

확인 항목:
- 왼쪽 4단계 선택 흐름 동작
- 교재 초안 또는 업로드 자료 draft 선택 가능
- 워크스페이스 팝업 진입 가능
- 문항 편집 가능
- autosave 동작
- 학생용 미리보기 정상
- 예약 배포 가능
- 예약/알림 운영 상태 카드 노출

통과 기준:
- 시험 저장 후 같은 시험을 다시 열 수 있고, 예약 배포 후 상태 카드에 반영됨

### 4-6. 학생 홈 / 시험 / 튜터

확인 항목:
- 학생 홈 숙제 달력 렌더링
- 알림 카드에 시험 제목/마감/시험형 여부 표시
- 시험 목록 진입 가능
- 시험 제출 후 자동 채점
- 오답 문항에서 튜터 이동 가능
- 복기 후 해설/근거 텍스트 조각 확인 가능

통과 기준:
- 제출 전에는 해설이 숨겨지고, 제출 후 오답 복기 흐름이 이어짐

### 4-7. 자료실

확인 항목:
- 자료 업로드 가능
- 상태 보드 4단계 표시
- 진행률 표시
- 생성된 draft 시험이 시험지 제작실과 연결됨

통과 기준:
- 자료 카드와 상세 패널이 같은 상태를 표시하고, 생성 draft가 편집기로 열림

## 5. 권장 데모 시나리오

### 시나리오 A. 어드민에서 교사 온보딩까지

순서:
1. 어드민 계정 로그인
2. `승인 관리` 진입
3. 교사 초대코드 발급
4. 발급된 코드가 목록에 생기는지 확인

핵심 메시지:
- 어드민 한 명이 전체 교사 온보딩을 통제할 수 있음

### 시나리오 B. 교사 운영 화면

순서:
1. `teacher01@socrateach.school` 로그인
2. 교사 홈에서 운영 카드와 AI 브리핑 확인
3. 학생 관리에서 특정 학생 선택
4. 학생 개별 Gemini 브리핑과 메모 확인
5. 과목 관리에서 과목별 Gemini 브리핑 확인

핵심 메시지:
- 교사는 반 단위 운영 정보와 학생 개별 이해 상태를 동시에 볼 수 있음

### 시나리오 C. 시험 제작과 예약 배포

순서:
1. 시험지 제작실 진입
2. 교재 또는 자료 draft 선택
3. 문항 수정
4. 예약 시작 시각과 마감일 설정
5. 배포
6. 예약/알림 운영 상태 카드 확인

핵심 메시지:
- 시험 제작부터 예약 배포까지 한 화면에서 운영 가능

### 시나리오 D. 학생 시험 응시와 오답 복기

순서:
1. `student001@socrateach.school` 로그인
2. 학생 홈에서 알림 카드 확인
3. 시험 화면 진입
4. 일부 문항 오답 제출
5. 오답 복기 시작
6. 복기 후 해설과 근거 조각 확인

핵심 메시지:
- 학생은 정답을 바로 받지 않고, 소크라테스식 대화로 복기한 뒤 해설을 확인함

### 시나리오 E. 교사 재확인

순서:
1. 다시 교사 화면으로 복귀
2. 학생 관리에서 해당 학생 브리핑 확인
3. 과목 관리에서 공통 패턴 확인
4. 교사 홈에서 AI 대화 브리핑 확인

핵심 메시지:
- 학생 개별 복기와 수업 전체 분석이 한 제품 안에서 이어짐

## 6. 데모 당일 권장 순서

1. 어드민 초대코드 발급
2. 교사 홈
3. 학생 관리
4. 과목 관리
5. 시험지 제작
6. 학생 시험 응시
7. 오답 복기
8. 다시 교사 분석 화면

## 7. 데모 당일 실패 시 우선 확인

1. `npm run qa:final`이 통과하는지 먼저 확인
2. `backend/.env`, `frontend/.env.local`이 local-only 값인지 확인
3. local Supabase가 살아 있는지 확인
4. 시드 CSV와 실제 DB가 일치하는지 확인
5. `teacher01`, `student001` 계정으로 직접 로그인 가능한지 확인

## 8. 권장 마감 기준

출시 또는 시연 가능 기준:
- 자동 스모크 테스트 통과
- 수동 QA에서 인증, 교사 운영, 시험 제작, 학생 응시, 오답 복기 흐름 통과
- `Failed to fetch`, 500, 빈 카드 렌더링이 재현되지 않음
- 시드 계정 3종으로 데모 흐름이 10분 안에 안정적으로 진행됨
