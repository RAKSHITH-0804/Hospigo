/**
 * Every application connection to Postgres reads and writes times as UTC.
 *
 * Why: Prisma fills `@default(now())` columns in the app and sends the time to Postgres as plain
 * digits in UTC. Postgres reads digits without a label in the SESSION time zone. If the server is
 * set to another zone (a Windows dev machine in IST), a payment made at 07:33 UTC would be stored
 * as 07:33 IST = 02:03 UTC: 5 hours 30 minutes early. Pinning the session to UTC makes the digits
 * mean what they say. Screens and reports still show hospital time (IST): the hospital time zone
 * is a setting (`opd_settings.timezone`) applied when a moment is displayed or a day is cut.
 */
export const UTC_SESSION_OPTIONS = '-c timezone=UTC';

/** Pool settings for `new PrismaPg(...)`: the connection string plus the UTC session. */
export function appPoolConfig(connectionString: string): {
  connectionString: string;
  options: string;
} {
  return { connectionString, options: UTC_SESSION_OPTIONS };
}
