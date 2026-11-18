import { clearClientRefreshLatchForTests, setClientActiveBranch } from '@/lib/auth/client-session';
import {
  addAddendum,
  completeConsultation,
  consultPath,
  loadQueue,
  recordVitals,
  saveNote,
  savePrescription,
  searchMedicines,
  startConsultation,
  vitalsPath,
} from './clinical-client';

const fetchMock = jest.fn();
const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  return {
    url,
    method: init.method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    headers: init.headers as Record<string, string>,
  };
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(json({ ok: true }));
  clearClientRefreshLatchForTests();
  setClientActiveBranch('branch-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('clinical client', () => {
  it('builds screen paths with the id encoded', () => {
    expect(consultPath('a/b')).toBe('/app/opd/visits/a%2Fb/consult');
    expect(vitalsPath('a b')).toBe('/app/opd/visits/a%20b/vitals');
  });

  it('reads the queue with a plain GET', async () => {
    await loadQueue();
    expect(lastCall()).toMatchObject({ url: '/api/staff/opd/queue', method: 'GET' });
  });

  it.each([
    ['start', () => startConsultation('v/1'), 'POST', '/api/staff/opd/visits/v%2F1/start', {}],
    [
      'note',
      () => saveNote('v1', { diagnosis: 'x' }),
      'PUT',
      '/api/staff/opd/visits/v1/consultation',
      { diagnosis: 'x' },
    ],
    [
      'prescription',
      () =>
        savePrescription('v1', [{ medicineName: 'a', dose: '1', frequency: '1', duration: '1' }]),
      'PUT',
      '/api/staff/opd/visits/v1/prescription',
      { items: [{ medicineName: 'a', dose: '1', frequency: '1', duration: '1' }] },
    ],
    ['complete', () => completeConsultation('v1'), 'POST', '/api/staff/opd/visits/v1/complete', {}],
    [
      'addendum',
      () => addAddendum('v1', { text: 'a', reason: 'b' }),
      'POST',
      '/api/staff/opd/visits/v1/consultation/addenda',
      { text: 'a', reason: 'b' },
    ],
    [
      'vitals',
      () => recordVitals('v1', [{ fieldCode: 'pulse', value: 72 }]),
      'POST',
      '/api/staff/opd/visits/v1/vitals',
      { readings: [{ fieldCode: 'pulse', value: 72 }] },
    ],
  ])('%s sends the right request with the branch header', async (_n, call, method, url, body) => {
    await call();
    const sent = lastCall();
    expect(sent).toMatchObject({ url, method, body });
    expect(sent.headers['x-hospigo-branch']).toBeDefined();
  });

  it('searches medicines with an encoded text and the limit, as a GET (no branch header)', async () => {
    await searchMedicines('a&b c', 7);
    const sent = lastCall();
    expect(sent.url).toBe('/api/staff/opd/medicines?q=a%26b%20c&limit=7');
    expect(sent.method).toBe('GET');
    expect(sent.headers['x-hospigo-branch']).toBeUndefined();
  });

  it('hands back the field code and row index of a refusal', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'PRESCRIPTION_ITEM_INVALID', index: 1, fieldCode: 'pulse' }, 400),
    );
    const result = await savePrescription('v1', []);
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: 'PRESCRIPTION_ITEM_INVALID',
      index: 1,
      fieldCode: 'pulse',
    });
  });
});
