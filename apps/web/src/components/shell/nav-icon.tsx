import type { LucideIcon } from 'lucide-react';
import {
  BedDouble,
  Building2,
  CalendarDays,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  Package,
  Pill,
  Settings,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  patients: Users,
  dashboard: LayoutDashboard,
  opd: ClipboardList,
  ipd: BedDouble,
  pharmacy: Pill,
  lab: FlaskConical,
  booking: CalendarDays,
  settings: Settings,
  hospitals: Building2,
  modules: Package,
  imports: Package,
  staff: Users,
  health: LayoutDashboard,
};

export function NavIcon({ name, className }: { name?: string; className?: string }) {
  const Icon = (name && ICONS[name]) || LayoutDashboard;
  return <Icon aria-hidden="true" className={cn('shell-nav-icon', className)} />;
}
