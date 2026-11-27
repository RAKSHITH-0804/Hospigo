import { OpdQueue } from '@/components/opd/opd-queue';
import { EmptyState } from '@/components/states/empty-state';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requireKind } from '@/lib/auth/guards';
import { AllBranchesToggle } from '@/components/shell/all-branches-toggle';
import { API_OPD_QUEUE } from '@/lib/opd/server';
import type { QueueResponse } from '@/lib/opd/clinical-types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.opd.clinical.queue;

/**
 * The OPD queue. A doctor sees their own waiting patients, a nurse the whole branch. Staff without
 * the queue permission (reception) are pointed to Patients. Real data only: no sample numbers.
 */
export default async function OpdPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const session = await requireKind('HOSPITAL');
  const all = (await searchParams)?.branch === 'ALL' && session.canSwitchBranch === true;
  const permissions = session.permissions ?? [];
  const noAccess = (
    <div className="section-stack content-container-inner">
      <EmptyState title={copy.noAccessTitle} description={copy.noAccessDescription} />
    </div>
  );
  if (!permissions.includes('opd.queue.read')) {
    return noAccess;
  }
  const queue = await (all
    ? fetchStaffOnServer<QueueResponse>(API_OPD_QUEUE, { branch: 'ALL' })
    : fetchStaffOnServer<QueueResponse>(API_OPD_QUEUE));
  if (queue.status === 'forbidden') {
    return noAccess;
  }
  if (queue.status !== 'ok') {
    return (
      <div className="section-stack content-container-inner">
        <p className="type-label-strong">{copy.loadErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(queue))}
        </p>
      </div>
    );
  }
  return (
    <>
      {session.canSwitchBranch === true ? <AllBranchesToggle href="/app/opd" active={all} /> : null}
      <OpdQueue
        allBranches={all}
        initial={queue.data}
        refreshSeconds={opdWebConfig.queueRefreshSeconds}
        canOpenConsultation={permissions.includes('opd.notes.write')}
        canViewNotes={permissions.includes('opd.notes.read')}
        canRecordVitals={permissions.includes('opd.vitals.write')}
        canRequestCancel={permissions.includes('opd.refunds.request')}
      />
    </>
  );
}
