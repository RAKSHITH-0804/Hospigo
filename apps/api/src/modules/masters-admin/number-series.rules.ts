import type { UhidFyStyle } from '../../generated/prisma';
import type { NumberSeriesFormat } from '../opd-masters/number-series-format';
import { isObject, MasterRuleError, onlyKeys, plainText } from './masters.rules';

export const SERIES_KINDS = ['BILL', 'RECEIPT', 'REFUND'] as const;
export type SeriesKind = (typeof SERIES_KINDS)[number];

export const isSeriesKind = (value: string): value is SeriesKind =>
  (SERIES_KINDS as readonly string[]).includes(value);

/** The parts an Admin edits. The format of a series is always: prefix, financial year, separator, number. */
export type SeriesParams = {
  prefix: string;
  separator: string;
  fyStyle: UhidFyStyle;
  width: number;
};

export const SERIES_LIMITS = {
  prefixMax: 8,
  prefixPattern: /^[A-Za-z0-9._/-]*$/,
  separators: ['', '-', '/', '.', '_'] as const,
  widthMin: 1,
  widthMax: 10,
  startNumberMax: 999_999_999,
  reasonMax: 200,
  /** How many numbers ahead a format change is checked against numbers already issued. */
  lookAhead: 1000,
} as const;

/** The format as blocks: [FIXED prefix], FINANCIAL_YEAR, [SEPARATOR], RUNNING. */
export function buildFormat(p: SeriesParams): NumberSeriesFormat {
  const blocks: NumberSeriesFormat = [];
  if (p.prefix) {
    blocks.push({ type: 'FIXED', text: p.prefix });
  }
  blocks.push({ type: 'FINANCIAL_YEAR', style: p.fyStyle });
  if (p.separator) {
    blocks.push({ type: 'SEPARATOR', text: p.separator });
  }
  blocks.push({ type: 'RUNNING', width: p.width });
  return blocks;
}

/** JSON with the keys of every object sorted, so two equal values always give the same text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)),
        )
      : v,
  );
}

/** The editable parts of a stored format, or null when it has some other shape (then it is shown, not edited). */
export function parseStandardFormat(format: unknown): SeriesParams | null {
  if (!Array.isArray(format)) {
    return null;
  }
  const blocks = format as Array<{ type?: string; text?: string; style?: string; width?: number }>;
  let i = 0;
  let prefix = '';
  if (blocks[i]?.type === 'FIXED') {
    prefix = blocks[i]!.text ?? '';
    i += 1;
  }
  if (blocks[i]?.type !== 'FINANCIAL_YEAR') {
    return null;
  }
  const style = blocks[i]!.style;
  if (style !== 'SHORT' && style !== 'LONG') {
    return null;
  }
  i += 1;
  let separator = '';
  if (blocks[i]?.type === 'SEPARATOR') {
    separator = blocks[i]!.text ?? '';
    i += 1;
  }
  if (
    blocks[i]?.type !== 'RUNNING' ||
    typeof blocks[i]!.width !== 'number' ||
    i !== blocks.length - 1
  ) {
    return null;
  }
  const params: SeriesParams = { prefix, separator, fyStyle: style, width: blocks[i]!.width! };
  // only a format the screen could have made is editable (the stored JSON may list the keys in another order)
  return canonical(buildFormat(params)) === canonical(format) ? params : null;
}

export type SeriesPatch = Partial<SeriesParams> & {
  resetRule?: 'NEVER' | 'FINANCIAL_YEAR';
  fyStartMonth?: number;
};

export function parseSeriesPatch(body: unknown): SeriesPatch {
  if (!isObject(body)) {
    throw new MasterRuleError('prefix', 'NOTHING_TO_CHANGE');
  }
  onlyKeys(body, ['prefix', 'separator', 'fyStyle', 'width', 'resetRule', 'fyStartMonth']);
  const patch: SeriesPatch = {};
  if (body.prefix !== undefined) {
    if (typeof body.prefix !== 'string') {
      throw new MasterRuleError('prefix', 'REQUIRED');
    }
    const prefix = body.prefix.trim();
    if (prefix.length > SERIES_LIMITS.prefixMax) {
      throw new MasterRuleError('prefix', 'TOO_LONG');
    }
    if (!SERIES_LIMITS.prefixPattern.test(prefix)) {
      throw new MasterRuleError('prefix', 'PREFIX_INVALID');
    }
    patch.prefix = prefix;
  }
  if (body.separator !== undefined) {
    if (
      typeof body.separator !== 'string' ||
      !(SERIES_LIMITS.separators as readonly string[]).includes(body.separator)
    ) {
      throw new MasterRuleError('separator', 'SEPARATOR_INVALID');
    }
    patch.separator = body.separator;
  }
  if (body.fyStyle !== undefined) {
    if (body.fyStyle !== 'SHORT' && body.fyStyle !== 'LONG') {
      throw new MasterRuleError('fyStyle', 'STYLE_INVALID');
    }
    patch.fyStyle = body.fyStyle;
  }
  if (body.width !== undefined) {
    if (
      typeof body.width !== 'number' ||
      !Number.isInteger(body.width) ||
      body.width < SERIES_LIMITS.widthMin ||
      body.width > SERIES_LIMITS.widthMax
    ) {
      throw new MasterRuleError('width', 'WIDTH_INVALID');
    }
    patch.width = body.width;
  }
  if (body.resetRule !== undefined) {
    if (body.resetRule !== 'NEVER' && body.resetRule !== 'FINANCIAL_YEAR') {
      throw new MasterRuleError('resetRule', 'RESET_INVALID');
    }
    patch.resetRule = body.resetRule;
  }
  if (body.fyStartMonth !== undefined) {
    if (
      typeof body.fyStartMonth !== 'number' ||
      !Number.isInteger(body.fyStartMonth) ||
      body.fyStartMonth < 1 ||
      body.fyStartMonth > 12
    ) {
      throw new MasterRuleError('fyStartMonth', 'MONTH_INVALID');
    }
    patch.fyStartMonth = body.fyStartMonth;
  }
  if (Object.keys(patch).length === 0) {
    throw new MasterRuleError('prefix', 'NOTHING_TO_CHANGE');
  }
  return patch;
}

export function parseStartNumber(body: unknown): { startNumber: number; reason: string } {
  if (!isObject(body)) {
    throw new MasterRuleError('startNumber', 'REQUIRED');
  }
  onlyKeys(body, ['startNumber', 'reason']);
  const n = body.startNumber;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > SERIES_LIMITS.startNumberMax) {
    throw new MasterRuleError('startNumber', 'START_INVALID');
  }
  return { startNumber: n, reason: plainText(body.reason, 'reason', SERIES_LIMITS.reasonMax) };
}
