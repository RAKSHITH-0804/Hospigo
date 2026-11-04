import { getContext, requireContext, runWithContext, type RequestContext } from './request-context';

function ctx(id: string): RequestContext {
  return {
    tenantId: `tenant_${id}`,
    userId: `user_${id}`,
    kind: 'HOSPITAL',
    activeBranchId: null,
    requestId: `req_${id}`,
  };
}

describe('RequestContext (AsyncLocalStorage)', () => {
  it('parallel async flows with different contexts never see each other', async () => {
    const seen: string[] = [];
    const flow = async (id: string, delayMs: number) => {
      await runWithContext(ctx(id), async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        seen.push(`${id}:${requireContext().tenantId}`);
        await new Promise((r) => setTimeout(r, 5));
        expect(getContext()?.requestId).toBe(`req_${id}`);
        expect(requireContext().userId).toBe(`user_${id}`);
      });
    };

    await Promise.all([flow('A', 15), flow('B', 5), flow('C', 10)]);
    expect(seen.sort()).toEqual(['A:tenant_A', 'B:tenant_B', 'C:tenant_C']);
    expect(getContext()).toBeUndefined();
    expect(() => requireContext()).toThrow(/Request context is required/);
  });
});
