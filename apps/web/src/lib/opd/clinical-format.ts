export { formatClock, formatDateTime } from '@/lib/format-datetime';

/** Fills {name} placeholders of a copy sentence. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
