# SocraTeach Implementation Status

Last updated: 2026-04-12  
Source spec: `docs/SYSTEM_MAP.md`

이 문서는 "지금 코드가 어디까지 와 있는지"와 "다음에 무엇을 구현해야 하는지"를 추적하는 실무용 문서입니다.

상태 표기:
- `완료`: 현재 제품 요구에 맞는 기본 흐름이 동작함
- `부분 완료`: 일부 기능 또는 데모 수준만 구현됨
- `미구현`: 목표 구조는 정의됐지만 코드가 아직 없음

## 1. 전체 상태 요약

| 영역 | 목표 | 상태 |
|---|---|---|
| 인증/회원가입 | 교사/학생 분리 가입, 설정, 인증 | 부분 완료 |
| Teacher Home | 반별/교과별 진도 캘린더 | 부분 완료 |
| 학생 관리 | 반별 학생 목록, 학생별 관리, 메모, AI 분석 | 부분 완료 |
| 과목 관리 | 과목별/반별 평균 성적 분석 | 부분 완료 |
| 시험지 제작 | 교재 선택, 자동 생성, 검수, 편집, 근거 확인, 예약 배포 | 부분 완료 |
| 학생 홈 | 숙제 캘린더, 시험 성적, 시험 진입 | 부분 완료 |
| 학생 시험 응시 | 자동 채점, 답안 저장, 재열람 | 완료 |
| 소크라테스 튜터 | 오답 복기, 재답변, 권한 제어, 세션 복원 | 부분 완료 |
| 대시보드 분석 | 문항/개념/학생별 분석, 보강 제안 | 부분 완료 |
| 교재 파이프라인 | PDF 파싱, OCR, 목차 구조화, 시험 생성 | 부분 완료 |

## 1-1. 현재 확정된 핵심 결정

- AI 제공자는 `Gemini`를 유지합니다.
- 대표 점수 지표는 `최초 시험 점수`를 사용합니다.
- 현재 시스템에서 `course` 는 `교사 x 반 x 과목` 운영 단위로 해석합니다.
- 학생용 튜터 세션은 장기적으로 DB를 단일 소스로 사용해 기기 간 동기화를 지원해야 합니다.
- 기본 개발/운영 기준 DB는 `외부 관리형 Supabase`가 아니라 `local-only Supabase` 입니다.

## 2. 인증/회원가입

목표:
- Teacher와 Student를 구분된 흐름으로 가입
- Individual Settings 저장
- Teacher는 Teaching Settings 저장
- 인증 방식 확정 및 재인증 후 수정 가능

현재 상태: `부분 완료`

현재 있는 것:
- 로그인/회원가입 기본 폼
- Supabase Auth 기반 로그인
- `profiles` 기반 역할 분리
- 교사/학생 역할별 추가 입력 필드
- Teacher settings / Student settings 저장 구조
- 로그인 후 공통 설정 팝업 수정 흐름
- 학생 초대코드 검증 API
- 최초 어드민 교사 부트스트랩 로직
- 어드민 교사 전용 교사 초대코드 검증/발급 API
- 가입 완료 시 서버 측 finalize 처리
- 학생용 반 초대코드 생성 API
- 학생 가입 시 반/수업 자동 등록
- 교사용 승인 관리 페이지
- 교사용 온보딩 초대코드 발급 도구
- 어드민 기준 교사 승인 대기 큐 조회/상태 변경 API
- 어드민 1명, 교사 5명, 학생 150명용 시드/CSV export 스크립트
- local-only Supabase env 자동 동기화 스크립트
- remote Supabase URL을 기본적으로 차단하는 dev 실행 가드

현재 없는 것:
- 재인증 세부 정책
- 재직 증빙 업로드 기반 수동 승인 흐름
- Supabase CLI 자체 설치 자동화

주요 파일:
- `frontend/src/components/auth/AuthForm.tsx`
- `frontend/src/lib/supabase.ts`
- `frontend/src/components/workspace/WorkspaceShell.tsx`
- `frontend/src/app/teacher/verification/page.tsx`
- `backend/app/routers/workspace.py`
- `backend/app/services/verification_service.py`
- `frontend/src/proxy.ts`

## 3. Teacher Home

목표:
- 좌측 사이드바
- Settings 팝업
- 학생 관리
- 과목 관리
- 반별 진도 캘린더
- 교과별 진도 캘린더

현재 상태: `부분 완료`

