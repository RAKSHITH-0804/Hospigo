import {
  buildListQMatchPlan,
  countDigits,
  escapeLikePattern,
  extractQPhoneDigits,
} from './patients-list-q';

describe('patients-list-q helpers', () => {
  it('escapes LIKE wildcards and backslashes', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('extracts phone digits with optional +91 only when q starts with +', () => {
    expect(extractQPhoneDigits('+91 700 00')).toBe('70000');
    expect(extractQPhoneDigits('700-00')).toBe('70000');
    expect(extractQPhoneDigits('9170000')).toBe('9170000');
    expect(countDigits('+91 700')).toBe(5);
  });

  it('builds a match plan only when at least one arm qualifies', () => {
    expect(
      buildListQMatchPlan('a', { minNameLength: 2, minUhidLength: 2, minPhoneDigits: 3 }),
    ).toBeNull();
    const plan = buildListQMatchPlan('Sa', {
      minNameLength: 2,
      minUhidLength: 2,
      minPhoneDigits: 3,
    });
    expect(plan?.namePrefixPat).toBe('sa%');
    expect(plan?.nameWordPat).toBe('% sa%');
    expect(plan?.uhidPat).toBe('sa%');
    expect(plan?.phonePat).toBeNull();
  });
});
