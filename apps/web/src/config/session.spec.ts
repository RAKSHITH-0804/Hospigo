/**
 * @jest-environment node
 */
import {
  assertProductionApiInternalUrl,
  assertProductionAppUrl,
  requireApiInternalUrl,
  requireAppOrigin,
} from './session';

describe('APP_URL production startup gate', () => {
  it('assertProductionAppUrl throws when APP_URL is unset in production', () => {
    expect(() => assertProductionAppUrl({ NODE_ENV: 'production', APP_URL: undefined })).toThrow(
      /APP_URL is required/,
    );
  });

  it('assertProductionAppUrl is a no-op outside production', () => {
    expect(() =>
      assertProductionAppUrl({ NODE_ENV: 'development', APP_URL: undefined }),
    ).not.toThrow();
  });

  it('requireAppOrigin returns the origin from APP_URL', () => {
    expect(requireAppOrigin({ APP_URL: 'http://127.0.0.1:3001/path' })).toBe(
      'http://127.0.0.1:3001',
    );
  });
});

describe('API_INTERNAL_URL production startup gate', () => {
  it('assertProductionApiInternalUrl throws when unset in production', () => {
    expect(() =>
      assertProductionApiInternalUrl({ NODE_ENV: 'production', API_INTERNAL_URL: undefined }),
    ).toThrow(/API_INTERNAL_URL is required/);
  });

  it('assertProductionApiInternalUrl is a no-op outside production', () => {
    expect(() =>
      assertProductionApiInternalUrl({ NODE_ENV: 'development', API_INTERNAL_URL: undefined }),
    ).not.toThrow();
  });

  it('requireApiInternalUrl rejects non-http values', () => {
    expect(() => requireApiInternalUrl({ API_INTERNAL_URL: 'ftp://x' })).toThrow(
      /must start with http/,
    );
  });
});
