from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from uuid import UUID

from app.services.exam_authoring_service import (
    ExamImportError,
    create_exam_from_text,
    create_exam_from_editor_payload,
    import_exam_presets,
    list_exam_presets,
    update_exam_from_editor_payload,
)
from app.services.exam_service import (
    get_exam_detail,
    get_exam_progress,
    get_course_schedule_status,
    list_course_exams,
    list_student_notifications,
    list_student_exams,
    publish_exam,
    review_exam_answer,
    submit_exam_attempt,
)
from app.services.textbook_exam_service import (
    TextbookDraftError,
    get_textbook_draft_detail,
    get_textbook_page_path,
    get_textbook_pdf_path,
    import_all_textbook_drafts,
    import_textbook_draft_to_exam,
    list_textbook_drafts,
)
from app.services.textbook_catalog_service import (
    backfill_exam_catalog_scope,
    TextbookCatalogError,
    get_textbook_catalog_detail,
    list_textbook_catalog,
    sync_textbook_catalog,
)

router = APIRouter()


class SubmitExamRequest(BaseModel):
    student_id: UUID
    answers: dict[str, str]
    duration_minutes: int = 0


class ImportPresetRequest(BaseModel):
    teacher_id: UUID | None = None
    preset_ids: list[str] | None = None


class ReviewExamAnswerRequest(BaseModel):
    student_id: UUID
    corrected_choice: str


class PublishExamRequest(BaseModel):
    publish_at: str | None = None
    due_at: str | None = None
    assignment_type: str | None = None
    assignment_note: str | None = None


class SyncTextbookCatalogRequest(BaseModel):
    textbook_slug: str | None = None


class ImportTextbookDraftRequest(BaseModel):
    course_id: UUID
    teacher_id: UUID | None = None
    draft_id: str
    workflow_status: str = "draft"
    assignment_type: str = "homework"
    publish_at: str | None = None
    due_at: str | None = None
    assignment_note: str | None = None


class ImportAllTextbookDraftsRequest(BaseModel):
    course_id: UUID
    teacher_id: UUID | None = None
    workflow_status: str = "draft"
    assignment_type: str = "homework"
    publish_at: str | None = None
    due_at: str | None = None


class ExamEditorChoiceRequest(BaseModel):
    label: str
    text: str


class ExamEditorQuestionRequest(BaseModel):
    id: str | None = None
    concept: str | None = None
    concept_tag: str | None = None
    prompt: str
    choices: list[ExamEditorChoiceRequest]
    answer: str | None = None
    correct_choice: str | None = None
    explanation: str | None = None
    difficulty: str = "medium"
    points: int = 10
    source_pages: list[int] = []
    evidence_excerpt: str | None = None
    source_textbook_slug: str | None = None
    source_section_title: str | None = None


class CreateExamEditorRequest(BaseModel):
    course_id: UUID
    teacher_id: UUID | None = None
    title: str
    description: str = ""
    exam_date: str | None = None
    duration_minutes: int = 30
    workflow_status: str = "draft"
    published_at: str | None = None
    assignment_type: str = "homework"
    due_at: str | None = None
    assignment_note: str | None = None
    source_name: str | None = None
    source_format: str = "manual"
    textbook_slug: str | None = None
    textbook_title: str | None = None
    section_title: str | None = None
    material_id: UUID | None = None
    learning_objective: str | None = None
    section_page_start: int | None = None
    section_page_end: int | None = None
    questions: list[ExamEditorQuestionRequest]


class UpdateExamEditorRequest(BaseModel):
    teacher_id: UUID | None = None
    title: str
    description: str = ""
    exam_date: str | None = None
    duration_minutes: int = 30
    workflow_status: str = "draft"
    published_at: str | None = None
    assignment_type: str = "homework"
    due_at: str | None = None
    assignment_note: str | None = None
    source_name: str | None = None
    source_format: str = "manual"
    textbook_slug: str | None = None
    textbook_title: str | None = None
    section_title: str | None = None
    material_id: UUID | None = None
    learning_objective: str | None = None
    section_page_start: int | None = None
    section_page_end: int | None = None
    questions: list[ExamEditorQuestionRequest]


