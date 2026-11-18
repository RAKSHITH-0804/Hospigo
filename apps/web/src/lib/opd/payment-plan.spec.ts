/**
 * @jest-environment node
 */
import { planPayments, type PaymentDraft } from './payment-plan';
import type { PaymentMode } from './types';

const modes: PaymentMode[] = [
  { code: 'CASH', name: 'Cash', requiresReference: false },
  { code: 'CARD', name: 'Card', requiresReference: false },
  { code: 'UPI', name: 'UPI', requiresReference: true },
];
const row = (id: number, modeCode: string, amountText = '', reference = ''): PaymentDraft => ({
  id,
  modeCode,
  amountText,
  reference,
});

describe('planPayments', () => {
  it('one row pays the whole total, whatever is in its amount box', () => {
    expect(planPayments([row(1, 'CASH', '100')], modes, 60_000)).toEqual({
      ok: true,
      payments: [{ paymentModeCode: 'CASH', amountPaise: 60_000 }],
      remainingPaise: 0,
    });
  });

  it('a split must add up exactly: UPI 300 + cash 200 on 500', () => {
    const plan = planPayments(
      [row(1, 'UPI', '300', ' UTR-1 '), row(2, 'CASH', '200')],
      modes,
      50_000,
    );
    expect(plan).toEqual({
      ok: true,
      payments: [
        { paymentModeCode: 'UPI', amountPaise: 30_000, referenceNo: 'UTR-1' },
        { paymentModeCode: 'CASH', amountPaise: 20_000 },
      ],
      remainingPaise: 0,
    });
  });

  it('short and over are not ok and say by how much (nothing to send)', () => {
    expect(planPayments([row(1, 'CASH', '300'), row(2, 'CARD', '100')], modes, 50_000)).toEqual({
      ok: false,
      payments: [],
      remainingPaise: 10_000,
    });
    expect(planPayments([row(1, 'CASH', '300'), row(2, 'CARD', '300')], modes, 50_000)).toEqual({
      ok: false,
      payments: [],
      remainingPaise: -10_000,
    });
  });

  it('a missing, zero or unreadable amount blocks the split', () => {
    for (const bad of ['', '0', 'abc', '-5', '1.234']) {
      expect(planPayments([row(1, 'CASH', '500'), row(2, 'CARD', bad)], modes, 50_000).ok).toBe(
        false,
      );
    }
  });

  it('the same mode twice, an unknown mode and a missing reference block it', () => {
    expect(planPayments([row(1, 'CASH', '300'), row(2, 'CASH', '200')], modes, 50_000).ok).toBe(
      false,
    );
    expect(planPayments([row(1, 'CASH', '300'), row(2, 'NOPE', '200')], modes, 50_000).ok).toBe(
      false,
    );
    expect(planPayments([row(1, 'UPI', '300'), row(2, 'CASH', '200')], modes, 50_000).ok).toBe(
      false,
    );
    expect(
      planPayments([row(1, 'UPI', '300', '   '), row(2, 'CASH', '200')], modes, 50_000).ok,
    ).toBe(false);
    expect(planPayments([row(1, 'UPI')], modes, 50_000).ok).toBe(false); // single UPI needs its reference too
  });

  it('nothing to pay or no rows is never ok', () => {
    expect(planPayments([row(1, 'CASH')], modes, 0).ok).toBe(false);
    expect(planPayments([], modes, 50_000).ok).toBe(false);
  });

  it('uses integer paise only (no float drift on 0.1 + 0.2 style amounts)', () => {
    expect(planPayments([row(1, 'CASH', '0.10'), row(2, 'CARD', '0.20')], modes, 30).ok).toBe(true);
    expect(planPayments([row(1, 'CASH', '33.33'), row(2, 'CARD', '66.67')], modes, 10_000).ok).toBe(
      true,
    );
  });
});
