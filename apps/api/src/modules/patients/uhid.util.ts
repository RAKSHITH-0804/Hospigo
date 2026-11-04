import type { UhidBlockType, UhidFyStyle, UhidResetRule } from '../../generated/prisma';

export interface UhidBlockInput {
  position: number;
  blockType: UhidBlockType;
  textValue: string | null;
  fyStyle: UhidFyStyle | null;
  minWidth: number | null;
}

export interface UhidConfigInput {
  resetRule: UhidResetRule;
  fyStartMonth: number;
  timezone: string;
  blocks: UhidBlockInput[];
}

/** Calendar parts in a hospital timezone (server clock converted). */
export function zonedParts(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour'] === '24' ? '0' : parts['hour']),
    minute: Number(parts['minute']),
  };
}

/** Financial-year start calendar year, or 0 when reset NEVER. */
export function resolvePeriodYear(
  now: Date,
  resetRule: UhidResetRule,
  fyStartMonth: number,
  timeZone: string,
): number {
  if (resetRule === 'NEVER') {
    return 0;
  }
  const { year, month } = zonedParts(now, timeZone);
  return month >= fyStartMonth ? year : year - 1;
}

export function formatFinancialYear(startYear: number, style: UhidFyStyle): string {
  const endYear = startYear + 1;
  if (style === 'LONG') {
    return `${startYear}-${String(endYear).slice(-2)}`;
  }
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`;
}

export function padRunningNumber(n: bigint, minWidth: number): string {
  const raw = n.toString();
  if (raw.length >= minWidth) {
    return raw;
  }
  return raw.padStart(minWidth, '0');
}

export function buildUhid(args: {
  config: UhidConfigInput;
  now: Date;
  periodYear: number;
  runningNumber: bigint;
  branchCode: string;
}): string {
  const sorted = [...args.config.blocks].sort((a, b) => a.position - b.position);
  const fyStart =
    args.config.resetRule === 'FINANCIAL_YEAR'
      ? args.periodYear
      : resolvePeriodYear(
          args.now,
          'FINANCIAL_YEAR',
          args.config.fyStartMonth,
          args.config.timezone,
        );
  const calYear = zonedParts(args.now, args.config.timezone).year;

  let out = '';
  for (const block of sorted) {
    switch (block.blockType) {
      case 'FIXED_TEXT':
      case 'SEPARATOR':
        out += block.textValue ?? '';
        break;
      case 'BRANCH_CODE':
        out += args.branchCode;
        break;
      case 'FINANCIAL_YEAR':
        out += formatFinancialYear(fyStart, block.fyStyle ?? 'SHORT');
        break;
      case 'CALENDAR_YEAR':
        out += String(calYear);
        break;
      case 'RUNNING_NUMBER':
        out += padRunningNumber(args.runningNumber, block.minWidth ?? 1);
        break;
      default: {
        const _x: never = block.blockType;
        throw new Error(`Unknown UHID block type: ${_x}`);
      }
    }
  }
  return out;
}

/** Service-level validation before insert (DB also enforces after commit via deferred triggers). */
export function assertUhidConfigValid(config: UhidConfigInput): void {
  const running = config.blocks.filter((b) => b.blockType === 'RUNNING_NUMBER');
  if (running.length !== 1) {
    throw new Error(
      `UHID format must have exactly one RUNNING_NUMBER block (found ${running.length})`,
    );
  }
  if (config.resetRule === 'FINANCIAL_YEAR') {
    const fy = config.blocks.filter((b) => b.blockType === 'FINANCIAL_YEAR');
    if (fy.length < 1) {
      throw new Error('UHID FINANCIAL_YEAR reset_rule requires at least one FINANCIAL_YEAR block');
    }
  }
  if (config.fyStartMonth < 1 || config.fyStartMonth > 12) {
    throw new Error('fy_start_month must be 1-12');
  }
}