현재 있는 것:
- 교사용 공통 사이드바
- 설정 팝업
- 운영형 홈 재구성
- 반별 운영 상태 카드
- 반별 달력형 진도 보드
- 교과별 달력형 진도 보드
- 보강수업 우선 추천 카드
- 교사 전체 수업 기준 AI 대화 브리핑
- 수업별 위험 지도
- 공통 오개념 / 질문 패턴 / 교사용 talk track 요약

현재 없는 것:
- 시험/숙제 일정 기반 진도 캘린더 고도화
- 반/과목 타임라인 세분화
- 교재 목차 진도율과 직접 연결된 세밀한 진행도
- 교재 페이지와 직접 연결된 홈 대시보드 액션

주요 파일:
- `frontend/src/app/teacher/dashboard/page.tsx`

## 4. 학생 관리

목표:
- 반 리스트
- OO반 페이지
- 반 진도 사항
- 학생 리스트
- 학생 개별 관리
- 교사 메모
- 학생별 AI 튜터 분석

현재 상태: `부분 완료`

현재 있는 것:
- 전용 `teacher/students` 페이지
- 반별 학생 목록 UI
- 학생별 상세 drill-down
- 교사 메모 저장
- 과목별/목차별 막대그래프
- 학생별 AI 분석 요약 UI
- 학생 개별 Gemini 브리핑
- 최근 튜터 대화 요약 카드
- 대화 원문 기반 반복 오개념/질문 방식/하이라이트 분석

현재 없는 것:
- 반 진도 전용 서브 라우트 분리
- 학생 상세를 독립 페이지 또는 고정 drawer로 정교화
- 학생 상세 브리핑의 더 세밀한 액션 연결

추천 우선 구현:
1. 학생 상세 화면 UX 세분화
2. 반 진도 탭 분리
3. 실제 반/과목 매핑 데이터 정교화
4. 실제 LLM 기반 학생별 오개념 요약

## 5. 과목 관리

목표:
- 담당 과목 리스트
- 목차별 평균 시험 점수
- 반별 비교
- 막대그래프 통일

현재 상태: `부분 완료`

현재 있는 것:
- 전용 `teacher/subjects` 페이지
- 과목별 평균 집계 API
- 반별 비교 막대그래프
- 가장 어려운 문항 목록
- 교사용 추천 문장 UI
- 과목별 Gemini 브리핑

현재 없는 것:
- 실제 교과 일정 캘린더
- 과목별 drill-down 액션
- 고급 필터링과 정렬 제어

추천 우선 구현:
1. 반/학년/과목 다중 필터
2. 문항-교재 페이지-대화 근거 연결 강화
3. 보강수업 추천과 연결된 액션 버튼

## 6. 시험지 제작

목표:
- 과목, 교재, 목차, 시험 초안 선택
- 선택 완료 후 작업 팝업 오픈
- 교재 보기 / 문항 편집 / 학생용 미리보기 분리
- 기본 10문항 자동 생성
- 근거 페이지 PDF/ebook 뷰어
- 저장, 예약 배포, 공지

현재 상태: `부분 완료`

현재 있는 것:
- 교재 기반 초안 목록
- 교재 초안 + 업로드 자료 생성 draft 통합 선택 흐름
- 시험지 제작실 내 `DB 교재 카탈로그` 동기화/열람 패널
- 교재 단원별 AI 생성 초안 개수 표시
- 교재 카탈로그 단원에서 시험지 제작 4단계 선택 흐름으로 1클릭 연결
- 동기화된 교재 범위를 저장된 시험 row의 `textbook_id / textbook_toc_node_id` 로 자동 연결
- 선택 교재 기준 기존 시험의 카탈로그 연결 보정(backfill)
- 문항별 `source_chunk_ids` 자동 저장
- 학생/교사용 화면에서 DB 기준 근거 텍스트 조각 미리보기
- 시험지 제작실 기본 구조
- 전체 화면 팝업 워크스페이스
- 모드 분리: reader / editor / student-paper
- 학생용 시험지 미리보기
- 페이지당 6문항 렌더링
- 교재 PDF 뷰어 링크
- 시험 저장/배포
- 구조화 payload 기반 시험 저장 API
- 저장된 draft 시험 개별 문항 autosave / PATCH API
- 저장된 draft 시험 재편집 흐름
- 응시 시작 전 시험만 수정 가능하도록 안전 잠금
- 자료 기반 draft 시험을 시험지 제작실에서 바로 열기
- 교육 목적 메타데이터 저장/수정
- 학생 시험/튜터 화면으로 교육 목적 맥락 전달
- 자료실 실시간 파이프라인 보드와 단계별 진행률 UI
- 공지 시작 시각 + 마감일 기반 예약 배포
- `scheduled -> published` 자동 활성화와 알림 생성
- 교사 시험지 제작실의 예약/알림 운영 상태 카드

