'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { createStaff, updateStaff } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { StaffBody, StaffMember, StaffOptions } from '@/lib/staff/types';

const copy = staffCopy.staffAdmin.staff.form;

type RoleChoice = { on: boolean; hospital: boolean };

/**
 * Add or change one staff member. The choices offered come from the API (only the roles and
 * branches the signed-in person may give), and the API checks them all again on save. A person
 * cannot change their own roles or branches, so for "you" those parts are shown but locked.
 */
export function StaffForm({
  options,
  member,
  onSaved,
  onCancel,
}: {
  options: StaffOptions;
  member: StaffMember | null;
  onSaved: (member: StaffMember, message: string) => void;
  onCancel: () => void;
}) {
  const locked = member?.isYou ?? false;
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [branchIds, setBranchIds] = useState<string[]>(member?.branches.map((b) => b.id) ?? []);
  const [roles, setRoles] = useState<Record<string, RoleChoice>>(() => {
    const out: Record<string, RoleChoice> = {};
    for (const r of member?.roles ?? []) {
      out[r.roleId] = { on: true, hospital: r.scope === 'HOSPITAL' };
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const limits = options.limits;
  const toggleBranch = (id: string) =>
    setBranchIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const setRole = (id: string, patch: Partial<RoleChoice>) =>
    setRoles((all) => ({ ...all, [id]: { on: false, hospital: false, ...all[id], ...patch } }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    const chosen = Object.entries(roles).filter(([, c]) => c.on);
    if (!locked && branchIds.length === 0) {
      setError(copy.needBranch);
      return;
    }
    if (!locked && chosen.length === 0) {
      setError(copy.needRole);
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    const contact = { name, email, phone };
    const body: StaffBody = {
      ...contact,
      branchIds,
      roles: chosen.map(([roleId, c]) => (c.hospital ? { roleId, scope: 'HOSPITAL' } : { roleId })),
    };
    if (!member) {
      const result = await createStaff(body);
      busy.current = false;
      setSaving(false);
      if (!result.ok) {
        setError(staffErrorMessage(result));
        return;
      }
      const { staff, activationSent } = result.data;
      onSaved(
        staff,
        activationSent ? copy.added.replace('{email}', staff.email) : copy.addedNoMail,
      );
      return;
    }
    const result = await updateStaff(member.id, locked ? contact : body);
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(staffErrorMessage(result));
      return;
    }
    onSaved(result.data, copy.saved);
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="settings-panel"
      aria-label={member ? copy.editTitle.replace('{name}', member.name) : copy.addTitle}
    >
      <p className="type-label-strong">
        {member ? copy.editTitle.replace('{name}', member.name) : copy.addTitle}
      </p>
      <fieldset disabled={saving} className="settings-part">
        <div className="settings-field-medium">
          <InputField
            label={copy.name}
            value={name}
            maxLength={limits.nameMax}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="settings-field-medium">
          <InputField
            label={copy.email}
            type="email"
            hint={member ? undefined : copy.emailHint}
            value={email}
            maxLength={limits.emailMax}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="settings-field-narrow">
          <InputField
            label={copy.phone}
            type="tel"
            value={phone}
            maxLength={limits.phoneMax}
            autoComplete="off"
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      </fieldset>
      {locked ? <p className="type-small text-muted-foreground">{copy.ownRolesNote}</p> : null}
      <fieldset disabled={saving || locked} className="flex flex-col gap-[var(--space-1)]">
        <legend className="type-label-strong">{copy.branches}</legend>
        <ul className="staff-choices">
          {options.branches.map((branch) => (
            <li key={branch.id}>
              <label className="settings-check settings-check-inline">
                <input
                  type="checkbox"
                  checked={branchIds.includes(branch.id)}
                  onChange={() => toggleBranch(branch.id)}
                />
                <span className="type-label">{branch.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset disabled={saving || locked} className="flex flex-col gap-[var(--space-1)]">
        <legend className="type-label-strong">{copy.roles}</legend>
        <p className="type-small text-muted-foreground">{copy.rolesHint}</p>
        <ul className="staff-choices">
          {options.roles.map((role) => {
            const choice = roles[role.id];
            const held = choice?.on ?? false;
            const blocked = !role.assignable && !held;
            return (
              <li key={role.id} className="staff-choice">
                <label className="settings-check settings-check-inline">
                  <input
                    type="checkbox"
                    checked={held}
                    disabled={blocked}
                    onChange={(event) => setRole(role.id, { on: event.target.checked })}
                  />
                  <span className="type-label" title={role.description ?? undefined}>
                    {role.name}
                  </span>
                </label>
                {blocked && role.reason ? (
                  <span className="type-small text-muted-foreground">
                    {copy.notAllowed[role.reason]}
                  </span>
                ) : null}
                {held && options.canHospitalScope && !role.isSystem ? (
                  <label className="settings-check settings-check-inline">
                    <input
                      type="checkbox"
                      checked={choice?.hospital ?? false}
                      onChange={(event) => setRole(role.id, { hospital: event.target.checked })}
                    />
                    <span className="type-small" title={copy.wholeHospitalHint}>
                      {copy.wholeHospital}
                    </span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <p
        role="alert"
        className="settings-flash settings-flash-lazy type-label text-destructive"
        hidden={!error}
      >
        {error ?? ''}
      </p>
      <div className="settings-actions">
        <Button type="submit" disabled={saving} className="touch-target">
          {saving ? copy.saving : member ? copy.save : copy.addSubmit}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {staffCopy.staffAdmin.staff.done}
        </Button>
      </div>
    </form>
  );
}
