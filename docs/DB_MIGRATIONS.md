# SocraTeach DB Migrations

Last updated: 2026-04-11

이 문서는 SocraTeach에서 말하는 "마이그레이션"이 무엇인지, 현재 프로젝트에서는 어떤 파일을 언제 적용해야 하는지, 적용 후 무엇을 확인해야 하는지를 정리한 실무용 문서입니다.

## 1. 마이그레이션이란

마이그레이션은 `DB 구조 변경 기록`입니다.

쉽게 말하면:
- 프론트/백엔드 코드가 새 기능을 쓰기 시작하면
- DB에도 그 기능을 이해할 수 있는 테이블, 컬럼, 인덱스, 정책이 필요하고
- 그 변경 내용을 SQL 파일로 순서대로 관리하는 것이 마이그레이션입니다.

예시:
- 코드에서 `teacher_settings` 테이블에 저장하려고 하는데
- DB에 그 테이블이 없으면 저장이 실패합니다.
- 그래서 먼저 해당 테이블을 만드는 SQL을 DB에 적용해야 합니다.

## 2. 이 프로젝트에서 마이그레이션 파일 위치

마이그레이션 폴더:
- `backend/supabase/migrations/`

현재 사용 중인 파일:
1. `001_initial_schema.sql`
2. `002_tutor_transcripts.sql`
3. `003_assessments_and_chat_sources.sql`
4. `004_exam_workflows.sql`
5. `005_textbook_assignment_pipeline.sql`
6. `006_workspace_domain_and_settings.sql`
7. `007_verification_and_material_jobs.sql`
8. `008_material_pages_and_generation.sql`
9. `009_textbook_catalog.sql`
10. `010_exam_question_chunk_refs.sql`
11. `011_atomic_invite_consume.sql`

## 3. 각 마이그레이션이 하는 일

### 001_initial_schema.sql

기본 운영 테이블을 만듭니다.
- `profiles`
- `courses`
- `enrollments`
- `materials`
- `tutor_sessions`
- `concept_stats`

### 002_tutor_transcripts.sql

튜터 대화 세션과 메시지 테이블을 추가합니다.
- `tutor_conversations`
- `tutor_messages`

### 003_assessments_and_chat_sources.sql

시험 기능의 기본 스키마를 추가합니다.
- `exams`
- `exam_questions`
- `exam_attempts`
- `exam_answers`
- 튜터 대화의 `source_type`, `source_reference_id`, `focus_question`

### 004_exam_workflows.sql

시험 생성/복기 워크플로에 필요한 컬럼을 추가합니다.
- `exams.source_format`
- `exams.created_by`
- `exam_answers.corrected_choice`
- `exam_answers.resolved_via_tutor`

### 005_textbook_assignment_pipeline.sql

교재 기반 시험 생성과 배포 흐름을 확장합니다.
- `workflow_status`
- `assignment_type`
- `due_at`
- `published_at`
- 교재/목차/근거 페이지 관련 컬럼
- `notifications`

### 006_workspace_domain_and_settings.sql

이번 워크스페이스 개편에서 필요한 구조를 추가합니다.
- `profiles.phone_number`
- `school_classes`
- `subjects`
- `teacher_settings`
- `student_settings`
- `teacher_notes`
- `courses`의 반/과목 관련 컬럼

이 파일이 있어야 아래 기능이 정상 동작합니다.
- 교사/학생 설정 팝업 저장
- 학생 관리 페이지
- 과목 관리 페이지
- 교사 메모 저장
- 반/과목 기준 운영 정보 조회

### 007_verification_and_material_jobs.sql

실제 인증과 자료 처리 상태 관리를 위한 구조를 추가합니다.
- `invite_codes`
- `student_settings`의 인증 상태 컬럼
- `teacher_settings`의 인증 메모/초대코드 사용 이력
- `materials`의 처리 상태 컬럼

이 파일이 있어야 아래 기능이 정상 동작합니다.
- 학생 반 초대코드 가입
- 최초 어드민 교사 이후 교사 초대코드 기반 가입 검증
- 어드민 교사의 교사 초대코드 생성
- 검증 완료된 교사의 학생 반 초대코드 생성
- 자료 업로드 후 `queued -> parsing -> indexing -> completed/failed` 상태 추적

