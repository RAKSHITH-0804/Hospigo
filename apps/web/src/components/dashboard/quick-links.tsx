import {
  ArrowRight,
  FileBarChart,
  ListChecks,
  ReceiptText,
  Search,
  Settings,
  Stethoscope,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { staffCopy } from '@/config/staff-copy';
import { hospitalHour } from '@/lib/format-datetime';

const copy = staffCopy.dashboard;

type QuickLink = { id: keyof typeof copy.links; href: string; permission: string };

/** Each place to go has its own icon and colour, so people find it by sight. */
const LOOK: Record<keyof typeof copy.links, { icon: LucideIcon; tone: string }> = {
  register: { icon: UserPlus, tone: 'tone-green' },
  patients: { icon: Search, tone: 'tone-blue' },
  queue: { icon: ListChecks, tone: 'tone-amber' },
  refunds: { icon: ReceiptText, tone: 'tone-rose' },
  tests: { icon: Stethoscope, tone: 'tone-violet' },
  report: { icon: FileBarChart, tone: 'tone-teal' },
  settings: { icon: Settings, tone: 'tone-sky' },
  profile: { icon: Stethoscope, tone: 'tone-orange' },
};

/** Everything a person can start from the dashboard, in this order. Each one needs its permission. */
const LINKS: readonly QuickLink[] = [
  { id: 'register', href: '/app/patients/new', permission: 'patients.registry.write' },
  { id: 'patients', href: '/app/patients', permission: 'patients.registry.read' },
  { id: 'queue', href: '/app/opd', permission: 'opd.queue.read' },
  { id: 'refunds', href: '/app/opd/refunds', permission: 'opd.refunds.approve' },
  { id: 'tests', href: '/app/opd/tests', permission: 'opd.investigations.bill' },
  { id: 'report', href: '/app/opd/reports', permission: 'opd.reports.read' },
  { id: 'settings', href: '/app/settings', permission: 'hospital.settings.read' },
  { id: 'profile', href: '/app/profile', permission: 'opd.doctors.own' },
];

/** The links the person may use (no sample numbers: only real places to go). */
export function quickLinksFor(permissions: readonly string[] | undefined): QuickLink[] {
  return LINKS.filter((l) => permissions?.includes(l.permission));
}

/** Good morning, afternoon or evening, by the hour in the hospital time zone. */
export function greetingFor(name: string, now: Date = new Date()): string {
  const hour = hospitalHour(now);
  const text =
    hour < 12 ? copy.greetingMorning : hour < 17 ? copy.greetingAfternoon : copy.greetingEvening;
  return text.replace('{name}', name);
}

export function QuickLinks({
  displayName,
  branchName,
  hospitalName,
  permissions,
}: {
  displayName: string;
  branchName: string;
  hospitalName: string;
  permissions: readonly string[] | undefined;
}) {
  const links = quickLinksFor(permissions);
  return (
    <section className="section-stack" aria-label={copy.title}>
      <div className="page-hero">
        <div className="flex flex-col gap-[var(--space-2)]">
          <h1>{greetingFor(displayName)}</h1>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            <span className="hero-chip">{branchName}</span>
            <span className="hero-chip">{hospitalName}</span>
          </div>
        </div>
      </div>
      {links.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.nothingYet}</p>
      ) : (
        <ul className="dashboard-links">
          {links.map((link) => (
            <li key={link.id}>
              <Link href={link.href} className={`dashboard-link ${LOOK[link.id].tone}`}>
                <span className="icon-tile icon-tile-solid">
                  {(() => {
                    const Icon = LOOK[link.id].icon;
                    return <Icon aria-hidden="true" />;
                  })()}
                </span>
                <span className="link-text">
                  <span className="type-body font-semibold text-foreground">
                    {copy.links[link.id].title}
                  </span>
                  <span className="type-label text-muted-foreground">
                    {copy.links[link.id].description}
                  </span>
                </span>
                <ArrowRight className="link-arrow size-5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
