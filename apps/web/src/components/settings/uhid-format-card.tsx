'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import { saveUhidFormat } from '@/lib/settings/client';
import { settingsErrorMessage } from '@/lib/settings/errors';
import {
  UHID_BLOCK_TYPES,
  type UhidBlock,
  type UhidBlockType,
  type UhidFormat,
  type UhidFormatResponse,
} from '@/lib/settings/types';
import { previewUhid } from '@/lib/settings/uhid-preview';

const copy = staffCopy.settings.uhidFormat;
const TEXT_TYPES: readonly UhidBlockType[] = ['FIXED_TEXT', 'SEPARATOR'];
const ONCE_ONLY: readonly UhidBlockType[] = [
  'BRANCH_CODE',
  'FINANCIAL_YEAR',
  'CALENDAR_YEAR',
  'RUNNING_NUMBER',
];

/** A new part of the given type with the settings that type needs and nothing else. */
function freshBlock(type: UhidBlockType, minWidth: number): UhidBlock {
  return {
    blockType: type,
    textValue: type === 'SEPARATOR' ? '-' : TEXT_TYPES.includes(type) ? '' : null,
    fyStyle: type === 'FINANCIAL_YEAR' ? 'SHORT' : null,
    minWidth: type === 'RUNNING_NUMBER' ? minWidth : null,
  };
}

/** The starting design when no format exists yet: letters, a dash and a running number. */
function startingFormat(info: UhidFormatResponse): UhidFormat {
  return {
    resetRule: 'NEVER',
    fyStartMonth: info.limits.fyStartMonthDefault,
    blocks: [
      { ...freshBlock('FIXED_TEXT', info.limits.minWidthMin), textValue: '' },
      freshBlock('SEPARATOR', info.limits.minWidthMin),
      freshBlock('RUNNING_NUMBER', info.limits.minWidthMax / 2),
    ],
  };
}

const clone = (f: UhidFormat): UhidFormat => JSON.parse(JSON.stringify(f)) as UhidFormat;

/**
 * Design the patient number (UHID) format from parts. The API checks every part and keeps the old
 * formats; saving asks twice because it changes every NEW number from now on.
 */
