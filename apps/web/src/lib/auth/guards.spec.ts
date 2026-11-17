/**
 * @jest-environment node
 */

const redirectMock = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

jest.mock('./session', () => ({
  getSession: jest.fn(),
  currentPathname: jest.fn(async () => '/admin/staff'),
  homeForKind: (kind: 'HQ' | 'HOSPITAL') => (kind === 'HQ' ? '/admin' : '/app'),
}));

jest.mock('./patient-session', () => ({
  getPatientSession: jest.fn(),
  currentPatientPathname: jest.fn(async () => '/patient'),
}));

import { getPatientSession, currentPatientPathname } from './patient-session';
import { getSession, currentPathname } from './session';
import { redirectToRefresh, requireKind, requirePatient, requirePermission } from './guards';

describe('requireKind guards', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    (getSession as jest.Mock).mockReset();
    (currentPathname as jest.Mock).mockResolvedValue('/admin/staff');
  });

  it('wrong kind redirects to login (never to refresh)', async () => {
    (getSession as jest.Mock).mockResolvedValue({
      id: '1',
      displayName: 'H',
      email: 'h@example.test',
      kind: 'HOSPITAL',
      hospitalName: 'X',
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: [],
      mustChangePassword: false,
      permissions: [],
      branches: [],
      enabledModules: [],
    });
    await expect(requireKind('HQ')).rejects.toThrow('REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    expect(redirectMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/auth/refresh'));
  });

  it('no access cookie redirects to refresh with the right next', async () => {
    (getSession as jest.Mock).mockResolvedValue(null);
    (currentPathname as jest.Mock).mockResolvedValue('/app/opd');
    await expect(requireKind('HOSPITAL')).rejects.toThrow(
      'REDIRECT:/api/auth/refresh?next=%2Fapp%2Fopd',
    );
    // Relative next/navigation path — browser keeps the APP_URL host (no localhost flip).
    const refreshTarget = String(redirectMock.mock.calls[0]?.[0] ?? '');
    expect(refreshTarget).toMatch(/^\/api\/auth\/refresh\?/);
    expect(refreshTarget).not.toMatch(/^https?:\/\//);
  });

  it('login redirects stay relative (same host as the browser)', async () => {
    (getSession as jest.Mock).mockResolvedValue({
      id: '1',
      displayName: 'H',
      email: 'h@example.test',
      kind: 'HOSPITAL',
      hospitalName: 'X',
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: [],
      mustChangePassword: false,
      permissions: [],
      branches: [],
      enabledModules: [],
    });
    await expect(requireKind('HQ')).rejects.toThrow('REDIRECT:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
    const loginTarget = String(redirectMock.mock.calls[0]?.[0] ?? '');
    expect(loginTarget).not.toMatch(/^https?:\/\//);
  });

  it('invalid access session (getSession null) still redirects to refresh not login', async () => {
    (getSession as jest.Mock).mockResolvedValue(null);
    (currentPathname as jest.Mock).mockResolvedValue('/admin');
    await expect(requireKind('HQ')).rejects.toThrow('REDIRECT:/api/auth/refresh?next=%2Fadmin');
  });

  it('patient-only cookie session does not satisfy requireKind (getSession stays null)', async () => {
    (getSession as jest.Mock).mockResolvedValue(null);
    (currentPathname as jest.Mock).mockResolvedValue('/app');
    await expect(requireKind('HOSPITAL')).rejects.toThrow('REDIRECT:/api/auth/refresh?next=%2Fapp');
  });
});

describe('requirePatient guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    (getPatientSession as jest.Mock).mockReset();
    (currentPatientPathname as jest.Mock).mockResolvedValue('/patient');
  });

  it('redirects to patient refresh when there is no patient session', async () => {
    (getPatientSession as jest.Mock).mockResolvedValue(null);
    (currentPatientPathname as jest.Mock).mockResolvedValue('/patient');
    await expect(requirePatient()).rejects.toThrow(
      'REDIRECT:/api/patient-auth/refresh?next=%2Fpatient',
    );
  });

  it('returns patient session when present', async () => {
    const session = {
      id: 'p1',
      phone: '+91XXXXXX3210',
      createdAt: '2026-01-01T00:00:00.000Z',
      linkedProfiles: [],
    };
    (getPatientSession as jest.Mock).mockResolvedValue(session);
    await expect(requirePatient()).resolves.toEqual(session);
  });

  it('staff/HQ session does not satisfy requirePatient (getPatientSession independent)', async () => {
    (getPatientSession as jest.Mock).mockResolvedValue(null);
    await expect(requirePatient()).rejects.toThrow(/\/api\/patient-auth\/refresh/);
  });
});