추가 메모:
- `backend/supabase/seeds/seed_admin_invite_accounts.py` 를 실행하려면 최소 `006`, `007` 이 실제 로컬 Supabase DB에 적용돼 있어야 합니다.
- 이 스크립트는 `어드민 교사 1명 -> 초대코드 가입 교사 5명 -> 학생 초대코드 가입 학생 150명` 흐름을 실제 계정으로 시드하고 CSV를 생성합니다.

### 008_material_pages_and_generation.sql

업로드 자료를 페이지 단위로 저장하고, 자료 기반 시험 초안 자동 생성을 위한 구조를 추가합니다.
- `material_pages`
- `materials.page_count`
- `materials.summary_text`
- `materials.detected_sections`
- `materials.draft_generation_status`
- `materials.draft_generation_stage`
- `materials.draft_generation_error`
- `materials.draft_generated_count`
- `materials.last_generated_at`
- `exams.material_id`
- `exams.learning_objective`
- `exams.source_format = material_generated`

이 파일이 있어야 아래 기능이 정상 동작합니다.
- 업로드 자료의 페이지별 텍스트 저장
- 자료실 상세 화면의 요약/단원 분석 표시
- 단원별 자동 draft 시험 생성
- 자료 기반 draft를 저장된 시험으로 다시 열고 수정하는 흐름

### 009_textbook_catalog.sql

파일 기반 교재를 정식 카탈로그 엔티티로 옮기기 위한 구조를 추가합니다.
- `textbooks`
- `textbook_toc_nodes`
- `textbook_pages`
- `textbook_chunks`
- `exams.textbook_id`
- `exams.textbook_toc_node_id`
- `workflow_status = scheduled`

이 파일이 있어야 아래 기능이 정상 동작합니다.
- 파일 교재를 DB 교재 카탈로그로 동기화
- 교재별 페이지/목차 메타데이터 저장
- 예약 배포 상태 `scheduled` 저장
- 향후 `exam -> textbook/toc` 정식 참조 연결

현재 프론트엔드 기준 메모:
- 시험지 제작실의 `DB 교재 카탈로그` 패널은 마이그레이션이 없어도 filesystem fallback 목록/상세 열람은 가능
- 하지만 `전체 교재 동기화`, `선택 교재 동기화`, 실제 DB 기준 `synced_at` 확인은 `009_textbook_catalog.sql` 적용 후에만 정상 의미를 가짐
- 또한 교재 기반 시험 저장 시 `exams.textbook_id / textbook_toc_node_id` 자동 연결도 이 마이그레이션이 있어야만 실제 DB에 반영됩니다
- 기존 저장 시험에 대해 교재 카탈로그 ID 연결을 다시 보정하는 backfill도 이 마이그레이션이 있어야만 동작합니다

### 010_exam_question_chunk_refs.sql

문항 단위 교재 텍스트 조각 연결을 위한 구조를 추가합니다.
- `exam_questions.source_chunk_ids`
- `idx_exam_questions_source_chunk_ids`

이 파일이 있어야 아래 기능이 정상 동작합니다.
- 교재 OCR 텍스트를 `textbook_chunks`로 쪼개고 문항별 근거 텍스트 조각을 저장
- 학생 복기 화면에서 페이지 이미지와 함께 근거 텍스트 조각 표시
- 교사용 시험 편집 화면에서 DB 기준 근거 텍스트 조각 미리보기
- 기존 문항의 `source_chunk_ids` backfill

현재 프론트엔드 기준 메모:
- `010_exam_question_chunk_refs.sql` 이 없으면 시험/문항 저장은 계속 되지만 `source_chunk_ids` 저장과 텍스트 조각 미리보기는 fallback으로 비활성 처리됩니다
- 즉, 기능이 완전히 깨지지는 않지만 문항 단위 근거 추적 품질은 `010` 적용 후에 올라갑니다

### 011_atomic_invite_consume.sql

