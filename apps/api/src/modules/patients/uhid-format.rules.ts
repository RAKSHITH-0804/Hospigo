import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { UhidBlockInput, UhidConfigInput } from './uhid.util';
import { assertUhidConfigValid, buildUhid } from './uhid.util';

/** Limits of a hospital's patient-number format (settings screen). One place, no magic numbers. */
export const UHID_FORMAT_LIMITS = {
  maxBlocks: 12,
  maxTextLength: 10,
  minWidthMin: 1,
  minWidthMax: 12,
  maxExampleLength: 30,
  fyStartMonthMin: 1,
  fyStartMonthMax: 12,
  fyStartMonthDefault: 4,
} as const;

/** Letters, digits and / _ . - only: a patient number is printed, spoken and typed. */
const TEXT_PATTERN = /^[A-Za-z0-9/_.-]+$/;
const BLOCK_TYPES = [
  'FIXED_TEXT',
  'BRANCH_CODE',
  'FINANCIAL_YEAR',
  'CALENDAR_YEAR',
  'SEPARATOR',
  'RUNNING_NUMBER',
] as const;
const ONCE_ONLY = ['BRANCH_CODE', 'FINANCIAL_YEAR', 'CALENDAR_YEAR', 'RUNNING_NUMBER'] as const;
const TEXT_BLOCKS = ['FIXED_TEXT', 'SEPARATOR'] as const;

export const UhidReason = {
  REQUIRED: 'REQUIRED',
  INVALID: 'INVALID',
  TOO_MANY: 'TOO_MANY',
  TOO_LONG: 'TOO_LONG',
  DUPLICATE: 'DUPLICATE',
  NEEDS_FINANCIAL_YEAR: 'NEEDS_FINANCIAL_YEAR',
  NEEDS_RUNNING_NUMBER: 'NEEDS_RUNNING_NUMBER',
} as const;

function refuse(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field, reason });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type UhidFormatInput = Pick<UhidConfigInput, 'resetRule' | 'fyStartMonth' | 'blocks'>;

/**
 * Reads and checks the body of "save the patient number format". Anything not on the list is
 * ignored; every problem names the field and the reason (`400 SETTINGS_INVALID`).
 */
