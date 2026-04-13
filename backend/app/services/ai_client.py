"""공통 AI 클라이언트 — Gemini / OpenRouter 추상화."""
from __future__ import annotations

from app.config import settings


def _is_openrouter() -> bool:
    return settings.ai_provider == "openrouter"


def _openrouter_client():
    from openai import OpenAI
    return OpenAI(
        api_key=settings.openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
    )


def generate_text(
    prompt: str,
    *,
    max_tokens: int = 200,
    temperature: float = 0.1,
) -> str:
    """단답/요약용 텍스트 생성 (non-streaming)."""
    if _is_openrouter():
        client = _openrouter_client()
        resp = client.chat.completions.create(
            model=settings.openrouter_model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return (resp.choices[0].message.content or "").strip()
    else:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=temperature,
            ),
        )
        return (resp.text or "").strip()


def generate_json(
    prompt: str,
    *,
    temperature: float = 0.2,
) -> str:
    """JSON 응답용 텍스트 생성. 반환값은 raw string — 파싱은 호출자가 담당."""
    if _is_openrouter():
        client = _openrouter_client()
        # OpenRouter는 system 프롬프트로 JSON 강제
        resp = client.chat.completions.create(
            model=settings.openrouter_model,
            messages=[
                {"role": "system", "content": "You must respond with valid JSON only. No markdown, no explanation."},
                {"role": "user", "content": prompt},
            ],
            temperature=temperature,
        )
        return (resp.choices[0].message.content or "{}").strip()
    else:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.gemini_api_key)
        resp = client.models.generate_content(
            model=settings.gemini_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=temperature,
            ),
        )
        return (resp.text or "{}").strip()
