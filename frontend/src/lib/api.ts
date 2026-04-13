export function getApiUrl(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

export function getDirectApiUrl(path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${baseUrl}${normalizedPath}`
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(getApiUrl(path), {
      cache: 'no-store',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : '백엔드에 연결하지 못했습니다.'
    throw new Error(`API 요청에 실패했습니다. 서버 연결을 확인해주세요. ${message}`)
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.detail ?? `Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}
