'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { imageUploadConfig } from '@/config/images';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { checkChosenFile, rulesText, sizeText } from '@/lib/images/errors';
import { imageUrl, type ImageLimits, type ImageMeta } from '@/lib/images/types';

const copy = staffCopy.pictures.picker;

/**
 * One picture place (the logo, or a signature or stamp): the current picture, a Choose / Replace
 * button and a Remove button. It only shows and asks; the caller sends the file and answers with an
 * error sentence (or null when it worked). A refused file shows the reason in plain words.
 */
export function ImagePicker({
  image,
  limits,
  canWrite,
  alt,
  onUpload,
  onRemove,
}: {
  image: ImageMeta | null;
  limits: ImageLimits;
  canWrite: boolean;
  /** What the picture is, for people who cannot see it (and for the tests). */
  alt: string;
  onUpload: (file: File) => Promise<string | null>;
  onRemove: () => Promise<string | null>;
}) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (message?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setMessage(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [message]);

  async function run(task: () => Promise<string | null>, done: string) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    setWorking(true);
    setMessage(null);
    const problem = await task();
    busy.current = false;
    setWorking(false);
    setMessage(problem ? { kind: 'error', text: problem } : { kind: 'ok', text: done });
  }

  async function onChosen(file: File | undefined) {
    if (input.current) {
      input.current.value = ''; // the same file can be chosen again
    }
    if (!file) {
      return;
    }
    const problem = checkChosenFile(file, limits);
    if (problem) {
      setMessage({ kind: 'error', text: problem });
      return;
    }
    await run(() => onUpload(file), copy.saved);
  }

  return (
    <div className="picture-picker">
      <div className="picture-preview" data-empty={image ? undefined : 'true'}>
        {image ? (
          <img src={imageUrl(image.id)} alt={alt} width={image.width} height={image.height} />
        ) : (
          <span className="type-label text-muted-foreground">{copy.none}</span>
        )}
      </div>
      {image ? (
        <p className="type-small text-muted-foreground">
          {copy.facts
            .replace('{width}', String(image.width))
            .replace('{height}', String(image.height))
            .replace('{size}', sizeText(image.byteSize))}
        </p>
      ) : null}
      {canWrite ? (
        <div className="settings-actions">
          <input
            ref={input}
            id={inputId}
            type="file"
            accept={imageUploadConfig.accept}
            className="sr-only"
            tabIndex={-1}
            aria-label={`${alt}: ${copy.chooseAria}`}
            disabled={working}
            onChange={(event) => void onChosen(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={working}
            onClick={() => input.current?.click()}
          >
            {working ? copy.uploading : image ? copy.replace : copy.choose}
          </Button>
          {image ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => void run(onRemove, copy.removed)}
            >
              {copy.remove}
            </Button>
          ) : null}
        </div>
      ) : null}
      {canWrite ? <p className="type-small text-muted-foreground">{rulesText(limits)}</p> : null}
      {message ? (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`type-label ${message.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
