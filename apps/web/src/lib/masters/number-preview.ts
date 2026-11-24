/**
 * What the next number of a series will look like, worked out on the screen so the person sees it
 * while typing. The server does the real numbering with the same rules: prefix, financial year,
 * separator, then the running number with zeros in front.
 */
export function financialYearStart(today: string, fyStartMonth: number): number {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return month >= fyStartMonth ? year : year - 1;
}

export function financialYearLabel(start: number, style: 'SHORT' | 'LONG'): string {
  const end = start + 1;
  return style === 'LONG'
    ? `${start}-${String(end).slice(-2)}`
    : `${String(start).slice(-2)}${String(end).slice(-2)}`;
}

export function previewNumber(args: {
  prefix: string;
  fyStyle: 'SHORT' | 'LONG';
  separator: string;
  width: number;
  today: string;
  fyStartMonth: number;
  running: bigint;
}): string {
  const fy = financialYearLabel(financialYearStart(args.today, args.fyStartMonth), args.fyStyle);
  return `${args.prefix}${fy}${args.separator}${args.running.toString().padStart(args.width, '0')}`;
}
