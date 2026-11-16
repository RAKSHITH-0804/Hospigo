import { MapPin } from 'lucide-react';
import { staffCopy } from '@/config/staff-copy';

/** Read-only active branch label — never a control (no switcher in this step). */
export function BranchChip({ name }: { name: string }) {
  return (
    <span className="shell-branch-chip" aria-label={staffCopy.shell.branchChipAria} title={name}>
      <MapPin aria-hidden="true" className="shell-branch-chip-icon" />
      <span className="shell-branch-chip-text">{name}</span>
    </span>
  );
}
