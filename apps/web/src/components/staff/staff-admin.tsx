'use client';

import { useEffect, useRef, useState } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { StaffForm } from '@/components/staff/staff-form';
import { Modal } from '@/components/ui/modal';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { Pagination } from '@/components/ui/pagination';
import { settingsScreenConfig, staffScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { formatDateTimeLong } from '@/lib/format-datetime';
import { errorMessageFor } from '@/lib/patients/client';
import { listStaff, staffAction, type StaffAction } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type { StaffListResponse, StaffMember, StaffOptions, StaffStatus } from '@/lib/staff/types';

const copy = staffCopy.staffAdmin.staff;
const BADGE: Record<StaffStatus, BadgeVariant> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  INACTIVE: 'neutral',
};

type Flash = { kind: 'ok' | 'error'; text: string } | null;

/**
 * The staff of the hospital: search, filter, add, change, switch off and on, and send the
 * activation email again. The API decides who sees whom and who may change whom (a Branch Admin
 * only reaches people of their own branches); this screen only shows what the API allows.
 */
export function StaffAdmin({
  initial,
  options,
  initialErrorCode,
}: {
  initial: StaffListResponse | null;
  options: StaffOptions | null;
  initialErrorCode: string | null;
}) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const busy = useRef(false);
  const first = useRef(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  // "Saved." fades away by itself; an error stays until the next action.
  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  // Search and filters ask the API again (after a short pause while typing).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void listStaff({ q: q.trim(), status, page }).then((result) => {
          if (!live) {
            return;
          }
          setLoading(false);
          if (result.ok) {
            setData(result.data);
          } else {
            setFlash({ kind: 'error', text: staffErrorMessage(result) });
          }
        });
      },
      page === 1 ? staffScreenConfig.searchDebounceMs : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, status, page]);

  if (!data || !options) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }

  const canWrite = options.canWrite;
  const totalPages = Math.max(Math.ceil(data.total / data.pageSize), 1);

  function replaceMember(member: StaffMember) {
    setData((d) =>
      d ? { ...d, items: d.items.map((m) => (m.id === member.id ? member : m)) } : d,
    );
  }

  async function run(member: StaffMember, action: StaffAction) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setWorkingId(member.id);
    setFlash(null);
    const result = await staffAction(member.id, action);
    busy.current = false;
    setWorkingId(null);
    setConfirmOff(null);
    if (!result.ok) {
      setFlash({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    if (action === 'reset-password') {
      setFlash({ kind: 'ok', text: copy.actions.resetSent.replace('{email}', member.email) });
      return;
    }
    if (action === 'resend-invite') {
      const sent = (result.data as { activationSent?: boolean }).activationSent !== false;
      setFlash(
        sent
          ? { kind: 'ok', text: copy.actions.resent.replace('{email}', member.email) }
          : { kind: 'error', text: copy.actions.resentFailed },
      );
      return;
    }
    replaceMember(result.data as StaffMember);
    setFlash({
      kind: 'ok',
      text: (action === 'deactivate' ? copy.actions.switchedOff : copy.actions.switchedOn).replace(
        '{name}',
        member.name,
      ),
    });
  }

  function onSaved(member: StaffMember, message: string) {
    setEditing(null);
    setFlash({ kind: 'ok', text: message });
    setData((d) => {
      if (!d) {
        return d;
      }
      return d.items.some((m) => m.id === member.id)
        ? { ...d, items: d.items.map((m) => (m.id === member.id ? member : m)) }
        : { ...d, items: [member, ...d.items], total: d.total + 1 };
    });
  }

  const roleText = (member: StaffMember) =>
    member.roles
      .map((r) => (r.scope === 'HOSPITAL' ? `${r.name} (${copy.wholeHospitalTag})` : r.name))
      .join(', ') || copy.notSet;

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
      <div className="staff-toolbar">
        <div className="staff-toolbar-grow">
          <InputField
            label={copy.searchLabel}
            type="search"
            value={q}
            placeholder={copy.searchPlaceholder}
            maxLength={staffScreenConfig.searchMax}
            autoComplete="off"
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <SelectField
          label={copy.statusLabel}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value="">{copy.statusAll}</option>
          {(['ACTIVE', 'INVITED', 'INACTIVE'] as const).map((s) => (
            <option key={s} value={s}>
              {copy.statuses[s]}
            </option>
          ))}
        </SelectField>
        {canWrite ? (
          <Button type="button" className="touch-target" onClick={() => setEditing('new')}>
            {copy.add}
          </Button>
        ) : null}
      </div>
      <p
        role={flash?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {flash?.text ?? (loading ? copy.searching : '')}
      </p>
      {data.items.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="staff-cards" aria-busy={loading}>
          {data.items.map((member) => {
            const open = editing === member.id;
            const asking = confirmOff === member.id;
            return (
              <li
                key={member.id}
                className={`settings-doctor ${open || asking ? 'staff-open' : ''}`}
              >
                <div className="settings-doctor-head">
                  <div className="settings-cell-name">
                    <span className="type-label-strong">
                      {member.name}
                      {member.isYou ? ` (${copy.youTag})` : ''}
                    </span>
                    <span className="type-small text-muted-foreground">
                      {member.code}
                      {member.doctorCode
                        ? ` · ${copy.doctorTag.replace('{code}', member.doctorCode)}`
                        : ''}
                    </span>
                  </div>
                  <Badge variant={BADGE[member.status]}>{copy.statuses[member.status]}</Badge>
                </div>
                <dl className="settings-doctor-details">
                  <div>
                    <dt className="type-small text-muted-foreground">{copy.columnEmail}</dt>
                    <dd className="type-label break-all">{member.email}</dd>
                  </div>
                  <div>
                    <dt className="type-small text-muted-foreground">{copy.columnPhone}</dt>
                    <dd className="type-label">{member.phone ?? copy.notSet}</dd>
                  </div>
                  <div>
                    <dt className="type-small text-muted-foreground">{copy.columnBranches}</dt>
                    <dd className="type-label">
                      {member.branches.map((b) => b.name).join(', ') || copy.notSet}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-small text-muted-foreground">{copy.columnRoles}</dt>
                    <dd className="type-label">{roleText(member)}</dd>
                  </div>
                  <div>
                    <dt className="type-small text-muted-foreground">{copy.columnLastLogin}</dt>
                    <dd className="type-label">
                      {member.lastLoginAt
                        ? formatDateTimeLong(member.lastLoginAt)
                        : copy.neverSignedIn}
                    </dd>
                  </div>
                </dl>
                {canWrite && member.editable ? (
                  <div className="staff-tags">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${member.name}: ${copy.edit}`}
                      onClick={() => setEditing(member.id)}
                    >
                      {copy.edit}
                    </Button>
                    {member.status === 'INVITED' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={workingId === member.id}
                        aria-label={`${member.name}: ${copy.actions.resend}`}
                        onClick={() => void run(member, 'resend-invite')}
                      >
                        {copy.actions.resend}
                      </Button>
                    ) : null}
                    {member.status === 'ACTIVE' && !member.isYou ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={workingId === member.id}
                        aria-label={`${member.name}: ${copy.actions.resetPassword}`}
                        onClick={() => void run(member, 'reset-password')}
                      >
                        {copy.actions.resetPassword}
                      </Button>
                    ) : null}
                    {member.status === 'INACTIVE' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={workingId === member.id}
                        aria-label={`${member.name}: ${copy.actions.switchOn}`}
                        onClick={() => void run(member, 'reactivate')}
                      >
                        {copy.actions.switchOn}
                      </Button>
                    ) : !member.isYou && !asking ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`${member.name}: ${copy.actions.switchOff}`}
                        onClick={() => setConfirmOff(member.id)}
                      >
                        {copy.actions.switchOff}
                      </Button>
                    ) : null}
                  </div>
                ) : canWrite ? (
                  <p className="type-small text-muted-foreground">{copy.notEditable}</p>
                ) : null}
                {asking ? (
                  <div
                    className="settings-panel"
                    role="alertdialog"
                    aria-label={copy.actions.confirmOff.replace('{name}', member.name)}
                  >
                    <p className="type-label">
                      {copy.actions.confirmOff.replace('{name}', member.name)}
                    </p>
                    <div className="settings-actions">
                      <Button
                        type="button"
                        size="sm"
                        disabled={workingId === member.id}
                        onClick={() => void run(member, 'deactivate')}
                      >
                        {copy.actions.confirmYes}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmOff(null)}
                      >
                        {copy.actions.confirmNo}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing ? (
        <Modal
          title={
            editing === 'new'
              ? copy.form.addTitle
              : copy.form.editTitle.replace(
                  '{name}',
                  data.items.find((m) => m.id === editing)?.name ?? '',
                )
          }
          onClose={() => setEditing(null)}
        >
          <StaffForm
            key={editing}
            options={options}
            member={editing === 'new' ? null : (data.items.find((m) => m.id === editing) ?? null)}
            onSaved={onSaved}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      ) : null}
      <Pagination
        page={data.page}
        totalPages={totalPages}
        total={data.total}
        previousLabel={staffCopy.pagination.previous}
        nextLabel={staffCopy.pagination.next}
        pageOfLabel={staffCopy.pagination.pageOf}
        totalLabel={staffCopy.pagination.total}
        onPrevious={() => setPage((p) => Math.max(p - 1, 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </SettingBlock>
  );
}