현재 없는 것:
- 업로드한 일반 교재 PDF를 즉시 구조화해서 실시간 시험 생성
- 외부 워커/크론 기반 예약 공지 스케줄러 고도화

주요 파일:
- `frontend/src/app/teacher/exams/page.tsx`
- `backend/app/routers/exams.py`
- `backend/app/services/textbook_exam_service.py`
- `backend/app/services/exam_authoring_service.py`
- `backend/app/services/exam_service.py`

## 7. 학생 홈 / 시험 / 성적

목표:
- 숙제 캘린더
- 시험 성적 페이지
- 시험 페이지
- AI 튜터 우측 패널

현재 상태: `부분 완료`

현재 있는 것:
- 학생 홈 재구성
- 실제 달력형 숙제 캘린더
- 숙제 진행 목록
- 학생 시험 응시 화면
- 학생 성적 전용 페이지
- 우측 AI 튜터 패널 구조
- 공통 학생 사이드바 + 설정 팝업
- 최근 오답 기반 튜터 이동
- 학생별 강점/약점 표시
- 시험/성적 맥락 기반 튜터 연결
- 시험 오답에서 튜터로 이동할 때 근거 텍스트 조각까지 함께 전달
- 제출 완료 시 알림 read 처리
- 예약된 시험이 시작 시각이 되면 자동으로 학생 목록/알림에 노출
- 알림 카드에서 시험 제목/마감/시험형 여부까지 함께 표시

현재 없는 것:
- 공지 읽음 처리와 알림 유지 정책 정교화
- 시험 성적 페이지의 더 깊은 비교 분석

주요 파일:
- `frontend/src/app/student/dashboard/page.tsx`
- `frontend/src/app/student/exams/page.tsx`
- `frontend/src/app/student/tutor/page.tsx`

## 8. 학생 시험 응시와 오답 복기

목표:
- 온라인 시험 응시
- 자동 채점
- 답안 저장
- 오답 소크라테스 복기
- 정답 도달 후 해설 열람

현재 상태: `완료`

현재 있는 것:
- 시험 상세 로딩
- 답안 제출
- 자동 채점
- 오답 review API
- 정답 또는 복기 완료 후에만 해설/근거 공개
- 해설 공개 시 페이지 이미지 + 근거 텍스트 조각 함께 표시

주요 파일:
- `backend/app/services/exam_service.py`
- `backend/app/routers/exams.py`
- `backend/app/routers/chat.py`
- `backend/app/services/socratic_service.py`
- `frontend/src/app/student/exams/page.tsx`

## 9. 대시보드 분석과 보강 추천

목표:
- 반별 문항 오답률
- 학생별 취약 개념
- 튜터 대화 분석
- 공통 오개념 파악
- 교사용 보강수업 추천

현재 상태: `부분 완료`

현재 있는 것:
- 반 전체 개념 분석
- 어려운 개념/강점 개념
- 숙제 진행 현황
- 시험 통계
- 규칙 기반 개입 추천
- 학생별 AI 분석 요약
- 과목별 최저 목차/최저 문항 표시
- 과목별 공통 혼동 패턴과 질문 방식 요약
- 튜터 대화 원문에서 추출한 보강 수업 추천 문장
- 교사 전체 수업 단위 Gemini 브리핑
- 대화 원문 기반 executive summary / misconceptions / question patterns / teacher talk track
- 학생 상세 Gemini 브리핑
- 과목 상세 Gemini 브리핑
- 대시보드 내 대화 근거 예시와 수업별 위험 지도
- LLM 요약 결과 5분 메모리 캐시

현재 없는 것:
- 교사가 실제로 말할 문장 제안의 더 세밀한 맞춤화
- 교재 페이지와 연결된 추천 액션
- 반/학생/과목 간 추천 우선순위 엔진

주요 파일:
- `backend/app/services/analytics_service.py`
- `backend/app/routers/analytics.py`
- `frontend/src/app/teacher/dashboard/page.tsx`

## 10. 교재 업로드와 OCR 파이프라인

