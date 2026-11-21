import { parseSections, REPORT_SECTIONS, REPORT_SECTIONS_PATTERN } from './report-sections';

describe('parseSections', () => {
  it('means every section when nothing is asked for', () => {
    expect(parseSections(undefined)).toEqual([...REPORT_SECTIONS]);
    expect(parseSections('')).toEqual([...REPORT_SECTIONS]);
  });

  it('keeps only what was asked for, once, in the report order', () => {
    expect(parseSections('TEST,MODE')).toEqual(['MODE', 'TEST']);
    expect(parseSections('DOCTOR,DOCTOR,BRANCH')).toEqual(['DOCTOR', 'BRANCH']);
  });
});

describe('REPORT_SECTIONS_PATTERN', () => {
  it('accepts known names separated by single commas and nothing else', () => {
    for (const ok of ['MODE', 'MODE,DOCTOR', 'DEPARTMENT,TEST,BRANCH']) {
      expect({ ok, matches: REPORT_SECTIONS_PATTERN.test(ok) }).toEqual({ ok, matches: true });
    }
    for (const bad of [
      '',
      'mode',
      'MODE,',
      ',MODE',
      'MODE,,DOCTOR',
      'MODE;DOCTOR',
      'EVIL',
      'MODE DOCTOR',
    ]) {
      expect({ bad, matches: REPORT_SECTIONS_PATTERN.test(bad) }).toEqual({ bad, matches: false });
    }
  });
});
