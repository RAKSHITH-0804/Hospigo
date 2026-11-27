import type { Metadata } from 'next';
import { RefundRequestsList, type RefundFilter } from '@/components/opd/refund-requests-list';
import { opdWebConfig } from '@/config/opd';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { AllBranchesToggle } from '@/components/shell/all-branches-toggle';
import { API_OPD_REFUND_REQUESTS } from '@/lib/opd/server';
import type { RefundListResponse } from '@/lib/opd/tests-types';
import { errorMessageFor } from '@/lib/patients/client';
import { fetchStaffOnServer, serverErrorCode } from '@/lib/patients/server';

const copy = staffCopy.opd.tests.refunds;
const FILTER_IDS: readonly RefundFilter[] = ['REQUESTED', 'APPROVED', 'REJECTED', 'ALL'];

export const metadata: Metadata = { title: staffCopy.pageTitles.opdRefunds };

/**
 * Refund and cancellation requests of the branch. An Admin (opd.refunds.approve) decides them;
 * reception (who may read bills) follows the state of what they asked. The API decides who may
 * do what: these screens only hide what would be refused.
 */
export default async function RefundRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePermission('opd.billing.read');
  const canDecide = session.permissions?.includes('opd.refunds.approve') ?? false;
  const query = (await searchParams) ?? {};
  const all = query.branch === 'ALL' && session.canSwitchBranch === true;

  // Approvers start on the open requests; everyone else on all of them.
  const rawFilter = typeof query.status === 'string' ? query.status : undefined;
  const filter: RefundFilter = FILTER_IDS.includes(rawFilter as RefundFilter)
    ? (rawFilter as RefundFilter)
    : canDecide
      ? 'REQUESTED'
      : 'ALL';
  const rawPage = Number(
    Array.isArray(query[opdWebConfig.refundsPageParam])
      ? undefined
      : query[opdWebConfig.refundsPageParam],
  );
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;

  const list = await fetchStaffOnServer<RefundListResponse>(API_OPD_REFUND_REQUESTS, {
    ...(filter === 'ALL' ? {} : { status: filter }),
    ...(all ? { branch: 'ALL' } : {}),
    page,
    pageSize: opdWebConfig.refundsPageSize,
  });

  if (list.status !== 'ok') {
    return (
      <div className="section-stack content-container-inner">
        <p className="type-label-strong">{copy.loadErrorTitle}</p>
        <p role="alert" className="type-label text-destructive">
          {errorMessageFor(serverErrorCode(list))}
        </p>
      </div>
    );
  }

  return (
    <>
      {session.canSwitchBranch === true ? (
        <AllBranchesToggle href={`/app/opd/refunds?status=${filter}`} active={all} />
      ) : null}
      <RefundRequestsList
        data={list.data}
        filter={filter}
        hrefFor={(f, p) =>
          `/app/opd/refunds?status=${f}&${opdWebConfig.refundsPageParam}=${p}${all ? '&branch=ALL' : ''}`
        }
        canDecide={canDecide}
        currentUserId={session.id ?? null}
      />
    </>
  );
}
