import { staffCopy } from '@/config/staff-copy';
import type { PatientsApiError } from '@/lib/patients/client';
import { checkChosenFile, pictureErrorMessage, rulesText, sizeText } from './errors';
import { doctorSignatureRoute, imageUrl, type ImageLimits } from './types';

const copy = staffCopy.pictures;
const limits: ImageLimits = {
  maxBytes: 1_048_576,
  maxSidePx: 4000,
  minSidePx: 16,
  types: ['image/png', 'image/jpeg', 'image/webp'],
};
const refusal = (over: Partial<PatientsApiError>): PatientsApiError => ({
  ok: false,
  status: 400,
  code: 'SETTINGS_INVALID',
  field: 'file',
  ...over,
});
const file = (size: number, type: string) => {
  const f = new File([new Uint8Array(Math.min(size, 4))], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('sizeText', () => {
  it('says the limit in words', () => {
    expect(sizeText(1_048_576)).toBe('1 MB');
    expect(sizeText(2_621_440)).toBe('2.5 MB');
    expect(sizeText(307_200)).toBe('300 KB');
    expect(sizeText(10)).toBe('1 KB');
  });
});

describe('rulesText', () => {
  it('comes from the limits the API sent, never from numbers in the screen', () => {
    expect(rulesText(limits)).toBe(
      'PNG, JPEG or WebP, up to 1 MB, from 16 to 4000 pixels on each side.',
    );
    expect(rulesText({ ...limits, maxBytes: 524_288, maxSidePx: 1000 })).toContain('512 KB');
    expect(rulesText({ ...limits, maxBytes: 524_288, maxSidePx: 1000 })).toContain('1000');
  });
});

describe('pictureErrorMessage', () => {
  it.each(Object.keys(copy.errors).filter((k) => k !== 'fallback'))(
    'explains the reason %s in plain words with the real numbers',
    (reason) => {
      const text = pictureErrorMessage(refusal({ reason }), limits);
      expect(text).toBe(
        copy.errors[reason]!.replace('{size}', '1 MB')
          .replace('{min}', '16')
          .replace('{max}', '4000'),
      );
      expect(text).not.toContain('{');
    },
  );

  it('every reason the API can give has a sentence', () => {
    for (const reason of [
      'REQUIRED',
      'EMPTY',
      'TOO_BIG',
      'NOT_AN_IMAGE',
      'CORRUPT',
      'TOO_SMALL',
      'TOO_LARGE_PIXELS',
    ]) {
      expect(copy.errors[reason]).toBeTruthy();
    }
  });

  it('an unknown reason gets the calm general sentence', () => {
    expect(pictureErrorMessage(refusal({ reason: 'NEW_ONE' }), limits)).toBe(copy.errors.fallback);
    expect(pictureErrorMessage(refusal({}), limits)).toBe(copy.errors.fallback);
  });

  it('other refusals use the usual staff wording (not allowed, try again, network)', () => {
    expect(
      pictureErrorMessage(refusal({ status: 403, code: 'FORBIDDEN', field: undefined }), limits),
    ).toBe(staffCopy.errors.forbidden);
    expect(
      pictureErrorMessage(
        refusal({ status: 409, code: 'STAFF_CONFLICT', reason: 'TRY_AGAIN', field: undefined }),
        limits,
      ),
    ).toBe(staffCopy.staffAdmin.errors.conflicts.TRY_AGAIN);
    expect(
      pictureErrorMessage(refusal({ status: 0, code: 'UNAVAILABLE', field: undefined }), limits),
    ).toBe(staffCopy.errors.unreachable);
  });
});

describe('checkChosenFile (a courtesy before sending; the API checks the real bytes)', () => {
  it('accepts a normal picture', () => {
    expect(checkChosenFile(file(2000, 'image/png'), limits)).toBeNull();
    expect(checkChosenFile(file(limits.maxBytes, 'image/webp'), limits)).toBeNull();
  });
  it('refuses an empty file, a big file and another type', () => {
    expect(checkChosenFile(file(0, 'image/png'), limits)).toBe(copy.errors.EMPTY);
    expect(checkChosenFile(file(limits.maxBytes + 1, 'image/png'), limits)).toBe(
      copy.errors.TOO_BIG!.replace('{size}', '1 MB'),
    );
    expect(checkChosenFile(file(100, 'image/svg+xml'), limits)).toBe(copy.errors.NOT_AN_IMAGE);
    expect(checkChosenFile(file(100, 'application/pdf'), limits)).toBe(copy.errors.NOT_AN_IMAGE);
    expect(checkChosenFile(file(100, ''), limits)).toBe(copy.errors.NOT_AN_IMAGE);
  });
});

describe('addresses', () => {
  it('encode the id so it can only ever be one path segment', () => {
    expect(imageUrl('abc-123')).toBe('/api/staff/images/abc-123');
    expect(imageUrl('../x')).toBe('/api/staff/images/..%2Fx');
    expect(doctorSignatureRoute('d 1')).toBe('/api/staff/doctor-profiles/d%201/signature');
  });
});
