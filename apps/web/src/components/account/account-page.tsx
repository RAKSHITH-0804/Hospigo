'use client';

import { useState, type ReactNode } from 'react';
import { AccountDetails } from '@/components/account/account-details';
import { EmailChange } from '@/components/account/email-change';
import { PasswordChange } from '@/components/account/password-change';
import { SettingBlock } from '@/components/settings/setting-block';
import { SettingsHelp } from '@/components/settings/settings-help';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import type { AccountView } from '@/lib/staff/types';

/**
 * "My profile" for every signed-in person: details, email and password, side by side on wide
 * screens. Role-specific parts (for example the doctor's printed details) arrive as `children` and
 * are shown below.
 */
export function AccountPage({
  initial,
  initialErrorCode,
  children,
}: {
  initial: AccountView | null;
  initialErrorCode: string | null;
  children?: ReactNode;
}) {
  const [account, setAccount] = useState(initial);
  if (!account) {
    return (
      <SettingBlock title={staffCopy.account.title} description={staffCopy.account.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : staffCopy.account.loadError}
        </p>
      </SettingBlock>
    );
  }
  return (
    <>
      <SettingsHelp pageId="account" />
      <div className="settings-columns">
        <AccountDetails account={account} onChanged={setAccount} />
        <div className="section-stack">
          <EmailChange account={account} onChanged={setAccount} />
          <PasswordChange />
        </div>
      </div>
      {children}
    </>
  );
}
