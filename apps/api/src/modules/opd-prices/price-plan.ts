import { isRealDate, localDate, startOfLocalDay } from './local-date';

/** What a requested price change would do (one rule for the Prices screen and the Excel upload). */
export type PricePlan =
  | { kind: 'invalid'; field: string; reason: string }
  | { kind: 'unchanged' }
  | { kind: 'new'; start: Date };

/**
 * Step 8b decision 3: a price starts today (from now) or on a later date (at the start of that
 * day); the date may not be before today, except for the very first price of an item; it may not be
 * earlier than the latest existing version; the same amount as the latest version changes nothing;
 * two versions cannot start at the same moment.
 */
export function planPriceChange(args: {
  requested: string | undefined;
  now: Date;
  timeZone: string;
  latest: { amountPaise: number; effectiveFrom: Date } | null;
  amountPaise: number;
}): PricePlan {
  const today = localDate(args.now, args.timeZone);
  const date = args.requested ?? today;
  if (!isRealDate(date)) {
    return { kind: 'invalid', field: 'effectiveFrom', reason: 'DATE_INVALID' };
  }
  if (date < today && args.latest !== null) {
    return { kind: 'invalid', field: 'effectiveFrom', reason: 'DATE_IN_PAST' };
  }
  const start = date === today ? args.now : startOfLocalDay(date, args.timeZone);
  if (args.latest && start.getTime() < args.latest.effectiveFrom.getTime()) {
    return { kind: 'invalid', field: 'effectiveFrom', reason: 'DATE_BEFORE_LATEST' };
  }
  if (args.latest && args.latest.amountPaise === args.amountPaise) {
    return { kind: 'unchanged' };
  }
  if (args.latest && start.getTime() === args.latest.effectiveFrom.getTime()) {
    return { kind: 'invalid', field: 'effectiveFrom', reason: 'VERSION_EXISTS' };
  }
  return { kind: 'new', start };
}
