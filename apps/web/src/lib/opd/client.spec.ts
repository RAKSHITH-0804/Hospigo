import { staffCopy } from '@/config/staff-copy';
import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import {
  OPD_DOCTORS_API,
  OPD_PREVIEW_API,
  OPD_VISITS_API,
  createVisit,
  loadVisit,
  loadDoctors,
  newIdempotencyKey,
  newVisitPath,
  opdErrorMessageFor,
  previewVisit,
  visitReceiptPath,
} from './client';

const fetchMock = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe('OPD client helpers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    clearClientRefreshLatchForTests();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('builds the screen paths (ids are encoded)', () => {
    expect(newVisitPath('p 1')).toBe('/app/patients/p%201/visits/new');
    expect(visitReceiptPath('v/1')).toBe('/app/opd/visits/v%2F1/receipt');
  });

  describe('opdErrorMessageFor', () => {
    it.each(Object.entries(staffCopy.opd.errors))('%s has its own wording', (code, message) => {
      expect(opdErrorMessageFor(code)).toBe(message);
    });

    it('falls back to the common wording for everything else', () => {
      expect(opdErrorMessageFor('FORBIDDEN')).toBe(staffCopy.errors.forbidden);
      expect(opdErrorMessageFor('SESSION_EXPIRED')).toBe(staffCopy.errors.sessionExpired);
      expect(opdErrorMessageFor('BRANCH_CHANGED')).toBe(staffCopy.errors.branchChanged);
      expect(opdErrorMessageFor('UNAVAILABLE')).toBe(staffCopy.errors.unreachable);
      expect(opdErrorMessageFor('SOMETHING_NEW')).toBe(staffCopy.errors.tryAgain);
    });
  });

  describe('newIdempotencyKey', () => {
    const apiPattern = /^[A-Za-z0-9._:-]{8,64}$/;

    it('is unique and fits the API key rules', () => {
      const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()));
      expect(keys.size).toBe(200);
      for (const key of keys) {
        expect(key).toMatch(apiPattern);
      }
    });

    it('still works without crypto.randomUUID (old browsers)', () => {
      const original = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      try {
        const a = newIdempotencyKey();
        const b = newIdempotencyKey();
        expect(a).toMatch(apiPattern);
        expect(a).not.toBe(b);
      } finally {
        Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
      }
    });
  });

  describe('calls', () => {
    it('loadDoctors is a GET on the doctors route', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ items: [] }));
      const result = await loadDoctors();
      expect(result).toEqual({ ok: true, data: { items: [] } });
      expect(String(fetchMock.mock.calls[0]![0])).toBe(OPD_DOCTORS_API);
      expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('GET');
    });

    it('previewVisit and createVisit POST JSON with the branch guard header and nothing else secret', async () => {
      setClientActiveBranch('branch-7');
      fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
      await previewVisit({ patientId: 'p1', doctorProfileId: 'd1', visitType: 'NEW' });
      await createVisit({
        patientId: 'p1',
        doctorProfileId: 'd1',
        visitType: 'FOLLOW_UP',
        idempotencyKey: 'KEY-12345678',
        expectedTotalPaise: 0,
      });
      const [previewCall, createCall] = fetchMock.mock.calls;
      expect(String(previewCall![0])).toBe(OPD_PREVIEW_API);
      expect(String(createCall![0])).toBe(OPD_VISITS_API);
      for (const call of [previewCall!, createCall!]) {
        const init = call[1] as RequestInit;
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('include');
        expect(init.headers).toMatchObject({ 'x-hospigo-branch': 'branch-7' });
      }
      // A zero total is sent as 0 (not dropped), so the server can compare it.
      expect(JSON.parse(String((createCall![1] as RequestInit).body))).toEqual({
        patientId: 'p1',
        doctorProfileId: 'd1',
        visitType: 'FOLLOW_UP',
        idempotencyKey: 'KEY-12345678',
        expectedTotalPaise: 0,
      });
    });

    it('loadVisit GETs one visit by id', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 'v1' }));
      await loadVisit('v/1');
      expect(String(fetchMock.mock.calls[0]![0])).toBe(`${OPD_VISITS_API}/v%2F1`);
      expect((fetchMock.mock.calls[0]![1] as RequestInit).method ?? 'GET').toBe('GET');
    });

    it('carries the facts a screen needs to explain a refusal', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ code: 'PRICE_CHANGED', totalPaise: 25_000, reason: 'SWITCH_OFF' }, 409),
      );
      const result = await createVisit({
        patientId: 'p1',
        doctorProfileId: 'd1',
        visitType: 'NEW',
        idempotencyKey: 'KEY-12345678',
        expectedTotalPaise: 20_000,
      });
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'PRICE_CHANGED',
        totalPaise: 25_000,
        reason: 'SWITCH_OFF',
      });
    });
  });
});
