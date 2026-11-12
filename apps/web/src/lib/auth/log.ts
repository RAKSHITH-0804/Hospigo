/**
 * Server-side BFF error logging. Never pass bodies, tokens, passwords, emails, or cookies.
 */
export function logBffError(info: {
  route: string;
  upstreamStatus?: number;
  error?: unknown;
  requestId?: string;
}): void {
  const errorClass =
    info.error instanceof Error
      ? info.error.constructor.name
      : info.error === undefined || info.error === null
        ? 'None'
        : typeof info.error;
  // Single line; only safe metadata.
  console.error(
    `[bff] route=${info.route} upstreamStatus=${info.upstreamStatus ?? 'none'} errorClass=${errorClass} requestId=${info.requestId ?? 'none'}`,
  );
}

export function requestIdFrom(request: Request): string | undefined {
  const id = request.headers.get('x-request-id')?.trim();
  return id || undefined;
}