class PatchExamEditorRequest(BaseModel):
    teacher_id: UUID | None = None
    title: str | None = None
    description: str | None = None
    exam_date: str | None = None
    duration_minutes: int | None = None
    workflow_status: str | None = None
    published_at: str | None = None
    assignment_type: str | None = None
    due_at: str | None = None
    assignment_note: str | None = None
    source_name: str | None = None
    source_format: str | None = None
    textbook_slug: str | None = None
    textbook_title: str | None = None
    section_title: str | None = None
    material_id: UUID | None = None
    learning_objective: str | None = None
    section_page_start: int | None = None
    section_page_end: int | None = None
    questions: list[ExamEditorQuestionRequest] | None = None


@router.get("/presets")
def exam_presets():
    return list_exam_presets()


@router.get("/textbook-drafts")
def textbook_drafts():
    return list_textbook_drafts()


@router.get("/textbooks/catalog")
def textbook_catalog():
    return list_textbook_catalog()


@router.post("/textbooks/catalog/sync")
def textbook_catalog_sync(req: SyncTextbookCatalogRequest):
    try:
        return sync_textbook_catalog(textbook_slug=req.textbook_slug)
    except TextbookCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/textbooks/catalog/backfill")
def textbook_catalog_backfill(req: SyncTextbookCatalogRequest):
    try:
        return backfill_exam_catalog_scope(textbook_slug=req.textbook_slug)
    except TextbookCatalogError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/textbooks/catalog/{textbook_slug}")
def textbook_catalog_detail(textbook_slug: str):
    try:
        return get_textbook_catalog_detail(textbook_slug)
    except TextbookCatalogError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/textbook-drafts/{draft_id:path}")
def textbook_draft_detail(draft_id: str):
    try:
        return get_textbook_draft_detail(draft_id)
    except TextbookDraftError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/textbook-drafts/import")
def import_textbook_draft(req: ImportTextbookDraftRequest):
    try:
        return import_textbook_draft_to_exam(
            str(req.course_id),
            req.draft_id,
            created_by=str(req.teacher_id) if req.teacher_id else None,
            workflow_status=req.workflow_status,
            assignment_type=req.assignment_type,
            publish_at=req.publish_at,
            due_at=req.due_at,
            assignment_note=req.assignment_note,
        )
    except TextbookDraftError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/textbook-drafts/import-all")
def import_all_textbook_generated(req: ImportAllTextbookDraftsRequest):
    try:
        return import_all_textbook_drafts(
            str(req.course_id),
            created_by=str(req.teacher_id) if req.teacher_id else None,
            workflow_status=req.workflow_status,
            assignment_type=req.assignment_type,
            publish_at=req.publish_at,
            due_at=req.due_at,
        )
    except TextbookDraftError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/course/{course_id}")
def course_exams(course_id: UUID):
    return list_course_exams(str(course_id))


@router.get("/course/{course_id}/schedule-status")
def course_exam_schedule_status(course_id: UUID):
    return get_course_schedule_status(str(course_id))


@router.get("/student/{student_id}/{course_id}")
def student_exams(student_id: UUID, course_id: UUID):
    return list_student_exams(str(course_id), str(student_id))


@router.get("/student/{student_id}/{course_id}/notifications")
def student_exam_notifications(student_id: UUID, course_id: UUID):
    return list_student_notifications(str(student_id), str(course_id))


@router.post("/import")
async def import_exam(
    course_id: UUID = Form(...),
    teacher_id: UUID | None = Form(None),
    content: str | None = Form(None),
    file: UploadFile | None = File(None),
):
    if not content and not file:
        raise HTTPException(status_code=400, detail="시험지 내용 또는 파일이 필요합니다.")

    source_name = file.filename if file and file.filename else "pasted_exam.md"
    raw_text = content
    if file:
        payload = await file.read()
        try:
            raw_text = payload.decode("utf-8")
        except UnicodeDecodeError as error:
            raise HTTPException(status_code=400, detail="시험지 파일은 UTF-8 텍스트여야 합니다.") from error

    try:
        return create_exam_from_text(
            str(course_id),
            raw_text or "",
            created_by=str(teacher_id) if teacher_id else None,
            source_name=source_name,
            source_format="markdown_upload",
        )
    except ExamImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/editor")
