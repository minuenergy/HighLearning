# SocraTeach 🧠

AI 소크라테스 튜터 + 교사/학생 맞춤 분석 대시보드

상세 구조 문서:
- `docs/SYSTEM_MAP.md`
- 목표, 기능, 현재 구현 상태, 다음 구현 우선순위를 함께 관리하는 기준 문서
- `docs/DB_MIGRATIONS.md`
- DB 마이그레이션 개념, 적용 순서, 현재 프로젝트 기준 운영 방법 정리
- `docs/LOCAL_ONLY_SETUP.md`
- 외부 DB 없이 로컬 Supabase로만 실행하는 절차 정리

파싱 메모:
- 기본 PDF 파서는 PyMuPDF
- `DOCUMENT_PARSER=auto`일 때 macOS는 `Vision OCR`, Windows/Linux는 `PaddleOCR` fallback을 기본 사용
- 필요 시 `PaddleOCR PP-StructureV3`와 `Vision OCR`를 명시적으로 선택 가능
- 관련 환경 변수: `DOCUMENT_PARSER=auto|pymupdf|paddleocr|visionocr`, `PADDLEOCR_LANG`, `PADDLEOCR_DEVICE`, `VISION_OCR_LANGUAGES`, `VISION_OCR_FAST`, `VISION_OCR_PDF_DPI`
- 금성 중등 eBook은 직접 PDF보다 `webview/epub` 페이지 이미지 구조로 제공되는 경우가 많아, 별도 수집 스크립트가 원본 페이지 이미지와 manifest를 내려받습니다.
- macOS Apple Silicon에서는 PaddleOCR GPU/Metal 가속이 공식적으로 아닌 경로라, 금성 교재 파이프라인은 기본 OCR을 `Vision OCR`로 두고, Windows는 `PaddleOCR`를 기본으로 둡니다.

## 빠른 시작

### 1. local-only 준비
```bash
npm install
python3 scripts/sync_local_supabase_env.py --start
```

위 명령은 아래를 함께 처리합니다.
- 루트 프로젝트의 로컬 Supabase CLI 설치
- 로컬 Supabase 스택 시작
- `backend/.env` 를 localhost 기준으로 동기화
- `frontend/.env.local` 을 localhost 기준으로 동기화

추가 안내:
- 상세 절차는 `docs/LOCAL_ONLY_SETUP.md`
- 처음 한 번은 Supabase CLI 설치가 필요합니다.

### 2. Supabase DB 초기화
기본 기준 문서:
- `docs/DB_MIGRATIONS.md`

현재 프로젝트 기준 권장 방법:
- 로컬 Supabase CLI 기준으로 `db reset` 사용

Fresh setup이면 아래 명령으로 로컬 DB를 다시 만들고 마이그레이션을 전부 적용합니다.
```bash
npm run supabase:db:reset
```

수동 확인이 필요하면 아래 파일들이 순서대로 적용됩니다.
```
backend/supabase/migrations/001_initial_schema.sql
backend/supabase/migrations/002_tutor_transcripts.sql
backend/supabase/migrations/003_assessments_and_chat_sources.sql
backend/supabase/migrations/004_exam_workflows.sql
backend/supabase/migrations/005_textbook_assignment_pipeline.sql
backend/supabase/migrations/006_workspace_domain_and_settings.sql
backend/supabase/migrations/007_verification_and_material_jobs.sql
backend/supabase/migrations/008_material_pages_and_generation.sql
backend/supabase/migrations/009_textbook_catalog.sql
backend/supabase/migrations/010_exam_question_chunk_refs.sql
backend/supabase/migrations/011_atomic_invite_consume.sql
```

이미 로컬 DB에 일부만 적용된 상태라면, 가장 안전한 방법은 그대로 `supabase db reset` 으로 다시 맞추는 것입니다.

