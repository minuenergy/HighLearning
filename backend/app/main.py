from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analytics, chat, exams, materials, workspace

app = FastAPI(title="SocraTeach API")

import os as _os

_EXTRA_ORIGIN = _os.getenv("ALLOWED_ORIGIN", "")  # 커스텀 도메인 추가용

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        *([_EXTRA_ORIGIN] if _EXTRA_ORIGIN else []),
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # *.vercel.app 전체 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["x-conversation-id"],
)

app.include_router(materials.router, prefix="/api/materials", tags=["materials"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(exams.router, prefix="/api/exams", tags=["exams"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])


@app.get("/health")
def health():
    return {"status": "ok"}