def create_exam_from_editor(req: CreateExamEditorRequest):
    payload = req.model_dump(mode="json")
    course_id = str(req.course_id)
    teacher_id = payload.pop("teacher_id", None)
    payload.pop("course_id", None)

    try:
        return create_exam_from_editor_payload(
            course_id,
            payload,
            created_by=str(teacher_id) if teacher_id else None,
        )
    except ExamImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/{exam_id}/editor")
def update_exam_from_editor(exam_id: UUID, req: UpdateExamEditorRequest):
    payload = req.model_dump(mode="json")
    teacher_id = payload.pop("teacher_id", None)

    try:
        return update_exam_from_editor_payload(
            str(exam_id),
            payload,
            updated_by=str(teacher_id) if teacher_id else None,
        )
    except ExamImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.patch("/{exam_id}/editor")
def patch_exam_from_editor(exam_id: UUID, req: PatchExamEditorRequest):
    payload = req.model_dump(mode="json", exclude_none=True)
    teacher_id = payload.pop("teacher_id", None)

    try:
        return update_exam_from_editor_payload(
            str(exam_id),
            payload,
            updated_by=str(teacher_id) if teacher_id else None,
            partial=True,
        )
    except ExamImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/course/{course_id}/presets/import")
def import_course_presets(course_id: UUID, req: ImportPresetRequest):
    try:
        return import_exam_presets(
            str(course_id),
            req.preset_ids,
            created_by=str(req.teacher_id) if req.teacher_id else None,
        )
    except ExamImportError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/{exam_id}")
def exam_detail(
    exam_id: str,
    student_id: str | None = None,
    attempt_id: str | None = None,
    teacher_view: bool = False,
):
    result = get_exam_detail(exam_id, student_id=student_id, attempt_id=attempt_id, teacher_view=teacher_view)
    if not result:
        raise HTTPException(status_code=404, detail="시험을 찾지 못했거나 접근 권한이 없습니다.")
    return result


@router.get("/{exam_id}/progress")
def exam_progress(exam_id: str):
    result = get_exam_progress(exam_id)
    if not result:
        raise HTTPException(status_code=404, detail="시험 진행 현황을 찾지 못했습니다.")
    return result


@router.post("/{exam_id}/publish")
def publish_course_exam(exam_id: str, req: PublishExamRequest):
    result = publish_exam(
        exam_id,
        publish_at=req.publish_at,
        due_at=req.due_at,
        assignment_type=req.assignment_type,
        assignment_note=req.assignment_note,
    )
    if not result:
        raise HTTPException(status_code=404, detail="배포할 시험을 찾지 못했습니다.")
    return result


@router.post("/{exam_id}/submit")
def submit_exam(exam_id: str, req: SubmitExamRequest):
    result = submit_exam_attempt(
        exam_id,
        student_id=str(req.student_id),
        answers=req.answers,
        duration_minutes=req.duration_minutes,
    )
    if not result:
        raise HTTPException(status_code=404, detail="응시할 수 있는 시험을 찾지 못했습니다.")
    return result


@router.post("/answers/{answer_id}/review")
def review_answer(answer_id: str, req: ReviewExamAnswerRequest):
    result = review_exam_answer(
        answer_id,
        student_id=str(req.student_id),
        corrected_choice=req.corrected_choice,
    )
    if not result:
        raise HTTPException(status_code=404, detail="오답 복기 대상을 찾지 못했습니다.")
    return result


@router.get("/textbooks/{textbook_slug}/pages/{page_number}")
def textbook_page_asset(textbook_slug: str, page_number: int):
    try:
        page_path = get_textbook_page_path(textbook_slug, page_number)
    except TextbookDraftError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(page_path)


@router.get("/textbooks/{textbook_slug}/pdf")
def textbook_pdf_asset(textbook_slug: str):
    try:
        pdf_path = get_textbook_pdf_path(textbook_slug)
    except TextbookDraftError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return FileResponse(pdf_path, media_type="application/pdf", filename=pdf_path.name)
