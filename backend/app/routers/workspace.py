from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.tutor_transcript_service import (
    delete_tutor_conversation,
    get_tutor_conversation_thread,
    list_tutor_conversations,
)
from app.services.verification_service import (
    finalize_student_signup,
    finalize_teacher_signup,
    issue_teacher_invite_code,
    issue_student_invite_code,
    list_invite_codes,
    list_teacher_verification_requests,
    update_teacher_verification_request,
    validate_student_signup,
    validate_teacher_signup,
)
from app.services.workspace_service import (
    get_profile_bundle,
    get_student_performance_overview,
    get_teacher_student_detail,
    get_teacher_students_overview,
    get_teacher_subject_briefing,
    get_teacher_subject_overview,
    save_teacher_note,
    update_profile_bundle,
)

router = APIRouter()


class UpdateProfileRequest(BaseModel):
    full_name: str | None = None
    phone_number: str | None = None
    school_name: str | None = None
    school_email: str | None = None
    verification_status: str | None = None
    verification_method: str | None = None
    subject_names: list[str] | None = None
    grade_levels: list[str] | None = None
    class_labels: list[str] | None = None
    student_number: str | None = None
    school_class_id: str | None = None
    class_label: str | None = None


class SaveTeacherNoteRequest(BaseModel):
    note: str
    school_class_id: str | None = None
    course_id: str | None = None


class ValidateTeacherSignupRequest(BaseModel):
    email: str
    school_email: str | None = None
    verification_method: str
    invite_code: str | None = None


class FinalizeTeacherSignupRequest(BaseModel):
    user_id: str
    email: str
    full_name: str
    phone_number: str | None = None
    school_name: str | None = None
    school_email: str | None = None
    verification_method: str
    invite_code: str | None = None
    subject_names: list[str] | None = None
    grade_levels: list[str] | None = None
    class_labels: list[str] | None = None


class ValidateStudentSignupRequest(BaseModel):
    invite_code: str
    student_number: str


class FinalizeStudentSignupRequest(BaseModel):
    user_id: str
    email: str
    full_name: str
    phone_number: str | None = None
    student_number: str
    invite_code: str


class CreateInviteCodeRequest(BaseModel):
    role: str = "student"
    label: str
    course_id: str | None = None
    school_class_id: str | None = None
    subject_names: list[str] | None = None
    max_uses: int = 30
    expires_days: int = 30


class UpdateTeacherVerificationRequest(BaseModel):
    verification_status: str
    verification_note: str | None = None


@router.get("/profile/{user_id}")
def workspace_profile(user_id: str):
    result = get_profile_bundle(user_id)
    if not result:
        raise HTTPException(status_code=404, detail="프로필을 찾지 못했습니다.")
    return result


