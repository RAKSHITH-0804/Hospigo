import { formatFinancialYear, padRunningNumber } from '../patients/uhid.util';
import type { UhidFyStyle } from '../../generated/prisma';

/**
 * Separate pure validate/render for number_series_settings.format JSONB.
 * Reuses formatFinancialYear + padRunningNumber from the UHID util; block shape
 * is intentionally smaller (no BRANCH_CODE / CALENDAR_YEAR).
 */

export type NumberSeriesBlock =
  | { type: 'FIXED'; text: string }
  | { type: 'SEPARATOR'; text: string }
  | { type: 'FINANCIAL_YEAR'; style: UhidFyStyle }
  | { type: 'RUNNING'; width: number };

export type NumberSeriesFormat = NumberSeriesBlock[];

export function validateNumberSeriesFormat(format: unknown): asserts format is NumberSeriesFormat {
  if (!Array.isArray(format) || format.length === 0) {
    throw new Error('number series format must be a non-empty array of blocks');
  }
  let running = 0;
  let fy = 0;
  for (const block of format) {
    if (!block || typeof block !== 'object' || !('type' in block)) {
      throw new Error('number series format block is invalid');
    }
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'FIXED':
      case 'SEPARATOR':
        if (typeof b.text !== 'string') {
          throw new Error(`${b.type} block requires text`);
        }
        break;
      case 'FINANCIAL_YEAR':
        if (b.style !== 'SHORT' && b.style !== 'LONG') {
          throw new Error('FINANCIAL_YEAR block requires style SHORT or LONG');
        }
        fy += 1;
        break;
      case 'RUNNING':
        if (typeof b.width !== 'number' || !Number.isInteger(b.width) || b.width < 1) {
          throw new Error('RUNNING block requires integer width >= 1');
        }
        running += 1;
        break;
      default:
        throw new Error(`Unknown number series block type: ${String(b.type)}`);
    }
  }
  if (running !== 1) {
    throw new Error(`number series format must have exactly one RUNNING block (found ${running})`);
  }
  if (fy < 1) {
    throw new Error('number series format requires at least one FINANCIAL_YEAR block');
  }
}

export function renderNumberSeriesFormat(
  format: NumberSeriesFormat,
  args: { financialYear: number; running: bigint },
): string {
  validateNumberSeriesFormat(format);
  let out = '';
  for (const block of format) {
    switch (block.type) {
      case 'FIXED':
      case 'SEPARATOR':
        out += block.text;
        break;
      case 'FINANCIAL_YEAR':
        out += formatFinancialYear(args.financialYear, block.style);
        break;
      case 'RUNNING':
        out += padRunningNumber(args.running, block.width);
        break;
      default: {
        const _x: never = block;
        throw new Error(`Unknown number series block: ${JSON.stringify(_x)}`);
      }
    }
  }
  return out;
}
