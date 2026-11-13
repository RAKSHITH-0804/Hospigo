/** Client-safe display mask only — never send to APIs or logs. */
export function maskPhoneForDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) {
    return '••••';
  }
  const last4 = digits.slice(-4);
  if (digits.length >= 10) {
    return `+91XXXXXX${last4}`;
  }
  return `••••${last4}`;
}
