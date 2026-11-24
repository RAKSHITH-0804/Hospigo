import type { Metadata } from 'next';
import { AccountPage } from '@/components/account/account-page';
import { MyLeave } from '@/components/doctors/my-leave';
import { MyProfileForm } from '@/components/doctors/my-profile-form';
import { SettingBlock } from '@/components/settings/setting-block';
import { PageHeader } from '@/components/ui/page-header';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import { API_DOCTOR_PROFILE_ME, type MyProfileResponse } from '@/lib/doctors/types';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';
import { API_ACCOUNT_ME, type AccountView } from '@/lib/staff/types';

const account = staffCopy.account;
const doctor = staffCopy.doctorProfile;

export const metadata: Metadata = { title: account.pageTitle };

/**
 * "My profile" for EVERY signed-in staff member (any role): name, phone, email and password. A
 * person who works as a doctor also gets the doctor part (printed name, qualifications,
 * registration number) below. The API finds the person from the token, never from the request.
 */
export default async function MyProfilePage() {
  const session = await requireKind('HOSPITAL');
  const isDoctor = session.permissions?.includes('opd.doctors.own') ?? false;
  const [me, profile] = await Promise.all([
    fetchStaffOnServer<AccountView>(API_ACCOUNT_ME),
    isDoctor ? fetchStaffOnServer<MyProfileResponse>(API_DOCTOR_PROFILE_ME) : Promise.resolve(null),
  ]);
  return (
    <div className="section-stack content-container-inner">
      <PageHeader title={account.title} description={account.description} backToPrevious="/app" />
      <AccountPage
        initial={me.status === 'ok' ? me.data : null}
        initialErrorCode={me.status === 'ok' ? null : serverErrorCode(me)}
      >
        {profile ? (
          profile.status === 'forbidden' ? (
            <SettingBlock title={doctor.title} description={doctor.noProfileDescription}>
              <p className="type-label text-muted-foreground">{doctor.noProfileTitle}</p>
            </SettingBlock>
          ) : (
            <>
              <MyProfileForm
                initial={profile.status === 'ok' ? profile.data : null}
                initialErrorCode={profile.status === 'ok' ? null : serverErrorCode(profile)}
              />
              {profile.status === 'ok' ? <MyLeave /> : null}
            </>
          )
        ) : null}
      </AccountPage>
    </div>
  );
}
