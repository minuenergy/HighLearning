import os
import tempfile

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.config import settings
from app.services.material_generation_service import MaterialGenerationError, auto_generate_material_draft_exams
from app.services.materials_service import (
    create_material_record,
    delete_material,
    get_material_detail,
    get_material_page_text,
    list_course_materials,
    process_material_upload,
    render_material_page_image,
)

router = APIRouter()


class GenerateMaterialDraftsRequest(BaseModel):
    teacher_id: str | None = None
    max_sections: int = 3
    questions_per_section: int = 10


@router.post("/upload")
async def upload_material(
    background_tasks: BackgroundTasks,
    course_id: str = Form(...),
    file: UploadFile = File(...),
    parser_mode: str | None = Form(None),
):
    file_name = file.filename or "uploaded_material"
    if not file_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="교재 업로드는 PDF 파일만 지원합니다.")

    material = create_material_record(course_id, file.filename or "uploaded_material")
    temp_path: str | None = None

    try:
        suffix = os.path.splitext(file_name)[1]
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
            temp_path = handle.name
            while True:
                chunk = await file.read(settings.material_upload_spool_chunk_size)
                if not chunk:
                    break
                handle.write(chunk)

        await file.close()
        background_tasks.add_task(
            process_material_upload,
            material_id=material["id"],
            course_id=course_id,
            file_name=file_name,
            source_path=temp_path,
            cleanup_source=True,
            parser_mode=parser_mode,
        )
        return {
            "queued": True,
            "material": material,
        }
    except Exception as error:
        if temp_path:
            try:
                os.unlink(temp_path)
            except FileNotFoundError:
                pass
        raise HTTPException(status_code=500, detail=str(error)) from error


@router.get("/course/{course_id}")
def list_materials(course_id: str):
    return list_course_materials(course_id)


@router.get("/{material_id}")
def material_detail(material_id: str):
    result = get_material_detail(material_id)
    if not result:
        raise HTTPException(status_code=404, detail="자료를 찾지 못했습니다.")
    return result


@router.get("/{material_id}/pages/{page_number}/image")
def material_page_image(material_id: str, page_number: int):
    image_bytes = render_material_page_image(material_id, page_number)
    if not image_bytes:
        raise HTTPException(status_code=404, detail="페이지 이미지를 찾지 못했습니다.")
    return Response(content=image_bytes, media_type="image/png")


@router.get("/{material_id}/pages/{page_number}")
def material_page_text(material_id: str, page_number: int):
    result = get_material_page_text(material_id, page_number)
    if not result:
        raise HTTPException(status_code=404, detail="페이지를 찾지 못했습니다.")
    return result


@router.delete("/{material_id}")
def delete_material_endpoint(material_id: str):
    result = get_material_detail(material_id)
    if not result:
        raise HTTPException(status_code=404, detail="자료를 찾지 못했습니다.")
    delete_material(material_id)
    return {"deleted": True}


@router.post("/{material_id}/generate-drafts")
def generate_material_drafts(material_id: str, req: GenerateMaterialDraftsRequest):
    try:
        return auto_generate_material_draft_exams(
            material_id,
            teacher_id=req.teacher_id,
            max_sections=req.max_sections,
            questions_per_section=req.questions_per_section,
        )
    except MaterialGenerationError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
