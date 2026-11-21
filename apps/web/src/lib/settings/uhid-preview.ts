import type { UhidBlock, UhidResetRule } from './types';

/**
 * A sample patient number for the screen while the format is being designed. The API builds the real
 * numbers (in the hospital time zone); this is only a guide, so the screen shows the API sample after
 * saving.
 */
export function previewUhid(args: {
  blocks: readonly UhidBlock[];
  resetRule: UhidResetRule;
  fyStartMonth: number;
  branchCode: string;
  now: Date;
  runningNumber: number;
}): string {
  const year = args.now.getFullYear();
  const month = args.now.getMonth() + 1;
  const fyStart = month >= args.fyStartMonth ? year : year - 1;
  const fy = (style: UhidBlock['fyStyle']): string =>
    style === 'LONG'
      ? `${fyStart}-${String(fyStart + 1).slice(-2)}`
      : `${String(fyStart).slice(-2)}${String(fyStart + 1).slice(-2)}`;
  return args.blocks
    .map((b) => {
      switch (b.blockType) {
        case 'FIXED_TEXT':
        case 'SEPARATOR':
          return b.textValue ?? '';
        case 'BRANCH_CODE':
          return args.branchCode;
        case 'FINANCIAL_YEAR':
          return fy(b.fyStyle);
        case 'CALENDAR_YEAR':
          return String(year);
        case 'RUNNING_NUMBER':
          return String(args.runningNumber).padStart(b.minWidth ?? 1, '0');
        default:
          return '';
      }
    })
    .join('');
}
