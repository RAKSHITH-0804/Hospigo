import { loadOpdWebConfig } from './opd';

describe('OPD web settings (clinical screens)', () => {
  it('has safe defaults: queue refresh every 20 s, autosave after 5 s', () => {
    const c = loadOpdWebConfig({});
    expect(c.queueRefreshSeconds).toBe(20);
    expect(c.autosaveSeconds).toBe(5);
    expect(c.previousVisitsLimit).toBe(5);
    expect(c.medicineSearchMinChars).toBe(2);
    expect(c.calendarWeekStart).toBe(1);
    expect(c.followUpQuickDays).toEqual([1, 3, 7, 14, 30]);
  });

  it('can be set from the environment', () => {
    const c = loadOpdWebConfig({
      WEB_OPD_QUEUE_REFRESH_SECONDS: '0',
      WEB_OPD_AUTOSAVE_SECONDS: '3',
      WEB_OPD_PREVIOUS_VISITS_LIMIT: '8',
      WEB_CALENDAR_WEEK_START: '0',
    });
    expect(c).toMatchObject({
      queueRefreshSeconds: 0,
      autosaveSeconds: 3,
      previousVisitsLimit: 8,
      calendarWeekStart: 0,
    });
  });

  it.each([
    ['WEB_OPD_QUEUE_REFRESH_SECONDS', '601'],
    ['WEB_OPD_QUEUE_REFRESH_SECONDS', '-1'],
    ['WEB_OPD_AUTOSAVE_SECONDS', '0'],
    ['WEB_OPD_AUTOSAVE_SECONDS', '61'],
    ['WEB_OPD_AUTOSAVE_SECONDS', 'soon'],
    ['WEB_OPD_PREVIOUS_VISITS_LIMIT', '21'],
    ['WEB_CALENDAR_WEEK_START', '7'],
  ])('refuses %s=%s', (key, value) => {
    expect(() => loadOpdWebConfig({ [key]: value })).toThrow(key);
  });
});
