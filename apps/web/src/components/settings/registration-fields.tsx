'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField, SelectField, TextareaField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor, type PatientsApiResult } from '@/lib/patients/client';
import {
  addReferenceSet,
  createCustomField,
  loadPatientFields,
  saveBuiltinField,
  saveCustomOptions,
  updateCustomField,
} from '@/lib/settings/client';
import { settingsErrorMessage } from '@/lib/settings/errors';
import {
  CUSTOM_DATA_TYPES,
  FIELD_SECTIONS,
  type BuiltinField,
  type CustomDataType,
  type CustomField,
  type FieldSection,
  type PatientFieldsResponse,
} from '@/lib/settings/types';

const copy = staffCopy.settings.patientFields;

type Choice = { id?: string; label: string; isActive: boolean };
type Where = 'builtin' | 'custom';

/**
 * Registration fields: two blocks side by side (standard fields, the hospital's own fields) whose
 * tables share one header, so the columns line up. Every change is saved at once by the API, which
 * refuses anything wrong; nothing is ever deleted, so saved answers stay.
 */
export function RegistrationFields({
  initial,
  initialErrorCode,
  canWrite,
}: {
  initial: PatientFieldsResponse | null;
  initialErrorCode: string | null;
  canWrite: boolean;
}) {
  const [builtin, setBuiltin] = useState<BuiltinField[]>(initial?.builtin ?? []);
  const [custom, setCustom] = useState<CustomField[]>(initial?.custom ?? []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
    where: Where;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const lock = useRef(false);

  // "Saved." fades away by itself; an error stays until the next action.
  useEffect(() => {
    if (message?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setMessage(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [message]);

  if (!initial) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(initialErrorCode ?? 'UNKNOWN')}
        </p>
      </SettingBlock>
    );
  }
  const { limits } = initial;

  /** One change at a time: the answer replaces the row, a refusal shows its reason. */
  async function run<T>(
    where: Where,
    call: () => Promise<PatientsApiResult<T>>,
    apply: (data: T) => void,
  ): Promise<boolean> {
    if (lock.current) {
      return false;
    }
    lock.current = true;
    setBusy(true);
    setMessage(null);
    const result = await call();
    lock.current = false;
    setBusy(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: settingsErrorMessage(result), where });
      return false;
    }
    apply(result.data);
    setMessage({ kind: 'ok', text: copy.saved, where });
    return true;
  }

  /** The ready-made reference fields: added in one click, nothing that exists is changed. */
  async function addReferenceFields() {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage(null);
    const added = await addReferenceSet();
    if (!added.ok) {
      lock.current = false;
      setBusy(false);
      setMessage({ kind: 'error', text: settingsErrorMessage(added), where: 'custom' });
      return;
    }
    const fresh = await loadPatientFields();
    lock.current = false;
    setBusy(false);
    if (fresh.ok) {
      setBuiltin(fresh.data.builtin);
      setCustom(fresh.data.custom);
    }
    const parts = [
      added.data.created.length > 0
        ? copy.referenceAdded.replace('{names}', added.data.created.join(', '))
        : copy.referenceNothingNew,
      added.data.skipped.length > 0
        ? copy.referenceSkipped.replace('{names}', added.data.skipped.join(', '))
        : '',
    ];
    setMessage({ kind: 'ok', text: parts.filter(Boolean).join(' '), where: 'custom' });
  }

  const replaceBuiltin = (row: BuiltinField) =>
    setBuiltin((rows) => rows.map((r) => (r.key === row.key ? row : r)));
  const replaceCustom = (row: CustomField) =>
    setCustom((rows) => rows.map((r) => (r.id === row.id ? row : r)));
  /** The confirmation line sits under the block title and keeps its height, so nothing jumps. */
  const flash = (where: Where) => {
    const mine = message?.where === where ? message : null;
    return (
      <p
        role={mine?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash type-label ${mine?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {mine?.text ?? ''}
      </p>
    );
  };

  return (
    <div className="settings-columns">
      <SettingBlock title={copy.builtinHeading} description={copy.description}>
        {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
        {flash('builtin')}
        <div className="settings-table" role="table" aria-label={copy.builtinHeading}>
          <FieldsHead />
          {builtin.map((field) => {
            const locked = field.alwaysRequired;
            return (
              <div className="settings-row" role="row" key={field.key}>
                <span role="cell" className="settings-cell-name">
                  <span className="type-label-strong">{field.label}</span>
                  <span className="type-small text-muted-foreground">
                    {copy.sections[field.section] ?? field.section}
                    {locked
                      ? ` · ${copy.alwaysOn}`
                      : !field.canDisable
                        ? ` · ${copy.cannotSwitchOff}`
                        : ''}
                  </span>
                </span>
                <label className="settings-check" role="cell">
                  <input
                    type="checkbox"
                    aria-label={`${field.label}: ${copy.columnShow}`}
                    checked={field.isEnabled}
                    disabled={!canWrite || busy || locked || !field.canDisable}
                    onChange={(event) =>
                      void run(
                        'builtin',
                        () => saveBuiltinField(field.key, { isEnabled: event.target.checked }),
                        replaceBuiltin,
                      )
                    }
                  />
                </label>
                <label
                  className="settings-check"
                  role="cell"
                  title={!field.isEnabled ? copy.requiredOffHint : undefined}
                >
                  <input
                    type="checkbox"
                    aria-label={`${field.label}: ${copy.columnRequired}`}
                    checked={field.isRequired}
                    disabled={!canWrite || busy || locked || !field.isEnabled}
                    onChange={(event) =>
                      void run(
                        'builtin',
                        () => saveBuiltinField(field.key, { isRequired: event.target.checked }),
                        replaceBuiltin,
                      )
                    }
                  />
                </label>
                <span role="cell" />
              </div>
            );
          })}
        </div>
        <p className="type-small text-muted-foreground">{copy.tableNote}</p>
      </SettingBlock>

      <SettingBlock title={copy.customHeading} description={copy.customDescription}>
        {flash('custom')}
        {custom.length === 0 ? (
          <p className="type-label text-muted-foreground">{copy.customEmpty}</p>
        ) : (
          <div className="settings-table" role="table" aria-label={copy.customHeading}>
            <FieldsHead />
            {custom.map((field) => (
              <div key={field.id}>
                <div className="settings-row" role="row">
                  <span role="cell" className="settings-cell-name">
                    <span className="type-label-strong">{field.label}</span>
                    <span className="type-small text-muted-foreground">
                      {copy.sections[field.section] ?? field.section} · {copy.types[field.dataType]}
                      {!field.isEnabled ? ` · ${copy.hiddenTag}` : ''}
                    </span>
                  </span>
                  <label className="settings-check" role="cell">
                    <input
                      type="checkbox"
                      aria-label={`${field.label}: ${copy.columnShow}`}
                      checked={field.isEnabled}
                      disabled={!canWrite || busy}
                      onChange={(event) =>
                        void run(
                          'custom',
                          () => updateCustomField(field.id, { isEnabled: event.target.checked }),
                          replaceCustom,
                        )
                      }
                    />
                  </label>
                  <label
                    className="settings-check"
                    role="cell"
                    title={!field.isEnabled ? copy.requiredOffHint : undefined}
                  >
                    <input
                      type="checkbox"
                      aria-label={`${field.label}: ${copy.columnRequired}`}
                      checked={field.isRequired}
                      disabled={!canWrite || busy || !field.isEnabled}
                      onChange={(event) =>
                        void run(
                          'custom',
                          () => updateCustomField(field.id, { isRequired: event.target.checked }),
                          replaceCustom,
                        )
                      }
                    />
                  </label>
                  <span role="cell">
                    {canWrite ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`${field.label}: ${editingId === field.id ? copy.done : copy.edit}`}
                        onClick={() => setEditingId(editingId === field.id ? null : field.id)}
                      >
                        {editingId === field.id ? copy.done : copy.edit}
                      </Button>
                    ) : null}
                  </span>
                </div>
                {editingId === field.id ? (
                  <CustomEditor
                    field={field}
                    busy={busy}
                    limits={limits}
                    onRename={(label, section) =>
                      run(
                        'custom',
                        () => updateCustomField(field.id, { label, section }),
                        replaceCustom,
                      )
                    }
                    onChoices={(choices) =>
                      run('custom', () => saveCustomOptions(field.id, choices), replaceCustom)
                    }
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}

        {canWrite ? (
          custom.length >= limits.maxCustomFields ? (
            <p className="type-label text-muted-foreground">
              {copy.limitReached.replace('{max}', String(limits.maxCustomFields))}
            </p>
          ) : adding ? (
            <AddField
              busy={busy}
              limits={limits}
              onCancel={() => setAdding(false)}
              onAdd={async (body) => {
                const ok = await run(
                  'custom',
                  () => createCustomField(body),
                  (row) => setCustom((rows) => [...rows, row]),
                );
                if (ok) {
                  setAdding(false);
                }
                return ok;
              }}
            />
          ) : (
            <div className="settings-actions">
              <Button type="button" variant="outline" onClick={() => setAdding(true)}>
                {copy.addButton}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                title={copy.referenceHint}
                onClick={() => void addReferenceFields()}
              >
                {copy.referenceButton}
              </Button>
              <span className="type-small text-muted-foreground">
                {copy.limitNote.replace('{max}', String(limits.maxCustomFields))}
              </span>
            </div>
          )
        ) : null}
      </SettingBlock>
    </div>
  );
}

/** The header row both tables share, so their columns line up. */
function FieldsHead() {
  return (
    <div className="settings-row settings-row-head" role="row">
      <span role="columnheader" className="type-small">
        {copy.columnField}
      </span>
      <span role="columnheader" className="type-small" title={copy.columnShowHint}>
        {copy.columnShow}
      </span>
      <span role="columnheader" className="type-small" title={copy.columnRequiredHint}>
        {copy.columnRequired}
      </span>
      <span role="columnheader" aria-hidden="true" />
    </div>
  );
}

function SectionSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FieldSection;
  onChange: (v: FieldSection) => void;
}) {
  return (
    <SelectField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as FieldSection)}
    >
      {FIELD_SECTIONS.map((s) => (
        <option key={s} value={s}>
          {copy.sections[s]}
        </option>
      ))}
    </SelectField>
  );
}

/** The form that adds a field of the hospital. */
function AddField({
  busy,
  limits,
  onAdd,
  onCancel,
}: {
  busy: boolean;
  limits: PatientFieldsResponse['limits'];
  onCancel: () => void;
  onAdd: (body: {
    label: string;
    dataType: CustomDataType;
    section: FieldSection;
    isRequired: boolean;
    options?: string[];
  }) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('');
  const [dataType, setDataType] = useState<CustomDataType>('TEXT');
  const [section, setSection] = useState<FieldSection>('OTHER');
  const [required, setRequired] = useState(false);
  const [choices, setChoices] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = choices
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const ok = await onAdd({
      label,
      dataType,
      section,
      isRequired: required,
      ...(dataType === 'DROPDOWN' ? { options } : {}),
    });
    if (ok) {
      setLabel('');
      setChoices('');
      setRequired(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="settings-panel">
      <h3 className="type-label-strong">{copy.addHeading}</h3>
      <fieldset disabled={busy} className="settings-part">
        <div className="settings-field-medium">
          <InputField
            label={copy.labelLabel}
            value={label}
            maxLength={limits.labelMax}
            autoComplete="off"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="settings-field-narrow">
          <SelectField
            label={copy.typeLabel}
            value={dataType}
            onChange={(event) => setDataType(event.target.value as CustomDataType)}
          >
            {CUSTOM_DATA_TYPES.map((t) => (
              <option key={t} value={t}>
                {copy.types[t]}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="settings-field-narrow">
          <SectionSelect label={copy.sectionLabel} value={section} onChange={setSection} />
        </div>
        <label className="settings-check settings-check-inline">
          <input
            type="checkbox"
            checked={required}
            onChange={(event) => setRequired(event.target.checked)}
          />
          {copy.requiredLabel}
        </label>
      </fieldset>
      {dataType === 'DROPDOWN' ? (
        <TextareaField
          label={copy.choicesLabel}
          value={choices}
          rows={4}
          onChange={(event) => setChoices(event.target.value)}
        />
      ) : null}
      <div className="settings-actions">
        <Button type="submit" disabled={busy} className="touch-target">
          {busy ? copy.adding : copy.add}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {copy.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Rename and move a custom field, and edit the choices of a dropdown. The type never changes. */
function CustomEditor({
  field,
  busy,
  limits,
  onRename,
  onChoices,
}: {
  field: CustomField;
  busy: boolean;
  limits: PatientFieldsResponse['limits'];
  onRename: (label: string, section: FieldSection) => Promise<boolean>;
  onChoices: (choices: Choice[]) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(field.label);
  const [section, setSection] = useState<FieldSection>(field.section);
  const [choices, setChoices] = useState<Choice[]>(
    field.options.map((o) => ({ id: o.id, label: o.label, isActive: o.isActive })),
  );
  const setChoice = (index: number, patch: Partial<Choice>) =>
    setChoices((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const move = (index: number, by: -1 | 1) =>
    setChoices((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) {
        return list;
      }
      const next = [...list];
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });

  return (
    <div className="settings-panel">
      <fieldset disabled={busy} className="settings-part">
        <div className="settings-field-medium">
          <InputField
            label={copy.labelLabel}
            value={label}
            maxLength={limits.labelMax}
            autoComplete="off"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="settings-field-narrow">
          <SectionSelect label={copy.sectionLabel} value={section} onChange={setSection} />
        </div>
        <Button type="button" onClick={() => void onRename(label, section)}>
          {copy.renameSave}
        </Button>
      </fieldset>
      <p className="type-small text-muted-foreground">{copy.typeFixed}</p>

      {field.dataType === 'DROPDOWN' ? (
        <fieldset disabled={busy} className="section-stack">
          <p className="type-label-strong">{copy.choicesHeading}</p>
          {choices.map((choice, index) => (
            <div key={choice.id ?? `new-${index}`} className="settings-part">
              <div className="settings-field-medium">
                <InputField
                  label={copy.choiceAria.replace('{n}', String(index + 1))}
                  value={choice.label}
                  maxLength={limits.labelMax}
                  autoComplete="off"
                  onChange={(event) => setChoice(index, { label: event.target.value })}
                />
              </div>
              <label className="settings-check settings-check-inline">
                <input
                  type="checkbox"
                  aria-label={`${copy.choiceAria.replace('{n}', String(index + 1))}: ${copy.choiceShow}`}
                  checked={choice.isActive}
                  onChange={(event) => setChoice(index, { isActive: event.target.checked })}
                />
                {copy.choiceShow}
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                {copy.moveUp}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={index === choices.length - 1}
                onClick={() => move(index, 1)}
              >
                {copy.moveDown}
              </Button>
            </div>
          ))}
          <div className="settings-actions">
            <Button
              type="button"
              variant="outline"
              disabled={choices.length >= limits.maxOptions}
              onClick={() => setChoices((list) => [...list, { label: '', isActive: true }])}
            >
              {copy.addChoice}
            </Button>
            <Button type="button" onClick={() => void onChoices(choices)}>
              {copy.saveChoices}
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
