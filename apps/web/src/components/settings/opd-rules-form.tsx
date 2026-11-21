'use client';

import { useRef, useState, type FormEvent } from 'react';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { saveOpdRules } from '@/lib/settings/client';
import { settingsErrorMessage } from '@/lib/settings/errors';
import type { OpdRules } from '@/lib/settings/types';

const copy = staffCopy.settings.opdRules;

function whole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) {
    return null;
  }
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** The two OPD rules: free follow-up days and free repeat-visit hours. The API checks the numbers again. */
export function OpdRulesForm({ initial, canWrite }: { initial: OpdRules; canWrite: boolean }) {
  const [rules, setRules] = useState(initial);
  const [followUp, setFollowUp] = useState(String(initial.followUpFreeDays));
  const [repeat, setRepeat] = useState(String(initial.repeatVisitFreeHours));
  const [followUpError, setFollowUpError] = useState<string | undefined>();
  const [repeatError, setRepeatError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const { followUpFreeDays: fu, repeatVisitFreeHours: rv } = rules.limits;
  const range = (min: number, max: number) =>
    copy.rangeError.replace('{min}', String(min)).replace('{max}', String(max));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setSaved(false);
    setFormError(null);
    const days = whole(followUp, fu.min, fu.max);
    const hours = whole(repeat, rv.min, rv.max);
    setFollowUpError(days === null ? range(fu.min, fu.max) : undefined);
    setRepeatError(hours === null ? range(rv.min, rv.max) : undefined);
    if (days === null || hours === null) {
      return;
    }
    busy.current = true;
    setSaving(true);
    const result = await saveOpdRules({ followUpFreeDays: days, repeatVisitFreeHours: hours });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setFormError(settingsErrorMessage(result));
      return;
    }
    setRules(result.data);
    setFollowUp(String(result.data.followUpFreeDays));
    setRepeat(String(result.data.repeatVisitFreeHours));
    setSaved(true);
  }

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {!rules.persisted ? (
        <p className="type-small text-muted-foreground">{copy.notSavedYet}</p>
      ) : null}
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
      <form onSubmit={(event) => void onSubmit(event)} noValidate className="settings-inline-form">
        <fieldset disabled={!canWrite || saving} className="settings-inline-form">
          <div className="settings-field-medium">
            <InputField
              label={copy.followUpLabel}
              hint={copy.followUpHint}
              type="number"
              inputMode="numeric"
              min={fu.min}
              max={fu.max}
              step={1}
              value={followUp}
              onChange={(event) => {
                setFollowUp(event.target.value);
                setFollowUpError(undefined);
                setSaved(false);
              }}
              error={followUpError}
            />
          </div>
          <div className="settings-field-medium">
            <InputField
              label={copy.repeatLabel}
              hint={copy.repeatHint}
              type="number"
              inputMode="numeric"
              min={rv.min}
              max={rv.max}
              step={1}
              value={repeat}
              onChange={(event) => {
                setRepeat(event.target.value);
                setRepeatError(undefined);
                setSaved(false);
              }}
              error={repeatError}
            />
          </div>
          {canWrite ? (
            <Button type="submit" disabled={saving} className="touch-target">
              {saving ? copy.saving : copy.save}
            </Button>
          ) : null}
        </fieldset>
      </form>
      {saved ? (
        <p role="status" className="type-label text-foreground">
          {copy.saved}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="type-label text-destructive">
          {formError}
        </p>
      ) : null}
    </SettingBlock>
  );
}
