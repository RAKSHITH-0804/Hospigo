/**
 * @jest-environment node
 */
import nextConfig from '../../../next.config';

describe('auth link page headers', () => {
  it('sets Referrer-Policy no-referrer and Cache-Control no-store on forgot/reset/activate', async () => {
    const headersFn = nextConfig.headers;
    expect(typeof headersFn).toBe('function');
    const entries = await headersFn!();
    const sources = ['/forgot-password', '/reset-password', '/activate'];
    for (const source of sources) {
      const entry = entries.find((e) => e.source === source);
      expect(entry).toBeDefined();
      const keys = Object.fromEntries(entry!.headers.map((h) => [h.key, h.value]));
      expect(keys['Referrer-Policy']).toBe('no-referrer');
      expect(keys['Cache-Control']).toBe('no-store');
    }
  });
});
