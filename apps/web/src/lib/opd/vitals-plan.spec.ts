import { isCorrection, parseVitalsValue, planVitals } from './vitals-plan';
import { POSTURE, PULSE, makeReading } from './clinical-test-fixtures';

describe('parseVitalsValue', () => {
  it('accepts numbers with at most two decimals and refuses everything else', () => {
    expect(parseVitalsValue(PULSE, '72')).toBe(72);
    expect(parseVitalsValue(PULSE, ' 98.6 ')).toBe(98.6);
    expect(parseVitalsValue(PULSE, '0')).toBe(0);
    for (const bad of ['', 'abc', '-5', '72.123', '1e3', '72,5', '123456789']) {
      expect(parseVitalsValue(PULSE, bad)).toBeNull();
    }
  });

  it('accepts text of 1 to 200 characters', () => {
    expect(parseVitalsValue(POSTURE, '  sitting ')).toBe('sitting');
    expect(parseVitalsValue(POSTURE, '   ')).toBeNull();
    expect(parseVitalsValue(POSTURE, 'x'.repeat(200))).toBe('x'.repeat(200));
    expect(parseVitalsValue(POSTURE, 'x'.repeat(201))).toBeNull();
  });
});

describe('planVitals', () => {
  const fields = [PULSE, POSTURE];

  it('skips blank boxes and sends a first reading without a reason', () => {
    const plan = planVitals(
      fields,
      { pulse: { value: '72', reason: '' }, posture: { value: ' ', reason: '' } },
      [],
    );
    expect(plan).toEqual({
      readings: [{ fieldCode: 'pulse', value: 72 }],
      problems: {},
      ok: true,
    });
  });

  it('skips a value equal to the current reading (nothing to change)', () => {
    const plan = planVitals(fields, { pulse: { value: '72.00', reason: '' } }, [makeReading()]);
    expect(plan).toEqual({ readings: [], problems: {}, ok: false });
  });

  it('a different value for an existing reading needs a reason and sends it trimmed', () => {
    const without = planVitals(fields, { pulse: { value: '80', reason: '  ' } }, [makeReading()]);
    expect(without.problems).toEqual({ pulse: 'REASON' });
    expect(without.readings).toEqual([]);
    expect(without.ok).toBe(false);
    const withReason = planVitals(fields, { pulse: { value: '80', reason: ' wrong finger ' } }, [
      makeReading(),
    ]);
    expect(withReason.readings).toEqual([
      { fieldCode: 'pulse', value: 80, correctionReason: 'wrong finger' },
    ]);
    expect(withReason.ok).toBe(true);
  });

  it('sends nothing while any typed value is invalid, even if another one is fine', () => {
    const plan = planVitals(
      fields,
      { pulse: { value: 'abc', reason: '' }, posture: { value: 'sitting', reason: '' } },
      [],
    );
    expect(plan.problems).toEqual({ pulse: 'INVALID' });
    expect(plan.readings).toEqual([]);
    expect(plan.ok).toBe(false);
  });

  it('corrects a text reading too', () => {
    const current = [
      makeReading({
        code: 'posture',
        name: 'Posture',
        unit: '-',
        valueKind: 'TEXT',
        value: 'sitting',
      }),
    ];
    const plan = planVitals(
      fields,
      { posture: { value: 'lying', reason: 'patient moved' } },
      current,
    );
    expect(plan.readings).toEqual([
      { fieldCode: 'posture', value: 'lying', correctionReason: 'patient moved' },
    ]);
  });
});

describe('isCorrection', () => {
  it('is true only for a valid value that differs from an existing reading', () => {
    expect(isCorrection(PULSE, '80', makeReading())).toBe(true);
    expect(isCorrection(PULSE, '72', makeReading())).toBe(false);
    expect(isCorrection(PULSE, 'abc', makeReading())).toBe(false);
    expect(isCorrection(PULSE, '80', undefined)).toBe(false);
  });
});
