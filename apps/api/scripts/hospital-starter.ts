/**
 * Starter script for ONE existing hospital (Step 8b, part A).
 *
 *   npm run hospital:starter -w @hospigo/api -- --hospital CODE --dry-run
 *   npm run hospital:starter -w @hospigo/api -- --hospital CODE
 *
 * Creates the standard payment modes, vitals fields, number series, OPD rules, the Registration
 * charge item (without a price), patient registration fields and a default UHID format, only where
 * they are missing. No demo data. Run with the owner login. Never prints a password or a URL.
 * Options: see --help. Guide: docs/guides/new-hospital-runbook.md
 */
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import {
  StarterError,
  defaultStarterOptions,
  runHospitalStarter,
  type StarterOptions,
} from '../src/database/hospital-starter/hospital-starter';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const HELP = `Usage: hospital:starter --hospital CODE [--dry-run] [options]

  --hospital CODE        the hospital code (required)
  --dry-run              print what would be created, change nothing

Number series BILL, RECEIPT, REFUND (default: FY short, "/", 5 digits, e.g. 2627/00001):
  --fy-style SHORT|LONG  financial year style (default SHORT)
  --separator TEXT       text between the year and the number (default "/", empty allowed)
  --width N              running number width, 1 to 12 (default 5)
  --reset RULE           FINANCIAL_YEAR (default) or NEVER
  --fy-start-month N     1 to 12 (default 4)
  --prefix-bill TEXT, --prefix-receipt TEXT, --prefix-refund TEXT   fixed text before the year

Patient number (UHID) format:
  --uhid-prefix TEXT     fixed text before the number (default none)
  --uhid-width N         running number width (default 5)
  --uhid-reset RULE      FINANCIAL_YEAR (default) or NEVER
`;

function parseArgs(argv: string[]): StarterOptions | null {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      return null;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new StarterError(`Unexpected argument: ${arg}`);
    }
    const next = argv[i + 1];
    if (next === undefined) {
      throw new StarterError(`${arg} needs a value`);
    }
    values.set(arg, next);
    i += 1;
  }
  const known = new Set([
    '--hospital',
    '--fy-style',
    '--separator',
    '--width',
    '--reset',
    '--fy-start-month',
    '--prefix-bill',
    '--prefix-receipt',
    '--prefix-refund',
    '--uhid-prefix',
    '--uhid-width',
    '--uhid-reset',
  ]);
  for (const key of values.keys()) {
    if (!known.has(key)) {
      throw new StarterError(`Unknown option: ${key}`);
    }
  }
  const code = values.get('--hospital');
  if (!code) {
    throw new StarterError('--hospital CODE is required');
  }
  const o = defaultStarterOptions(code);
  o.dryRun = dryRun;
  const num = (key: string, fallback: number): number => {
    const v = values.get(key);
    return v === undefined ? fallback : Number(v);
  };
  if (values.has('--fy-style')) o.fyStyle = values.get('--fy-style') as StarterOptions['fyStyle'];
  if (values.has('--separator')) o.separator = values.get('--separator')!;
  o.width = num('--width', o.width);
  if (values.has('--reset')) o.resetRule = values.get('--reset') as StarterOptions['resetRule'];
  o.fyStartMonth = num('--fy-start-month', o.fyStartMonth);
  for (const [flag, kind] of [
    ['--prefix-bill', 'BILL'],
    ['--prefix-receipt', 'RECEIPT'],
    ['--prefix-refund', 'REFUND'],
  ] as const) {
    if (values.has(flag)) o.seriesPrefix[kind] = values.get(flag)!;
  }
  if (values.has('--uhid-prefix')) o.uhid.prefix = values.get('--uhid-prefix')!;
  o.uhid.width = num('--uhid-width', o.uhid.width);
  if (values.has('--uhid-reset')) {
    o.uhid.resetRule = values.get('--uhid-reset') as StarterOptions['uhid']['resetRule'];
  }
  return o;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(HELP);
    return;
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    throw new StarterError('DATABASE_URL_OWNER is not set in .env');
  }
  // Show WHICH database is used (the name only, never the address or the password).
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    console.log(
      `${options.dryRun ? 'DRY RUN (nothing is changed)' : 'Running'} for hospital ${options.hospitalCode} on database ${databaseName}`,
    );
    const report = await runHospitalStarter(prisma, options);
    const verb = options.dryRun ? 'Would create' : 'Created';
    for (const line of report.created) console.log(`  ${verb}: ${line}`);
    for (const line of report.kept) console.log(`  Already there: ${line}`);
    for (const line of report.warnings) console.log(`  WARNING: ${line}`);
    console.log(
      report.created.length === 0
        ? 'Nothing to do: the hospital already has the starter data.'
        : options.dryRun
          ? 'Dry run finished. Run again without --dry-run to apply.'
          : 'Done. Next: set the registration price and each doctor fee (Settings, OPD, Prices).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(error instanceof StarterError ? 2 : 1);
});
