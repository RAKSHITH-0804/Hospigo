import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import {
  currentPatientPathname,
  getPatientSession,
  type PatientSessionResult,
} from './patient-session';
import { sanitizeNextPath } from './http';
import { currentPathname, getSession, homeForKind, type SessionResult } from './session';
import type { AuthKind } from './types';

/**
 * Layout guard: requires a session of the expected kind.
 *
 * Refresh cookie path is `/api/auth`, so the browser does NOT send it on
 * `/admin` or `/app` navigations. When there is no valid access session we
 * ALWAYS redirect to `/api/auth/refresh?next=…` — the handler can see the
 * refresh cookie and sends the user to `/login` if it is missing or invalid.
 *
 * Loop prevention: wrong kind → `/login` (never refresh); `/login` never
 * redirects to refresh; refresh handler only redirects to `next` after success.
 *
 * Staff/HQ cookies are separate from patient cookies — a patient session never
 * satisfies this guard (getSession only reads staff access cookie names).
 */
export async function redirectToRefresh(): Promise<never> {
  const path = await currentPathname();
  // The pathname comes from middleware (never from the client), and the refresh
  // route sanitizes `next` again. This check keeps the target a same-origin path.
  const safe = sanitizeNextPath(encodeURIComponent(path), homeForKind('HOSPITAL'));
  redirect(`/api/auth/refresh?next=${encodeURIComponent(safe)}`);
}

export async function requireKind(kind: AuthKind): Promise<SessionResult> {
  const session = await getSession();
  if (session) {
    if (session.kind !== kind) {
      redirect(sessionConfig.loginPath);
    }
    if (session.mustChangePassword) {
      redirect(sessionConfig.changePasswordPath);
    }
    return session;
  }

  return redirectToRefresh();
}

/**
 * Hospital page guard: requireKind('HOSPITAL') then an active-branch permission code.
 * Missing permission → staff home with notice=no-permission.
 */
export async function requirePermission(code: string): Promise<SessionResult> {
  const session = await requireKind('HOSPITAL');
  if (!session.permissions?.includes(code)) {
    redirect(`${sessionConfig.homeHospital}?notice=no-permission`);
  }
  return session;
}

/**
 * Patient home guard. Uses patient cookies only — staff/HQ sessions never satisfy it.
 * Missing access → `/api/patient-auth/refresh?next=…` (patient refresh path).
 */
export async function requirePatient(): Promise<PatientSessionResult> {
  const session = await getPatientSession();
  if (session) {
    return session;
  }
  const path = await currentPatientPathname();
  const next = encodeURIComponent(path);
  redirect(`/api/patient-auth/refresh?next=${next}`);
}
