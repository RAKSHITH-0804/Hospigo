/**
 * Next.js server startup hook (runs once before handling requests).
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }
  const { assertProductionAppUrl, assertProductionApiInternalUrl } =
    await import('./config/session');
  assertProductionAppUrl();
  assertProductionApiInternalUrl();
}