export function parseUhidFormat(body: unknown): UhidFormatInput {
  if (!isRecord(body)) {
    refuse('body', UhidReason.REQUIRED);
  }
  const resetRule = body.resetRule;
  if (resetRule !== 'NEVER' && resetRule !== 'FINANCIAL_YEAR') {
    refuse('resetRule', resetRule === undefined ? UhidReason.REQUIRED : UhidReason.INVALID);
  }
  let fyStartMonth: number = UHID_FORMAT_LIMITS.fyStartMonthDefault;
  if (body.fyStartMonth !== undefined) {
    if (
      !Number.isInteger(body.fyStartMonth) ||
      (body.fyStartMonth as number) < UHID_FORMAT_LIMITS.fyStartMonthMin ||
      (body.fyStartMonth as number) > UHID_FORMAT_LIMITS.fyStartMonthMax
    ) {
      refuse('fyStartMonth', UhidReason.INVALID);
    }
    fyStartMonth = body.fyStartMonth as number;
  }
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
    refuse('blocks', UhidReason.REQUIRED);
  }
  if (body.blocks.length > UHID_FORMAT_LIMITS.maxBlocks) {
    refuse('blocks', UhidReason.TOO_MANY);
  }

  const seen = new Set<string>();
  const blocks: UhidBlockInput[] = (body.blocks as unknown[]).map((raw, index) => {
    const at = (name: string) => `blocks.${index}.${name}`;
    if (!isRecord(raw)) {
      refuse(`blocks.${index}`, UhidReason.INVALID);
    }
    const blockType = raw.blockType as (typeof BLOCK_TYPES)[number];
    if (!BLOCK_TYPES.includes(blockType)) {
      refuse(
        at('blockType'),
        raw.blockType === undefined ? UhidReason.REQUIRED : UhidReason.INVALID,
      );
    }
    if ((ONCE_ONLY as readonly string[]).includes(blockType)) {
      if (seen.has(blockType)) {
        refuse(at('blockType'), UhidReason.DUPLICATE);
      }
      seen.add(blockType);
    }

    let textValue: string | null = null;
    if ((TEXT_BLOCKS as readonly string[]).includes(blockType)) {
      if (typeof raw.textValue !== 'string' || raw.textValue.length === 0) {
        refuse(at('textValue'), UhidReason.REQUIRED);
      }
      if (raw.textValue.length > UHID_FORMAT_LIMITS.maxTextLength) {
        refuse(at('textValue'), UhidReason.TOO_LONG);
      }
      if (!TEXT_PATTERN.test(raw.textValue)) {
        refuse(at('textValue'), UhidReason.INVALID);
      }
      textValue = raw.textValue;
    } else if (raw.textValue !== undefined && raw.textValue !== null) {
      refuse(at('textValue'), UhidReason.INVALID);
    }

    let fyStyle: UhidBlockInput['fyStyle'] = null;
    if (blockType === 'FINANCIAL_YEAR') {
      const style = raw.fyStyle ?? 'SHORT';
      if (style !== 'SHORT' && style !== 'LONG') {
        refuse(at('fyStyle'), UhidReason.INVALID);
      }
      fyStyle = style;
    } else if (raw.fyStyle !== undefined && raw.fyStyle !== null) {
      refuse(at('fyStyle'), UhidReason.INVALID);
    }

    let minWidth: number | null = null;
    if (blockType === 'RUNNING_NUMBER') {
      const width = raw.minWidth ?? UHID_FORMAT_LIMITS.minWidthMin;
      if (
        !Number.isInteger(width) ||
        (width as number) < UHID_FORMAT_LIMITS.minWidthMin ||
        (width as number) > UHID_FORMAT_LIMITS.minWidthMax
      ) {
        refuse(at('minWidth'), UhidReason.INVALID);
      }
      minWidth = width as number;
    } else if (raw.minWidth !== undefined && raw.minWidth !== null) {
      refuse(at('minWidth'), UhidReason.INVALID);
    }

    return { position: index + 1, blockType, textValue, fyStyle, minWidth };
  });

  if (!seen.has('RUNNING_NUMBER')) {
    refuse('blocks', UhidReason.NEEDS_RUNNING_NUMBER);
  }
  if (resetRule === 'FINANCIAL_YEAR' && !seen.has('FINANCIAL_YEAR')) {
    refuse('blocks', UhidReason.NEEDS_FINANCIAL_YEAR);
  }

  const input: UhidFormatInput = { resetRule, fyStartMonth, blocks };
  assertUhidConfigValid({ ...input, timezone: 'Asia/Kolkata' });
  // The longest number this format can make (a big running number) must stay printable.
  const longest = exampleUhid(input, {
    now: new Date(),
    timezone: 'Asia/Kolkata',
    branchCode: 'X'.repeat(UHID_FORMAT_LIMITS.maxTextLength),
    runningNumber: 9_999_999n,
  });
  if (longest.length > UHID_FORMAT_LIMITS.maxExampleLength) {
    refuse('blocks', UhidReason.TOO_LONG);
  }
  return input;
}

/** A sample number for the screen (the next real one is shown separately). */
export function exampleUhid(
  format: UhidFormatInput,
  args: { now: Date; timezone: string; branchCode: string; runningNumber: bigint },
): string {
  const periodYear =
    format.resetRule === 'FINANCIAL_YEAR'
      ? financialYearStart(args.now, format.fyStartMonth, args.timezone)
      : 0;
  return buildUhid({
    config: { ...format, timezone: args.timezone },
    now: args.now,
    periodYear,
    runningNumber: args.runningNumber,
    branchCode: args.branchCode,
  });
}

function financialYearStart(now: Date, fyStartMonth: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  return month >= fyStartMonth ? year : year - 1;
}