초대코드 사용 횟수 차감을 DB 레벨에서 atomic하게 처리하는 함수를 추가합니다.
- `consume_invite_code_atomic(p_code text)`

이 파일의 목적:
- 여러 사용자가 동시에 같은 초대코드를 입력해도 `max_uses` 초과 사용을 막기 위함
- 향후 `verification_service.py` 가 RPC 경로로 전환될 때를 대비한 기반 준비

현재 코드 기준 메모:
- 현재 Python 서비스 레벨에서도 optimistic concurrency 보호가 들어가 있어 기본 흐름은 동작합니다.
- 하지만 `011` 이 적용돼 있으면 추후 DB 함수 기반 직렬화로 더 강한 보장을 넣을 수 있습니다.

## 4. 언제 어떤 파일을 적용해야 하나

### 새 로컬 Supabase 스택을 처음 세팅하는 경우

`001`부터 `011`까지 순서대로 전부 적용합니다.

실행 순서:
1. `001_initial_schema.sql`
2. `002_tutor_transcripts.sql`
3. `003_assessments_and_chat_sources.sql`
4. `004_exam_workflows.sql`
5. `005_textbook_assignment_pipeline.sql`
6. `006_workspace_domain_and_settings.sql`
7. `007_verification_and_material_jobs.sql`
8. `008_material_pages_and_generation.sql`
9. `009_textbook_catalog.sql`
10. `010_exam_question_chunk_refs.sql`
11. `011_atomic_invite_consume.sql`

### 기존 프로젝트에 이미 001~005가 적용된 경우

이번 변경에서는 아래를 순서대로 추가 적용하면 됩니다.
- `006_workspace_domain_and_settings.sql`
- `007_verification_and_material_jobs.sql`
- `008_material_pages_and_generation.sql`
- `009_textbook_catalog.sql`
- `010_exam_question_chunk_refs.sql`
- `011_atomic_invite_consume.sql`

## 5. 지금 프로젝트에서는 어떻게 적용하나

현재 리포지토리에는 로컬 Supabase CLI 설정이 들어가 있습니다.

기본 설정 파일:
- `backend/supabase/config.toml`

권장 절차:
1. `npm install`
2. `python3 scripts/sync_local_supabase_env.py --start`
3. `npm run supabase:db:reset`

이렇게 하면 로컬 DB를 다시 만들고 `001 -> 011` 마이그레이션이 순서대로 적용됩니다.

## 6. 적용 절차

### 권장: CLI로 한 번에 적용

1. `cd socrateach`
2. `npm install`
3. `python3 scripts/sync_local_supabase_env.py --start`
4. `npm run supabase:db:reset`

### 수동으로 적용하고 싶다면

1. `cd socrateach/backend`
2. 로컬 Studio 또는 SQL 접속 도구에서 DB를 엽니다.
3. `backend/supabase/migrations/001 ~ 010` 을 순서대로 실행합니다.
4. fresh setup이면 전부 적용합니다.
5. 일부만 업데이트하려면 아직 안 들어간 최신 파일만 실행합니다.

## 7. 적용 후 확인 방법

### 006이 정상 적용됐는지 확인

테이블 목록에서 아래가 보여야 합니다.
- `school_classes`
- `subjects`
- `teacher_settings`
- `student_settings`
- `teacher_notes`

그리고 `profiles` 테이블에 아래 컬럼이 있어야 합니다.
- `phone_number`

그리고 `courses` 테이블에 아래 컬럼들이 있어야 합니다.
- `school_class_id`
- `subject_id`
- `academic_year`
- `grade_level`
- `class_label`
- `subject_name`

### 007이 정상 적용됐는지 확인

테이블 목록에서 아래가 보여야 합니다.
- `invite_codes`

그리고 `materials` 테이블에 아래 컬럼들이 있어야 합니다.
- `processing_status`
- `processing_stage`
- `parser_used`
- `chunk_count`
- `extracted_char_count`
- `error_message`

그리고 `student_settings` 테이블에 아래 컬럼들이 있어야 합니다.
- `verification_status`
- `verification_method`

