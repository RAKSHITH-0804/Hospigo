/**
 * @jest-environment node
 */

const redirectMock = jest.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

jest.mock('./guards', () => ({
  requireKind: jest.fn(),
}));

import { requireKind } from './guards';
import { isModuleMapped, requireModule } from './module-guard';

describe('requireModule guard', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    (requireKind as jest.Mock).mockReset();
  });

  it('allows an enabled module for the active branch', async () => {
    (requireKind as jest.Mock).mockResolvedValue({
      kind: 'HOSPITAL',
      enabledModules: [{ code: 'OPD', name: 'OPD' }],
    });
    const session = await requireModule('OPD');
    expect(session.enabledModules?.[0]?.code).toBe('OPD');
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects home with notice when the module is not enabled', async () => {
    (requireKind as jest.Mock).mockResolvedValue({
      kind: 'HOSPITAL',
      enabledModules: [{ code: 'LAB', name: 'Lab' }],
    });
    await expect(requireModule('IPD')).rejects.toThrow('REDIRECT:/app?notice=module-unavailable');
  });

  it('treats missing enabledModules as unavailable', async () => {
    (requireKind as jest.Mock).mockResolvedValue({ kind: 'HOSPITAL' });
    await expect(requireModule('OPD')).rejects.toThrow('REDIRECT:/app?notice=module-unavailable');
  });

  it('isModuleMapped reports known catalog codes', () => {
    expect(isModuleMapped('OPD')).toBe(true);
    expect(isModuleMapped('NOT_A_MODULE')).toBe(false);
  });
});
