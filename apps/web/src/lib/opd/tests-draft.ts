import type { OrderView, TestItem } from './tests-types';

/** One test on the doctor's Tests box: what the server holds, plus tests added but not saved yet. */
export type TestChip = {
  chargeItemId: string;
  code: string;
  name: string;
  /** Plain text on purpose: a status this screen does not know must never break it. */
  status: string;
  notTakenReason: string | null;
};

export type StatusKind = 'ordered' | 'billed' | 'notTaken' | 'other';

export function statusKind(status: string): StatusKind {
  switch (status) {
    case 'ORDERED':
      return 'ordered';
    case 'BILLED':
      return 'billed';
    case 'NOT_TAKEN':
      return 'notTaken';
    default:
      return 'other';
  }
}

export function chipsFromOrders(orders: OrderView[]): TestChip[] {
  return orders.map((o) => ({
    chargeItemId: o.chargeItemId,
    code: o.code,
    name: o.name,
    status: o.status,
    notTakenReason: o.notTakenReason,
  }));
}

export function newChip(test: TestItem): TestChip {
  return {
    chargeItemId: test.id,
    code: test.code,
    name: test.name,
    status: 'ORDERED',
    notTakenReason: null,
  };
}

/** Adds a test unless it is already on the list. */
export function addChip(chips: TestChip[], test: TestItem): TestChip[] {
  return chips.some((c) => c.chargeItemId === test.id) ? chips : [...chips, newChip(test)];
}

/** Only a test that is still just ORDERED can be taken off (a billed or declined one stays). */
export function canRemoveChip(chip: TestChip): boolean {
  return statusKind(chip.status) === 'ordered';
}

export function removeChip(chips: TestChip[], chargeItemId: string): TestChip[] {
  return chips.filter((c) => c.chargeItemId !== chargeItemId || !canRemoveChip(c));
}

export function chipIds(chips: TestChip[]): string[] {
  return chips.map((c) => c.chargeItemId);
}

/** Compares lists regardless of order (what the server is told is a set of tests). */
export function testsKey(chips: TestChip[]): string {
  return JSON.stringify([...chipIds(chips)].sort());
}

/**
 * Brings the server's answer into the list the doctor is looking at WITHOUT undoing newer typing:
 * a test still on screen takes the server's status; a test the server holds that is already billed
 * or declined is added; a test the doctor just removed is not brought back; one just added stays.
 */
export function mergeServer(local: TestChip[], orders: OrderView[]): TestChip[] {
  const server = new Map(chipsFromOrders(orders).map((c) => [c.chargeItemId, c]));
  const merged = local.map((c) => server.get(c.chargeItemId) ?? c);
  const have = new Set(local.map((c) => c.chargeItemId));
  for (const c of server.values()) {
    if (!have.has(c.chargeItemId) && !canRemoveChip(c)) {
      merged.push(c);
    }
  }
  return merged;
}
