'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import { createRole, roleAction, updateRole } from '@/lib/staff/client';
import { staffErrorMessage } from '@/lib/staff/errors';
import type {
  CatalogPermission,
  RoleTemplate,
  RoleView,
  RolesListResponse,
} from '@/lib/staff/types';

const copy = staffCopy.staffAdmin.roles;

type Flash = { kind: 'ok' | 'error'; text: string } | null;
type Draft = { name: string; description: string; codes: Set<string> };

const draftOf = (role: RoleView | null): Draft => ({
  name: role?.name ?? '',
  description: role?.description ?? '',
  codes: new Set(role?.permissionCodes ?? []),
});

/**
 * The roles of the hospital. A SuperAdmin makes and changes roles by ticking powers (permissions)
 * grouped by area, or by starting from a ready-made role. The two ready-made Admin roles are shown
 * but never edited. A role people still hold cannot be switched off. The API checks everything.
 */
export function RolesManager({
  initial,
  catalog,
  templates,
  initialErrorCode,
}: {
  initial: RolesListResponse | null;
  catalog: CatalogPermission[] | null;
  templates: RoleTemplate[];
  initialErrorCode: string | null;
}) {
  const canWrite = initial?.canWrite ?? false;
  const [roles, setRoles] = useState(initial?.items ?? []);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(draftOf(null));
  const [templateKey, setTemplateKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (flash?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setFlash(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [flash]);

  const groups = useMemo(() => {
    const out = new Map<string, CatalogPermission[]>();
    for (const p of catalog ?? []) {
      out.set(p.group, [...(out.get(p.group) ?? []), p]);
    }
    return [...out.entries()];
  }, [catalog]);

  if (!initial || !catalog) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }

  function open(role: RoleView | null) {
    const id = role?.id ?? 'new';
    if (editing === id) {
      setEditing(null);
      return;
    }
    setEditing(id);
    setDraft(draftOf(role));
    setTemplateKey('');
    setFlash(null);
  }

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const template = templates.find((t) => t.key === key);
    if (!template) {
      return;
    }
    setDraft((d) => ({
      ...d,
      name: d.name || template.name,
      description: d.description || template.description,
      codes: new Set(template.permissionCodes),
    }));
    setFlash({ kind: 'ok', text: copy.form.templateApplied.replace('{name}', template.name) });
  }

  function toggle(code: string) {
    setDraft((d) => {
      const codes = new Set(d.codes);
      if (codes.has(code)) {
        codes.delete(code);
      } else {
        codes.add(code);
      }
      return { ...d, codes };
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>, role: RoleView | null) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    if (draft.codes.size === 0) {
      setFlash({ kind: 'error', text: copy.form.powersNone });
      return;
    }
    busy.current = true;
    setSaving(true);
    setFlash(null);
    const body = {
      name: draft.name,
      description: draft.description,
      permissionCodes: [...draft.codes],
    };
    const result = role ? await updateRole(role.id, body) : await createRole(body);
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setFlash({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setRoles((rows) =>
      role ? rows.map((r) => (r.id === role.id ? result.data : r)) : [...rows, result.data],
    );
    setEditing(null);
    setFlash({ kind: 'ok', text: role ? copy.form.saved : copy.form.created });
  }

  async function toggleActive(role: RoleView) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setFlash(null);
    const result = await roleAction(role.id, role.isActive ? 'deactivate' : 'reactivate');
    busy.current = false;
    if (!result.ok) {
      setFlash({ kind: 'error', text: staffErrorMessage(result) });
      return;
    }
    setRoles((rows) => rows.map((r) => (r.id === role.id ? result.data : r)));
    setFlash({
      kind: 'ok',
      text: (role.isActive ? copy.actions.switchedOff : copy.actions.switchedOn).replace(
        '{name}',
        role.name,
      ),
    });
  }

  const form = (role: RoleView | null) => (
    <form
      onSubmit={(event) => void onSubmit(event, role)}
      noValidate
      className="settings-panel"
      aria-label={role ? copy.form.editTitle.replace('{name}', role.name) : copy.form.addTitle}
    >
      <p className="type-label-strong">
        {role ? copy.form.editTitle.replace('{name}', role.name) : copy.form.addTitle}
      </p>
      <fieldset disabled={saving} className="settings-part">
        <div className="settings-field-medium">
          <InputField
            label={copy.form.name}
            value={draft.name}
            autoComplete="off"
            onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
          />
        </div>
        <div className="settings-field-medium">
          <InputField
            label={copy.form.description}
            value={draft.description}
            autoComplete="off"
            onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
          />
        </div>
        <div className="settings-field-medium">
          <SelectField
            label={copy.form.template}
            value={templateKey}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="">{copy.form.templateNone}</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </SelectField>
        </div>
      </fieldset>
      <fieldset disabled={saving} className="flex flex-col gap-[var(--space-2)]">
        <legend className="type-label-strong">
          {copy.form.powersHeading}{' '}
          <span className="type-small text-muted-foreground">
            ({copy.form.selected.replace('{n}', String(draft.codes.size))})
          </span>
        </legend>
        <div className="staff-groups">
          {groups.map(([group, items]) => (
            <fieldset key={group} className="staff-group">
              <legend className="type-label-strong">{copy.groupNames[group] ?? group}</legend>
              {items.map((p) => (
                <label key={p.code} className="settings-check settings-check-inline">
                  <input
                    type="checkbox"
                    checked={draft.codes.has(p.code)}
                    onChange={() => toggle(p.code)}
                  />
                  <span className="type-label">{p.description}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </fieldset>
      <div className="settings-actions">
        <Button type="submit" disabled={saving} className="touch-target">
          {saving ? copy.form.saving : copy.form.save}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>
          {copy.done}
        </Button>
      </div>
    </form>
  );

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
      {canWrite ? (
        <div className="settings-actions">
          <Button type="button" className="touch-target" onClick={() => open(null)}>
            {copy.add}
          </Button>
        </div>
      ) : null}
      <p
        role={flash?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${flash?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {flash?.text ?? ''}
      </p>
      {editing === 'new' ? form(null) : null}
      {roles.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="staff-cards">
          {roles.map((role) => (
            <li
              key={role.id}
              className={`settings-doctor ${editing === role.id ? 'staff-open' : ''}`}
            >
              <div className="settings-doctor-head">
                <div className="settings-cell-name">
                  <span className="type-label-strong">{role.name}</span>
                  <span className="type-small text-muted-foreground">{role.description ?? ''}</span>
                </div>
                <div className="staff-tags">
                  {role.isSystem ? <Badge variant="info">{copy.readyMade}</Badge> : null}
                  {!role.isActive ? <Badge variant="neutral">{copy.switchedOff}</Badge> : null}
                </div>
              </div>
              <p className="type-small text-muted-foreground">
                {copy.powers.replace('{n}', String(role.permissionCodes.length))} ·{' '}
                {role.assignedCount > 0
                  ? copy.heldBy.replace('{n}', String(role.assignedCount))
                  : copy.heldByNone}
              </p>
              {role.isSystem ? (
                <p className="type-small text-muted-foreground">{copy.fixedNote}</p>
              ) : canWrite ? (
                <div className="staff-tags">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${role.name}: ${editing === role.id ? copy.done : copy.edit}`}
                    onClick={() => open(role)}
                  >
                    {editing === role.id ? copy.done : copy.edit}
                  </Button>
                  {role.isActive && role.assignedCount === 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${role.name}: ${copy.actions.switchOff}`}
                      onClick={() => void toggleActive(role)}
                    >
                      {copy.actions.switchOff}
                    </Button>
                  ) : null}
                  {!role.isActive ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${role.name}: ${copy.actions.switchOn}`}
                      onClick={() => void toggleActive(role)}
                    >
                      {copy.actions.switchOn}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {editing === role.id ? form(role) : null}
            </li>
          ))}
        </ul>
      )}
    </SettingBlock>
  );
}
