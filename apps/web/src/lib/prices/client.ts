import { patientsApi, type PatientsApiResult } from '@/lib/patients/client';
import {
  PRICES_ROUTES,
  type PriceChangeResponse,
  type PriceHistoryResponse,
  type PriceKind,
  type PriceRow,
  type PricesResponse,
} from './types';

/** Browser calls to the Next route handlers of the Prices screen. Tokens never reach the browser. */

export type PriceListQuery = {
  q: string;
  kind: PriceKind | '';
  page: number;
  /** The active branch: only doctors who work in it are listed (tests and the registration fee are hospital-wide). */
  branchId?: string | null;
};

export function listPrices(query: PriceListQuery): Promise<PatientsApiResult<PricesResponse>> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.kind) params.set('kind', query.kind);
  if (query.branchId) params.set('branchId', query.branchId);
  if (query.page > 1) params.set('page', String(query.page));
  const text = params.toString();
  return patientsApi<PricesResponse>(`${PRICES_ROUTES.list}${text ? `?${text}` : ''}`);
}

export function priceHistory(row: PriceRow): Promise<PatientsApiResult<PriceHistoryResponse>> {
  const params = new URLSearchParams();
  if (row.kind === 'DOCTOR_FEE') {
    params.set('doctorProfileId', row.doctorProfileId ?? '');
    params.set('visitType', row.visitType ?? '');
  } else {
    params.set('itemId', row.itemId ?? '');
  }
  return patientsApi<PriceHistoryResponse>(`${PRICES_ROUTES.history}?${params.toString()}`);
}

/** Add a new price version for the row (a registration fee, a test or a doctor fee). */
export function changePrice(
  row: PriceRow,
  body: { amountPaise: number; effectiveFrom?: string },
): Promise<PatientsApiResult<PriceChangeResponse>> {
  if (row.kind === 'DOCTOR_FEE') {
    return patientsApi<PriceChangeResponse>(PRICES_ROUTES.doctorFees, {
      method: 'POST',
      body: { ...body, doctorProfileId: row.doctorProfileId, visitType: row.visitType },
    });
  }
  return patientsApi<PriceChangeResponse>(
    `${PRICES_ROUTES.items}/${encodeURIComponent(row.itemId ?? '')}`,
    { method: 'POST', body },
  );
}
