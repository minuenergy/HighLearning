from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_thinking_budget: int = 0
    openrouter_api_key: str = ""
    openrouter_model: str = "qwen/qwen3.6-plus-preview:free"
    ai_provider: str = "gemini"  # "gemini" | "openrouter"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    document_parser: str = "auto"
    document_parser_native_min_chars: int = 120
    document_parser_ocr_batch_size: int = 6
    paddleocr_lang: str = "korean"
    paddleocr_device: str = "cpu"
    paddleocr_use_doc_orientation_classify: bool = False
    paddleocr_use_doc_unwarping: bool = False
    paddleocr_use_textline_orientation: bool = False
    vision_ocr_languages: str = "ko-KR,en-US"
    vision_ocr_fast: bool = False
    vision_ocr_pdf_dpi: int = 120
    material_upload_spool_chunk_size: int = 1048576
    material_pages_insert_batch_size: int = 200
    material_storage_root: str = "data/materials"
    material_page_image_dpi: int = 150
    rag_add_batch_size: int = 128

    class Config:
        env_file = ".env"


settings = Settings()