목표:
- 교사 PDF 업로드
- 페이지별 OCR
- AI 구조화
- 목차/페이지 범위 저장
- 시험 초안 자동 생성

현재 상태: `부분 완료`

현재 있는 것:
- PDF 업로드
- OCR fallback
- macOS Vision OCR
- Windows PaddleOCR 설계
- 금성 교재용 OCR/manifest/시험 초안 배치 파이프라인
- `009_textbook_catalog.sql` 기반 교재 카탈로그 테이블 설계
- 파일 교재를 `textbooks / textbook_toc_nodes / textbook_pages`로 동기화하는 API
- 교재 OCR 텍스트를 `textbook_chunks`로 분할 저장
- 시험지 제작실에서 교재 카탈로그 동기화/열람 UI
- 동기화된 교재로 만든 시험/수정 시험을 `exams.textbook_id / textbook_toc_node_id` 와 연결
- 기존 저장 시험을 교재 카탈로그 ID로 다시 연결하는 backfill API
- 기존 문항의 `source_chunk_ids` 를 다시 채우는 backfill
- 자료 업로드 후 DB 상태 추적
- `queued -> parsing -> indexing -> completed/failed` 처리 흐름
- 자료실 자동 새로고침 기반 진행 상태 표시
- 페이지별 텍스트 `material_pages` 저장
- 자료 요약 생성
- 페이지 범위 기반 단원/교육 목적 추론
- 단원별 자동 draft 시험 생성
- 생성된 시험을 기존 draft로 업데이트하거나, 응시가 있으면 잠금 처리

현재 없는 것:
- 문항 단위 `textbook_chunks` 를 넘어 더 세밀한 개념/엔티티 참조 연결
- 일반 교재에 대한 더 정교한 목차/개념 구조화
- 자료실 UI에서 섹션 수/문항 수를 조절하는 고급 생성 옵션

주요 파일:
- `backend/app/services/document_parsing_service.py`
- `backend/scripts/kumsung_middle_pipeline.py`
- `backend/scripts/run_kumsung_full_batch.py`
- `backend/data/kumsung_middle/*`

## 11. 필요한 DB/마이그레이션 상태

이미 적용되어야 하는 기반:
- `001_initial_schema.sql`
- `002_tutor_transcripts.sql`
- `003_assessments_and_chat_sources.sql`
- `004_exam_workflows.sql`
- `005_textbook_assignment_pipeline.sql`
- `006_workspace_domain_and_settings.sql`
- `007_verification_and_material_jobs.sql`
- `008_material_pages_and_generation.sql`
- `009_textbook_catalog.sql`
- `010_exam_question_chunk_refs.sql`

추가로 필요한 것:
- assignment scheduling 고도화용 테이블
- question analytics 집계 테이블
- LLM 기반 분석 캐시 또는 요약 테이블

참고 문서:
- `docs/DB_MIGRATIONS.md`

## 12. 다음 구현 우선순위

1. 예약 공지 스케줄러와 알림 상태 관리
2. 교재 구조화 정식 엔티티 도입
3. 보강수업 추천 우선순위 엔진 고도화
4. 업로드 자료 원문 reader / ebook 연동 고도화
5. 재직 증빙 업로드 기반 교사 수동 승인
6. 교재 목차 진도율과 달력 직접 연결
7. 데모 리허설과 시연용 자료 정리

## 13. 문서 유지 규칙

- 제품 목표와 UX 정의는 `SYSTEM_MAP.md`를 먼저 수정합니다.
- 구현 완료/부분 완료/미구현 여부는 이 문서를 같이 수정합니다.
- 새로운 큰 기능이 들어오면 "목표", "현재 상태", "주요 파일", "다음 작업" 네 가지를 최소한 기록합니다.

## 14. QA 자산

현재 있는 것:
- 최종 QA/데모 체크리스트 문서
- 서버 자동 기동 + local Supabase 확인 + 임시 시험 생성/정리까지 포함한 최종 스모크 테스트
- 5분/10분 발표용 데모 런북
- 발표 슬라이드용 1페이지 요약 문안
- 발표 슬라이드용 제목/본문 문안

주요 파일:
- `docs/FINAL_QA_AND_DEMO.md`
- `docs/DEMO_RUNBOOK.md`
- `docs/PRESENTATION_BRIEF.md`
- `docs/PRESENTATION_SLIDES.md`
- `scripts/run_final_qa.sh`
- `backend/scripts/final_demo_smoke.py`