적용 후 확인 포인트:
- `teacher_settings`
- `student_settings`
- `teacher_notes`
- `school_classes`
- `subjects`
- `invite_codes`
- `materials.processing_status`
- `material_pages`
- `materials.draft_generation_status`
- `exams.learning_objective`

### 3. 한 번에 실행
```bash
npm run dev
# 또는 npm run dev:local
# frontend: http://localhost:3000
# backend: http://localhost:8000/health
```

주의:
- `dev.sh` 는 이제 기본적으로 remote Supabase URL을 거부합니다.
- localhost가 아닌 Supabase URL이 남아 있으면 실행 전에 멈추고 `python3 scripts/sync_local_supabase_env.py --start` 를 안내합니다.

### 4. 개별 실행

프론트엔드:
```bash
cd frontend
npm install
npm run dev
# http://localhost:3000
```

백엔드:
```bash
cd backend
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
# http://localhost:8000/health
```

### 5. 시뮬레이션 데이터 생성
```bash
cd backend
./.venv/bin/python scripts/simulate_school_year.py --school-level middle --students 30
# dry-run으로 생성 건수만 미리 확인

# transcript 테이블 없이 기존 스키마만 채우려면
./.venv/bin/python scripts/simulate_school_year.py --school-level middle --students 30 --without-transcripts --apply

# 시험/오답/대화 근거까지 포함한 전체 시나리오
./.venv/bin/python scripts/simulate_school_year.py --school-level middle --students 30 --apply
# 실제 Supabase DB에 1년치 시뮬레이션 데이터 + 시험/오답/튜터 사례 반영

# 시험 테이블 없이 구버전 스키마만 채우려면
./.venv/bin/python scripts/simulate_school_year.py --school-level middle --students 30 --without-assessments --apply
```

## 금성 중등 교재 파이프라인

교재 링크:
- `https://thub.kumsung.co.kr/upfiles/thub/2020/middle.html`

수집/전처리 스크립트:
- `backend/scripts/kumsung_middle_pipeline.py`

예시:
```bash
cd backend

# 전 교재 catalog + 각 책 manifest만 수집
./.ocr-venv/bin/python scripts/kumsung_middle_pipeline.py --skip-existing

# 특정 교재만 원본 페이지 다운로드
./.ocr-venv/bin/python scripts/kumsung_middle_pipeline.py --book-filter 수학1 --max-books 1 --download-pages --skip-existing

# 특정 교재 OCR 시도
./.ocr-venv/bin/python scripts/kumsung_middle_pipeline.py --book-filter 수학1 --max-books 1 --download-pages --ocr --ocr-mode text --ocr-workers 2 --max-pages-per-book 10 --skip-existing

# 전 교재 로컬 PDF/페이지 저장
./.ocr-venv/bin/python scripts/kumsung_middle_pipeline.py --download-pages --skip-existing

# 전 교재를 book-level 병렬로 처리
./.ocr-venv/bin/python scripts/run_kumsung_full_batch.py --workers 2 --ocr-workers 1 --download-workers 8 --generate-exams
```

플랫폼별 기본 OCR:
- macOS: `Vision OCR`를 기본 사용, 필요 시 `--ocr-backend paddle`로 강제 가능
- Windows: `PaddleOCR`를 기본 사용
- `--ocr-mode structure`는 플랫폼과 무관하게 `PaddleOCR`를 사용

산출물 위치:
- `backend/data/kumsung_middle/catalog.json`
- `backend/data/kumsung_middle/<book_slug>/manifest.json`
- `backend/data/kumsung_middle/<book_slug>/<book_slug>.pdf`
- `backend/data/kumsung_middle/<book_slug>/pages/`
- `backend/data/kumsung_middle/failures.json`
- `backend/data/kumsung_middle/batch_summary.json`

