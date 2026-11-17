import { MapPin } from 'lucide-react';
import { staffCopy } from '@/config/staff-copy';

/** Read-only active branch label for everyone except hospital-wide users (see BranchSwitcher). */
export function BranchChip({ name }: { name: string }) {
  return (
    <span className="shell-branch-chip" aria-label={staffCopy.shell.branchChipAria} title={name}>
      <MapPin aria-hidden="true" className="shell-branch-chip-icon" />
      <span className="shell-branch-chip-text">{name}</span>
    </span>
  );
}
