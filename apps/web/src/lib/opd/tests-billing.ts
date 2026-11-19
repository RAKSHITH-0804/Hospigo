import type { NotTakenPayload, PendingOrder } from './tests-types';

/** What the receptionist chose for one pending test. */
export type TestChoice = { taken: boolean; reason: string };

export const DEFAULT_CHOICE: TestChoice = { taken: true, reason: '' };

export type BillingProblem = 'NONE_TAKEN' | 'REASON_MISSING' | null;

export type BillingPlan = {
  /** True only when the choices can be sent as they are (the API checks everything again). */
  ok: boolean;
  problem: BillingProblem;
  /** Sum of the prices of the tests the patient will take, in whole paise. */
  totalPaise: number;
  /** Orders to bill, in list order. */
  orderIds: string[];
  /** Orders the patient declines (always with a reason). */
  notTaken: NotTakenPayload[];
  /** Orders with no price set: they are left alone (neither billed nor declined). */
  unpricedIds: string[];
};

/**
 * Turns the receptionist's choices into what is sent. A test the patient will take is billed at
 * the price shown; one that is unticked is declined and needs a reason; a test with no price set
 * cannot be billed and is left on the list. All arithmetic is integer paise.
 */
export function planBilling(
  orders: PendingOrder[],
  choices: Record<string, TestChoice | undefined>,
): BillingPlan {
  const orderIds: string[] = [];
  const notTaken: NotTakenPayload[] = [];
  const unpricedIds: string[] = [];
  let totalPaise = 0;
  let reasonMissing = false;

  for (const order of orders) {
    if (order.pricePaise === null) {
      unpricedIds.push(order.id);
      continue;
    }
    const choice = choices[order.id] ?? DEFAULT_CHOICE;
    if (choice.taken) {
      orderIds.push(order.id);
      totalPaise += order.pricePaise;
    } else {
      const reason = choice.reason.trim();
      if (reason === '') {
        reasonMissing = true;
      } else {
        notTaken.push({ orderId: order.id, reason });
      }
    }
  }

  const problem: BillingProblem =
    orderIds.length === 0 ? 'NONE_TAKEN' : reasonMissing ? 'REASON_MISSING' : null;
  return {
    ok: problem === null,
    problem,
    totalPaise,
    orderIds,
    notTaken,
    unpricedIds,
  };
}

/** A fingerprint of the choices: any change of it is a new request and needs a new key. */
export function choicesSignature(plan: BillingPlan): string {
  return JSON.stringify([plan.orderIds, plan.notTaken, plan.totalPaise]);
}
