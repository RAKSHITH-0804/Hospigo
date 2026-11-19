import {
  addChip,
  canRemoveChip,
  chipIds,
  chipsFromOrders,
  mergeServer,
  removeChip,
  statusKind,
  testsKey,
} from './tests-draft';
import type { OrderView } from './tests-types';

const order = (over: Partial<OrderView> = {}): OrderView => ({
  id: 'o1',
  chargeItemId: 't1',
  code: 'INV001',
  name: 'Mock Test 001',
  status: 'ORDERED',
  notTakenReason: null,
  billNumber: null,
  orderedAt: '2026-11-20T04:00:00.000Z',
  resolvedAt: null,
  ...over,
});
const test = (id: string) => ({ id, code: `C${id}`, name: `Test ${id}` });

describe('tests draft', () => {
  it('knows the three statuses and treats any new status neutrally', () => {
    expect(statusKind('ORDERED')).toBe('ordered');
    expect(statusKind('BILLED')).toBe('billed');
    expect(statusKind('NOT_TAKEN')).toBe('notTaken');
    expect(statusKind('RESULT_READY')).toBe('other');
    expect(statusKind('')).toBe('other');
  });

  it('adds a test once and removes only a test that is still just ordered', () => {
    let chips = addChip([], test('a'));
    chips = addChip(chips, test('a'));
    chips = addChip(chips, test('b'));
    expect(chipIds(chips)).toEqual(['a', 'b']);
    expect(removeChip(chips, 'a').map((c) => c.chargeItemId)).toEqual(['b']);
    const billed = chipsFromOrders([order({ chargeItemId: 'x', status: 'BILLED' })]);
    expect(canRemoveChip(billed[0]!)).toBe(false);
    expect(removeChip(billed, 'x')).toEqual(billed);
    const later = chipsFromOrders([order({ chargeItemId: 'y', status: 'RESULT_READY' })]);
    expect(removeChip(later, 'y')).toEqual(later);
  });

  it('compares lists as sets', () => {
    const ab = [addChip([], test('a'))[0]!, addChip([], test('b'))[0]!];
    expect(testsKey(ab)).toBe(testsKey([...ab].reverse()));
    expect(testsKey(ab)).not.toBe(testsKey([ab[0]!]));
  });

  it('merges the server answer without undoing newer typing', () => {
    const local = addChip(addChip([], test('a')), test('c')); // c was just added
    const merged = mergeServer(local, [
      order({ chargeItemId: 'a', status: 'BILLED' }), // billed meanwhile
      order({ chargeItemId: 'b', status: 'ORDERED' }), // the doctor just removed b: stays removed
      order({ chargeItemId: 'd', status: 'NOT_TAKEN', notTakenReason: 'elsewhere' }), // new fact
    ]);
    expect(merged.map((c) => [c.chargeItemId, c.status])).toEqual([
      ['a', 'BILLED'],
      ['c', 'ORDERED'],
      ['d', 'NOT_TAKEN'],
    ]);
    expect(merged.find((c) => c.chargeItemId === 'd')!.notTakenReason).toBe('elsewhere');
  });
});
