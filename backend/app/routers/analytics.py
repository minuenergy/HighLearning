from fastapi import APIRouter
from pydantic import BaseModel
from app.services.analytics_service import (
    log_stuck_event,
    log_resolved_event,
    get_class_concept_stats,
    get_student_concept_stats,
    get_class_dashboard_overview,
    get_teacher_dashboard_briefing,
    get_student_learning_overview,
)

router = APIRouter()


class EventRequest(BaseModel):
    student_id: str
    course_id: str
    concept: str


@router.post("/stuck")
def record_stuck(req: EventRequest):
    log_stuck_event(req.student_id, req.course_id, req.concept)
    return {"recorded": True}


@router.post("/resolved")
def record_resolved(req: EventRequest):
    log_resolved_event(req.student_id, req.course_id, req.concept)
    return {"recorded": True}


@router.get("/class/{course_id}")
def class_stats(course_id: str):
    return get_class_concept_stats(course_id)


@router.get("/class/{course_id}/overview")
def class_overview(course_id: str):
    return get_class_dashboard_overview(course_id)


@router.get("/teacher/{teacher_id}/overview")
def teacher_overview(teacher_id: str):
    return get_teacher_dashboard_briefing(teacher_id)


@router.get("/student/{student_id}/{course_id}")
def student_stats(student_id: str, course_id: str):
    return get_student_concept_stats(student_id, course_id)


@router.get("/student/{student_id}/{course_id}/overview")
def student_overview(student_id: str, course_id: str):
    return get_student_learning_overview(student_id, course_id)