그리고 아래 테이블들이 실제로 조회되어야 합니다.
- `teacher_settings`
- `student_settings`
- `school_classes`
- `subjects`
- `invite_codes`
- `verified_at`
- `invite_code_used`

### 008이 정상 적용됐는지 확인

테이블 목록에서 아래가 보여야 합니다.
- `material_pages`

그리고 `materials` 테이블에 아래 컬럼들이 있어야 합니다.
- `page_count`
- `summary_text`
- `detected_sections`
- `draft_generation_status`
- `draft_generation_stage`
- `draft_generation_error`
- `draft_generated_count`
- `last_generated_at`

그리고 `exams` 테이블에 아래 컬럼들이 있어야 합니다.
- `material_id`
- `learning_objective`

그리고 `exams.source_format` 제약에 `material_generated`가 포함되어야 합니다.

## 8. 자주 헷갈리는 점

### SQL 파일을 여러 번 실행해도 되나

항상 안전하지는 않습니다.

이유:
- 일부 파일은 `CREATE TABLE`만 있고
- `IF NOT EXISTS`가 없는 구간도 있어서
- 이미 적용된 초기 마이그레이션을 다시 실행하면 에러가 날 수 있습니다.

따라서 원칙은:
- 새 DB는 `001 -> 010` 순서대로 한 번만
- 기존 DB는 아직 적용되지 않은 뒤 번호 파일만 실행

### 코드만 바꾸면 되지 않나

안 됩니다.

이 프로젝트는 코드와 DB 구조가 함께 맞아야 합니다.

예를 들어:
- 프론트가 설정 저장 API를 호출하고
- 백엔드가 `teacher_settings`에 쓰려고 해도
- DB에 해당 테이블이 없으면 실패합니다.

### `column profiles.phone_number does not exist` 에러가 뜨면

이 에러는 거의 항상 `006_workspace_domain_and_settings.sql`이 실제 DB에 적용되지 않았다는 뜻입니다.

확인할 것:
- `profiles.phone_number` 컬럼 존재 여부
- `teacher_settings`, `student_settings`, `teacher_notes` 테이블 존재 여부
- `courses.school_class_id`, `courses.subject_id` 등 006에서 추가된 컬럼 존재 여부

현재 백엔드 코드는 이 컬럼이 없어도 조회는 최대한 계속되도록 하위 호환 처리되어 있지만, 설정 저장과 워크스페이스 기능을 완전히 쓰려면 결국 `006`을 적용해야 합니다.

## 9. 현재 구현과의 연결

현재 코드에서 `006_workspace_domain_and_settings.sql`에 직접 의존하는 주요 영역:
- `backend/app/services/workspace_service.py`
- `backend/app/routers/workspace.py`
- `frontend/src/components/workspace/WorkspaceShell.tsx`
- `frontend/src/app/teacher/students/page.tsx`
- `frontend/src/app/teacher/subjects/page.tsx`
- `frontend/src/components/auth/AuthForm.tsx`

현재 코드에서 `007_verification_and_material_jobs.sql`에 직접 의존하는 주요 영역:
- `backend/app/services/verification_service.py`
- `backend/app/services/materials_service.py`
- `backend/app/routers/materials.py`
- `backend/app/routers/workspace.py`
- `frontend/src/components/auth/AuthForm.tsx`
- `frontend/src/app/teacher/students/page.tsx`
- `frontend/src/components/teacher/MaterialUpload.tsx`

현재 코드에서 `008_material_pages_and_generation.sql`에 직접 의존하는 주요 영역:
- `backend/app/services/document_parsing_service.py`
- `backend/app/services/materials_service.py`
- `backend/app/services/material_generation_service.py`
- `backend/app/services/exam_authoring_service.py`
- `frontend/src/app/teacher/materials/page.tsx`
- `frontend/src/app/teacher/exams/page.tsx`

즉, 이번 워크스페이스 개편 기능과 자료 기반 시험 생성 흐름을 실제로 쓰려면 `006`, `007`, `008` 적용이 필요합니다.

## 10. 관련 문서

- `README.md`
- `docs/SYSTEM_MAP.md`
- `docs/IMPLEMENTATION_STATUS.md`