describe('requirePermission guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    (getSession as jest.Mock).mockReset();
    (currentPathname as jest.Mock).mockResolvedValue('/app/patients');
  });

  it('no session redirects to refresh', async () => {
    (getSession as jest.Mock).mockResolvedValue(null);
    await expect(requirePermission('patients.registry.read')).rejects.toThrow(
      'REDIRECT:/api/auth/refresh?next=%2Fapp%2Fpatients',
    );
  });

  it('wrong kind redirects to login', async () => {
    (getSession as jest.Mock).mockResolvedValue({
      id: '1',
      displayName: 'HQ',
      email: 'hq@example.test',
      kind: 'HQ',
      hospitalName: null,
      activeBranchId: null,
      activeBranchName: null,
      roleCodes: [],
      mustChangePassword: false,
      permissions: [],
      branches: [],
      enabledModules: [],
    });
    await expect(requirePermission('patients.registry.read')).rejects.toThrow('REDIRECT:/login');
  });

  it('missing permission redirects home with notice', async () => {
    (getSession as jest.Mock).mockResolvedValue({
      id: '1',
      displayName: 'H',
      email: 'h@example.test',
      kind: 'HOSPITAL',
      hospitalName: 'X',
      activeBranchId: 'b1',
      activeBranchName: 'Main',
      roleCodes: [],
      mustChangePassword: false,
      permissions: ['opd.masters.read'],
      branches: [],
      enabledModules: [],
    });
    await expect(requirePermission('patients.registry.read')).rejects.toThrow(
      'REDIRECT:/app?notice=no-permission',
    );
  });

  it('present permission returns the session', async () => {
    const session = {
      id: '1',
      displayName: 'H',
      email: 'h@example.test',
      kind: 'HOSPITAL' as const,
      hospitalName: 'X',
      activeBranchId: 'b1',
      activeBranchName: 'Main',
      roleCodes: ['RECEPTIONIST'],
      mustChangePassword: false,
      permissions: ['patients.registry.read'],
      branches: [],
      enabledModules: [],
    };
    (getSession as jest.Mock).mockResolvedValue(session);
    await expect(requirePermission('patients.registry.read')).resolves.toEqual(session);
  });
});

describe('redirectToRefresh target', () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it('keeps a normal same-origin path in next', async () => {
    (currentPathname as jest.Mock).mockResolvedValue('/app/patients/p1');
    await expect(redirectToRefresh()).rejects.toThrow(
      `REDIRECT:/api/auth/refresh?next=${encodeURIComponent('/app/patients/p1')}`,
    );
  });

  const backslash = String.fromCharCode(92);
  it.each([
    '//evil.example/x',
    'https://evil.example',
    `/${backslash}evil.example`,
    'javascript:alert(1)',
  ])('never lets %s become an external target (falls back to the staff home)', async (pathname) => {
    (currentPathname as jest.Mock).mockResolvedValue(pathname);
    await expect(redirectToRefresh()).rejects.toThrow(
      `REDIRECT:/api/auth/refresh?next=${encodeURIComponent('/app')}`,
    );
    expect(String(redirectMock.mock.calls[0]?.[0])).toMatch(/^\/api\/auth\/refresh\?next=/);
  });
});
