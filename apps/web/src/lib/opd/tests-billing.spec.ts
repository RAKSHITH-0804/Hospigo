import { choicesSignature, planBilling } from './tests-billing';
import type { PendingOrder } from './tests-types';

const order = (id: string, pricePaise: number | null): PendingOrder => ({
  id,
  chargeItemId: `c-${id}`,
  code: id.toUpperCase(),
  name: `Test ${id}`,
  pricePaise,
  orderedAt: '2026-11-20T04:00:00.000Z',
});

describe('planBilling', () => {
  it('bills every test by default and adds up the prices in paise', () => {
    const plan = planBilling([order('a', 25000), order('b', 12550)], {});
    expect(plan).toMatchObject({
      ok: true,
      problem: null,
      totalPaise: 37550,
      orderIds: ['a', 'b'],
      notTaken: [],
      unpricedIds: [],
    });
  });

  it('an unticked test is declined with its reason and not charged', () => {
    const plan = planBilling([order('a', 25000), order('b', 20000)], {
      b: { taken: false, reason: '  done elsewhere ' },
    });
    expect(plan).toMatchObject({
      ok: true,
      totalPaise: 25000,
      orderIds: ['a'],
      notTaken: [{ orderId: 'b', reason: 'done elsewhere' }],
    });
  });

  it('an unticked test without a reason blocks the bill', () => {
    const plan = planBilling([order('a', 25000), order('b', 20000)], {
      b: { taken: false, reason: '   ' },
    });
    expect(plan).toMatchObject({ ok: false, problem: 'REASON_MISSING', orderIds: ['a'] });
  });

  it('nothing ticked blocks the bill', () => {
    const plan = planBilling([order('a', 25000)], { a: { taken: false, reason: 'no' } });
    expect(plan).toMatchObject({ ok: false, problem: 'NONE_TAKEN', totalPaise: 0 });
    expect(planBilling([], {})).toMatchObject({ ok: false, problem: 'NONE_TAKEN' });
  });

  it('a test with no price is left alone: never billed and never declined', () => {
    const plan = planBilling([order('a', 25000), order('c', null)], {
      c: { taken: false, reason: '' },
    });
    expect(plan).toMatchObject({
      ok: true,
      totalPaise: 25000,
      orderIds: ['a'],
      notTaken: [],
      unpricedIds: ['c'],
    });
    expect(planBilling([order('c', null)], {})).toMatchObject({ ok: false, problem: 'NONE_TAKEN' });
  });

  it('free tests give a zero total that can still be billed', () => {
    expect(planBilling([order('a', 0)], {})).toMatchObject({ ok: true, totalPaise: 0 });
  });

  it('the signature changes with any choice and with the total', () => {
    const orders = [order('a', 25000), order('b', 20000)];
    const base = choicesSignature(planBilling(orders, {}));
    expect(choicesSignature(planBilling(orders, {}))).toBe(base);
    expect(choicesSignature(planBilling(orders, { b: { taken: false, reason: 'x' } }))).not.toBe(
      base,
    );
    expect(choicesSignature(planBilling(orders, { b: { taken: false, reason: 'y' } }))).not.toBe(
      choicesSignature(planBilling(orders, { b: { taken: false, reason: 'x' } })),
    );
    expect(choicesSignature(planBilling([order('a', 25001), order('b', 20000)], {}))).not.toBe(
      base,
    );
  });
});
