import type { TenantTx } from '../../database/tenant-db';
import { planPayments } from './billing-helpers';

type Mode = { id: string; code: string; requiresReference: boolean; active: boolean };

/** A stand-in transaction that finds payment modes the way the database would (active ones by code). */
function txWith(modes: Mode[]): TenantTx {
  return {
    paymentMode: {
      findFirst: async ({ where }: { where: { code: string; active: boolean } }) =>
        modes.find((m) => m.code === where.code && m.active === where.active) ?? null,
    },
  } as unknown as TenantTx;
}

const modes: Mode[] = [
  { id: 'm-cash', code: 'CASH', requiresReference: false, active: true },
  { id: 'm-upi', code: 'UPI', requiresReference: true, active: true },
  { id: 'm-card', code: 'CARD', requiresReference: true, active: true },
  { id: 'm-old', code: 'OLD', requiresReference: false, active: false },
];

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
  } catch (error) {
    return (error as { response?: { code?: string } }).response?.code ?? 'OTHER';
  }
  return 'OK';
};

describe('planPayments: the reference rule of a payment mode (Step 8c keeps it as it was)', () => {
  it('cash needs no reference; UPI and card need one', async () => {
    const tx = txWith(modes);
    expect(await code(planPayments(tx, { paymentModeCode: 'CASH' }, 1000, 't'))).toBe('OK');
    expect(await code(planPayments(tx, { paymentModeCode: 'UPI' }, 1000, 't'))).toBe(
      'REFERENCE_REQUIRED',
    );
    expect(
      await code(planPayments(tx, { paymentModeCode: 'CARD', referenceNo: '   ' }, 1000, 't')),
    ).toBe('REFERENCE_REQUIRED');
    const ok = await planPayments(
      tx,
      { paymentModeCode: 'UPI', referenceNo: ' TXN42 ' },
      1000,
      't',
    );
    expect(ok).toEqual([
      { modeId: 'm-upi', modeCode: 'UPI', amountPaise: 1000, referenceNo: 'TXN42' },
    ]);
  });

  it('a split payment checks every line: one line without its reference refuses the whole split', async () => {
    const tx = txWith(modes);
    const split = (refUpi?: string) =>
      planPayments(
        tx,
        {
          payments: [
            { paymentModeCode: 'CASH', amountPaise: 600 },
            { paymentModeCode: 'UPI', amountPaise: 400, referenceNo: refUpi },
          ],
        },
        1000,
        't',
      );
    expect(await code(split())).toBe('REFERENCE_REQUIRED');
    expect(await code(split('R1'))).toBe('OK');
  });

  it('the flag of the mode as it is NOW decides: switching it off makes a mode work without a reference, switching it on asks for one', async () => {
    const flip = (requiresReference: boolean) =>
      txWith(modes.map((m) => (m.code === 'UPI' ? { ...m, requiresReference } : m)));
    expect(await code(planPayments(flip(false), { paymentModeCode: 'UPI' }, 500, 't'))).toBe('OK');
    expect(await code(planPayments(flip(true), { paymentModeCode: 'UPI' }, 500, 't'))).toBe(
      'REFERENCE_REQUIRED',
    );
    const cashFlag = txWith(
      modes.map((m) => (m.code === 'CASH' ? { ...m, requiresReference: true } : m)),
    );
    expect(await code(planPayments(cashFlag, { paymentModeCode: 'CASH' }, 500, 't'))).toBe(
      'REFERENCE_REQUIRED',
    );
  });

  it('a switched-off mode is not available, and a free bill takes no payment at all', async () => {
    const tx = txWith(modes);
    expect(await code(planPayments(tx, { paymentModeCode: 'OLD' }, 500, 't'))).toBe(
      'PAYMENT_MODE_NOT_AVAILABLE',
    );
    expect(await code(planPayments(tx, { paymentModeCode: 'UPI' }, 0, 't'))).toBe('OK');
    expect(await planPayments(tx, { paymentModeCode: 'UPI' }, 0, 't')).toEqual([]);
  });
});