@router.put("/profile/{user_id}")
def update_workspace_profile(user_id: str, req: UpdateProfileRequest):
    try:
        payload = req.model_dump(exclude_none=True)
        result = update_profile_bundle(user_id, payload)
        if not result:
            raise HTTPException(status_code=404, detail="프로필을 찾지 못했습니다.")
        return result
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/auth/teacher/validate")
def auth_validate_teacher(req: ValidateTeacherSignupRequest):
    try:
        return validate_teacher_signup(
            email=req.email,
            school_email=req.school_email,
            verification_method=req.verification_method,
            invite_code=req.invite_code,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/auth/teacher/finalize")
def auth_finalize_teacher(req: FinalizeTeacherSignupRequest):
    try:
        return finalize_teacher_signup(
            user_id=req.user_id,
            email=req.email,
            full_name=req.full_name,
            phone_number=req.phone_number,
            school_name=req.school_name,
            school_email=req.school_email,
            verification_method=req.verification_method,
            invite_code=req.invite_code,
            subject_names=req.subject_names,
            grade_levels=req.grade_levels,
            class_labels=req.class_labels,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/auth/student/validate")
def auth_validate_student(req: ValidateStudentSignupRequest):
    try:
        return validate_student_signup(
            invite_code=req.invite_code,
            student_number=req.student_number,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/auth/student/finalize")
def auth_finalize_student(req: FinalizeStudentSignupRequest):
    try:
        return finalize_student_signup(
            user_id=req.user_id,
            email=req.email,
            full_name=req.full_name,
            phone_number=req.phone_number,
            student_number=req.student_number,
            invite_code=req.invite_code,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/teacher/{teacher_id}/students")
def teacher_students(teacher_id: str):
    return get_teacher_students_overview(teacher_id)


@router.get("/teacher/{teacher_id}/students/{student_id}")
def teacher_student_detail(teacher_id: str, student_id: str, group_id: str | None = Query(None)):
    result = get_teacher_student_detail(teacher_id, student_id, group_id=group_id)
    if not result:
        raise HTTPException(status_code=404, detail="학생 상세 정보를 찾지 못했습니다.")
    return result


@router.put("/teacher/{teacher_id}/students/{student_id}/note")
def teacher_student_note(teacher_id: str, student_id: str, req: SaveTeacherNoteRequest):
    return save_teacher_note(
        teacher_id,
        student_id,
        req.note,
        school_class_id=req.school_class_id,
        course_id=req.course_id,
    )


@router.get("/teacher/{teacher_id}/subjects")
def teacher_subjects(teacher_id: str):
    return get_teacher_subject_overview(teacher_id)


@router.get("/teacher/{teacher_id}/subjects/{subject_name}")
def teacher_subject_briefing(teacher_id: str, subject_name: str):
    result = get_teacher_subject_briefing(teacher_id, subject_name)
    if not result:
        raise HTTPException(status_code=404, detail="과목 브리핑을 찾지 못했습니다.")
    return result


@router.get("/teacher/{teacher_id}/invite-codes")
def teacher_invite_codes(
    teacher_id: str,
    role: str | None = Query(None),
    course_id: str | None = Query(None),
    school_class_id: str | None = Query(None),
):
    return list_invite_codes(
        teacher_id,
        role=role,
        course_id=course_id,
        school_class_id=school_class_id,
    )


@router.post("/teacher/{teacher_id}/invite-codes")
def create_teacher_invite_code(teacher_id: str, req: CreateInviteCodeRequest):
    try:
        if req.role == "teacher":
            return issue_teacher_invite_code(
                teacher_id=teacher_id,
                label=req.label,
                subject_names=req.subject_names,
                max_uses=req.max_uses,
                expires_days=req.expires_days,
            )
        if req.role != "student":
            raise ValueError("지원하지 않는 초대코드 role 입니다.")
        return issue_student_invite_code(
            teacher_id=teacher_id,
            label=req.label,
            course_id=req.course_id,
            school_class_id=req.school_class_id,
            subject_names=req.subject_names,
            max_uses=req.max_uses,
            expires_days=req.expires_days,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/teacher/{teacher_id}/verification-requests")
def teacher_verification_requests(teacher_id: str, status: str | None = Query(None)):
    try:
        return list_teacher_verification_requests(teacher_id, status=status)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/teacher/{teacher_id}/verification-requests/{target_teacher_id}")
def update_teacher_verification(
    teacher_id: str,
    target_teacher_id: str,
    req: UpdateTeacherVerificationRequest,
):
    try:
        return update_teacher_verification_request(
            teacher_id=teacher_id,
            target_teacher_id=target_teacher_id,
            verification_status=req.verification_status,
            verification_note=req.verification_note,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/student/{student_id}/performance/{course_id}")
def student_performance(student_id: str, course_id: str):
    return get_student_performance_overview(student_id, course_id)


@router.get("/student/{student_id}/conversations")
def student_conversations(student_id: str, course_id: str | None = Query(None)):
    return list_tutor_conversations(student_id, course_id=course_id)


@router.get("/student/{student_id}/conversations/{conversation_id}")
def student_conversation_thread(student_id: str, conversation_id: str):
    result = get_tutor_conversation_thread(conversation_id, student_id=student_id)
    if not result:
        raise HTTPException(status_code=404, detail="대화 세션을 찾지 못했습니다.")
    return result


@router.delete("/student/{student_id}/conversations/{conversation_id}")
def remove_student_conversation(student_id: str, conversation_id: str):
    deleted = delete_tutor_conversation(conversation_id, student_id=student_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="삭제할 대화 세션을 찾지 못했습니다.")
    return {"deleted": True}
