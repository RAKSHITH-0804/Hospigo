'use client';

import { useState } from 'react';
import { ImagePicker } from '@/components/images/image-picker';
import { SettingBlock } from '@/components/settings/setting-block';
import { staffCopy } from '@/config/staff-copy';
import { pictureErrorMessage } from '@/lib/images/errors';
import { removeLogo, uploadLogo } from '@/lib/images/client';
import type { BrandingResponse } from '@/lib/images/types';
import { errorMessageFor } from '@/lib/patients/client';

const copy = staffCopy.pictures.logo;

/**
 * The hospital logo: printed on the registration slip, receipt and prescription wherever the
 * template has a logo box. Only a hospital-wide Admin changes it (the API refuses anyone else); an
 * old logo stays on record. Everyone else sees it without buttons.
 */
export function LogoCard({
  initial,
  initialErrorCode,
}: {
  initial: BrandingResponse | null;
  initialErrorCode: string | null;
}) {
  const [branding, setBranding] = useState(initial);
  if (!branding) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }
  const { limits } = branding;
  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {!branding.canWrite ? (
        <p className="type-label text-muted-foreground">{copy.readOnly}</p>
      ) : null}
      <ImagePicker
        image={branding.logo}
        limits={limits}
        canWrite={branding.canWrite}
        alt={copy.alt}
        onUpload={async (file) => {
          const result = await uploadLogo(file);
          if (!result.ok) {
            return pictureErrorMessage(result, limits);
          }
          setBranding({ ...branding, logo: result.data });
          return null;
        }}
        onRemove={async () => {
          const result = await removeLogo();
          if (!result.ok) {
            return pictureErrorMessage(result, limits);
          }
          setBranding({ ...branding, logo: null });
          return null;
        }}
      />
      <p className="type-small text-muted-foreground">{copy.note}</p>
    </SettingBlock>
  );
}