export function UhidFormatCard({
  initial,
  initialErrorCode,
  canWrite,
}: {
  initial: UhidFormatResponse | null;
  initialErrorCode: string | null;
  canWrite: boolean;
}) {
  const [info, setInfo] = useState(initial);
  const [draft, setDraft] = useState<UhidFormat | null>(
    initial ? clone(initial.format ?? startingFormat(initial)) : null,
  );
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);

  // "Saved." fades away by itself; an error stays until the next action.
  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = setTimeout(() => setSaved(false), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [saved]);

  const sample = useMemo(
    () =>
      info && draft
        ? previewUhid({
            blocks: draft.blocks,
            resetRule: draft.resetRule,
            fyStartMonth: draft.fyStartMonth,
            branchCode: info.branchCode,
            now: new Date(),
            runningNumber: 1,
          })
        : '',
    [info, draft],
  );

  if (!info || !draft) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(initialErrorCode ?? 'UNKNOWN')}
        </p>
      </SettingBlock>
    );
  }

  const { limits } = info;
  const changed = JSON.stringify(draft) !== JSON.stringify(info.format);
  const edit = (next: UhidFormat) => {
    setDraft(next);
    setConfirming(false);
    setSaved(false);
    setError(null);
  };
  const setBlock = (index: number, patch: Partial<UhidBlock>) =>
    edit({
      ...draft,
      blocks: draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    });
  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= draft.blocks.length) {
      return;
    }
    const blocks = [...draft.blocks];
    [blocks[index], blocks[to]] = [blocks[to]!, blocks[index]!];
    edit({ ...draft, blocks });
  };
  const used = new Set(draft.blocks.map((b) => b.blockType));
  const addable = UHID_BLOCK_TYPES.filter((t) => !ONCE_ONLY.includes(t) || !used.has(t));

  async function save() {
    if (busy.current || !draft) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    const result = await saveUhidFormat(draft);
    busy.current = false;
    setSaving(false);
    setConfirming(false);
    if (!result.ok) {
      setError(settingsErrorMessage(result));
      return;
    }
    setInfo(result.data);
    if (result.data.format) {
      setDraft(clone(result.data.format));
    }
    setSaved(true);
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      <dl className="settings-values">
        <div>
          <dt className="type-small text-muted-foreground">{copy.currentHeading}</dt>
          <dd className="type-body text-foreground">
            {info.configured ? (
              <span className="settings-sample">{info.example}</span>
            ) : (
              copy.notConfigured
            )}
          </dd>
        </div>
        {info.configured ? (
          <div>
            <dt className="type-small text-muted-foreground">{copy.nextLabel}</dt>
            <dd className="type-body text-foreground">
              <span className="settings-sample">{info.next}</span>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="type-small text-muted-foreground">{copy.previewLabel}</dt>
          <dd className="type-body text-foreground">
            <span className="settings-sample">{sample}</span>
          </dd>
        </div>
      </dl>
      <p className="type-small text-muted-foreground">{copy.previewNote}</p>
      <p role="status" className="settings-flash type-label text-foreground">
        {saved ? copy.saved : ''}
      </p>
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}

      <h3 className="type-label-strong">{copy.designHeading}</h3>
      <fieldset disabled={!canWrite || saving} className="section-stack">
        <div className="settings-part">
          <div className="settings-field-medium">
            <SelectField
              label={copy.resetLabel}
              value={draft.resetRule}
              onChange={(event) =>
                edit({ ...draft, resetRule: event.target.value as UhidFormat['resetRule'] })
              }
            >
              {Object.entries(copy.resetNames).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </SelectField>
          </div>
          {draft.resetRule === 'FINANCIAL_YEAR' ? (
            <div className="settings-field-medium">
              <SelectField
                label={copy.fyStartLabel}
                value={String(draft.fyStartMonth)}
                onChange={(event) => edit({ ...draft, fyStartMonth: Number(event.target.value) })}
              >
                {copy.months.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </SelectField>
            </div>
          ) : null}
        </div>

        <p className="type-label-strong">{copy.partsHeading}</p>
        <p className="type-small text-muted-foreground">{copy.partsHelp}</p>
        {draft.blocks.map((block, index) => (
          <div
            key={index}
            role="group"
            aria-label={copy.partAria.replace('{n}', String(index + 1))}
            className="settings-part"
          >
            <div className="settings-field-narrow">
              <SelectField
                label={copy.typeLabel}
                value={block.blockType}
                onChange={(event) =>
                  setBlock(index, {
                    ...freshBlock(event.target.value as UhidBlockType, limits.minWidthMax / 2),
                  })
                }
              >
                {UHID_BLOCK_TYPES.filter(
                  (t) => t === block.blockType || !ONCE_ONLY.includes(t) || !used.has(t),
                ).map((t) => (
                  <option key={t} value={t}>
                    {copy.typeNames[t]}
                  </option>
                ))}
              </SelectField>
            </div>
            {TEXT_TYPES.includes(block.blockType) ? (
              <div className="settings-field-narrow">
                <InputField
                  label={copy.textLabel}
                  value={block.textValue ?? ''}
                  maxLength={limits.maxTextLength}
                  autoComplete="off"
                  onChange={(event) => setBlock(index, { textValue: event.target.value })}
                />
              </div>
            ) : null}
            {block.blockType === 'FINANCIAL_YEAR' ? (
              <div className="settings-field-narrow">
                <SelectField
                  label={copy.styleLabel}
                  value={block.fyStyle ?? 'SHORT'}
                  onChange={(event) =>
                    setBlock(index, { fyStyle: event.target.value as 'SHORT' | 'LONG' })
                  }
                >
                  {Object.entries(copy.styleNames).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : null}
            {block.blockType === 'RUNNING_NUMBER' ? (
              <div className="settings-field-narrow">
                <InputField
                  label={copy.widthLabel}
                  title={copy.widthHint}
                  type="number"
                  inputMode="numeric"
                  min={limits.minWidthMin}
                  max={limits.minWidthMax}
                  step={1}
                  value={block.minWidth ?? ''}
                  onChange={(event) =>
                    setBlock(index, {
                      minWidth: event.target.value === '' ? null : Number(event.target.value),
                    })
                  }
                />
              </div>
            ) : null}
            <div className="settings-actions">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={copy.moveUp}
                title={copy.moveUp}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <span aria-hidden="true">↑</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={copy.moveDown}
                title={copy.moveDown}
                disabled={index === draft.blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                <span aria-hidden="true">↓</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={copy.remove}
                title={copy.remove}
                disabled={draft.blocks.length <= 1}
                onClick={() =>
                  edit({ ...draft, blocks: draft.blocks.filter((_, i) => i !== index) })
                }
              >
                <span aria-hidden="true">✕</span>
              </Button>
            </div>
          </div>
        ))}
        <div className="settings-part">
          <div className="settings-field-medium">
            <SelectField
              label={copy.addPart}
              value=""
              disabled={draft.blocks.length >= limits.maxBlocks}
              onChange={(event) => {
                if (event.target.value) {
                  edit({
                    ...draft,
                    blocks: [
                      ...draft.blocks,
                      freshBlock(event.target.value as UhidBlockType, limits.minWidthMax / 2),
                    ],
                  });
                }
              }}
            >
              <option value="">{copy.addPart}</option>
              {addable.map((t) => (
                <option key={t} value={t}>
                  {copy.typeNames[t]}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
      </fieldset>

      {canWrite ? (
        confirming ? (
          <div className="settings-actions" role="group" aria-label={copy.confirm}>
            <p className="type-label">{copy.confirm}</p>
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? copy.saving : copy.confirmYes}
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              {copy.cancel}
            </Button>
          </div>
        ) : (
          <div className="settings-actions">
            <Button
              type="button"
              disabled={saving || !changed}
              onClick={() => setConfirming(true)}
              className="touch-target"
            >
              {copy.save}
            </Button>
            {!changed && info.configured ? (
              <span className="type-small text-muted-foreground">{copy.unchanged}</span>
            ) : null}
          </div>
        )
      ) : null}
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
    </SettingBlock>
  );
}
