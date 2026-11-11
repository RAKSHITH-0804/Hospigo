export type HealthResponse = {
  status: 'ok';
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function apiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (typeof base !== 'string' || base.trim() === '') {
    throw new ApiError('NEXT_PUBLIC_API_URL is not set', 0);
  }
  return base.trim().replace(/\/$/, '');
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = `${apiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new ApiError('The request could not be completed', 0);
  }
  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}