현재 메모:
- `2026-04-09` 기준 metadata crawl로 중등 교재 catalog 31건을 확인
- 이 중 28권은 manifest 저장 성공
- `국어 1-2`, `국어 2-2`, `국어 3-2`는 원본 viewer XML이 깨져 `failures.json`으로 분리
- 무거운 실행에서 교재는 먼저 로컬 PDF와 페이지 PNG로 저장한 뒤, 그 로컬 자산 기준으로 OCR/시험지 생성을 수행
- macOS에서는 GPU 대신 `Vision OCR` + `--download-workers` 조합을 권장
- Windows에서는 `PaddleOCR` + `--ocr-workers` 병렬화를 권장

## 배포

- **프론트엔드**: Vercel (`npx vercel --prod`)
- **백엔드**: Railway (`railway up`)

## 주요 기능

- 🤔 소크라테스식 AI 튜터 (Gemini 스트리밍)
- 📄 교사 PDF/PPTX 업로드 → 페이지별 텍스트 적재 → RAG 인덱싱 (LangChain + ChromaDB)
- 🧪 교사용 시험 업로드 스튜디오: 마크다운 시험지 업로드 + 기본 예시 시험 즉시 배포
- 🧭 업로드 자료 자동 분석: 요약 생성, 페이지 범위 기반 단원 추천, 교육 목적 초안 생성
- 📝 자료 기반 자동 시험 초안: 단원별 객관식 draft를 만들고 시험지 제작실에서 바로 재편집 가능
- 📚 금성 중등 교재 기반 자동 생성 초안: 로컬 OCR 결과를 불러와 교사가 검수용 draft로 저장하거나 편집기로 옮겨 수정 가능
- 🚚 시험/숙제 배포 워크플로: `draft -> published`, 마감일 설정, 학생 알림, 미제출 추적
- 📊 교사 대시보드: 개념별 히트맵 + 실제 질의응답 근거 + 시험 문항 분석 + 미제출 숙제 현황 + 추가 학습 개입 제안
- 📝 온라인 시험: 자동 채점, 오답 분석, 튜터 복기, 다시 답하기 연결
- 🔎 교재 근거 열람: 학생은 정답 또는 복기 완료 후에만 해설과 교재 원문 페이지를 볼 수 있음
- 🎯 학생 대시보드: 강점/약점 + 최근 시험 결과 + 틀린 문제 바로 복습
- 🔐 Local-only Supabase Auth (교사/학생 역할 분리)

## 현재 워크스페이스 확장 기능

- 교사/학생 공통 좌측 사이드바 + 설정 팝업
- Teacher Home 운영형 재구성
- 학생 관리 페이지
- 과목 관리 페이지
- 학생 성적 전용 페이지
- DB 기반 AI 튜터 세션 저장 및 기기 간 복원 구조
- 반 초대코드 발급 및 학생 가입 검증 구조
- 자료 업로드 후 처리 상태 추적 구조
- 자료 업로드 후 페이지 요약/단원 분석/자동 draft 생성 구조

## 시험지 포맷

교사는 `Teacher Exams` 화면에서 아래 포맷의 `.md` 파일을 업로드하거나 그대로 붙여넣을 수 있습니다.

```md
TITLE: 중1 일차함수 빠른 점검
DESCRIPTION: 기울기와 y절편을 4문항으로 확인하는 형성평가입니다.
DATE: 2026-05-02
DURATION: 20
TOTAL_POINTS: 40

---
CONCEPT: 중학 수학 · 일차함수와 그래프
DIFFICULTY: medium
POINTS: 10
QUESTION: y = 2x + 1에서 기울기는 무엇인가요?
A. -1
B. 0
C. 1
D. 2
ANSWER: D
EXPLANATION: y = ax + b 꼴에서 a가 기울기입니다.
```

- 문제는 `---`로 구분합니다.
- 선택지는 `A.`, `B.`, `C.` 형식으로 적습니다.
- `DIFFICULTY`는 `easy`, `medium`, `hard` 중 하나를 사용합니다.
