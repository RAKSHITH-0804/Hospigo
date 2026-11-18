/** Documented defaults for opd_settings — returned on read when no row exists. */
export const OPD_SETTINGS_DEFAULTS = {
  followUpFreeDays: 7,
  repeatVisitFreeHours: 0,
  tokenPrefix: 'T',
  timezone: 'Asia/Kolkata',
  taxEnabled: false,
  taxName: null as string | null,
  taxRegistrationNo: null as string | null,
  taxInclusive: false,
} as const;

export const OPD_FOLLOW_UP_FREE_DAYS_MIN = 0;
export const OPD_FOLLOW_UP_FREE_DAYS_MAX = 365;
export const OPD_REPEAT_VISIT_FREE_HOURS_MIN = 0;
export const OPD_REPEAT_VISIT_FREE_HOURS_MAX = 8760;
export const OPD_FY_START_MONTH_DEFAULT = 4;
export const OPD_TAX_RATE_BP_MIN = 0;
export const OPD_TAX_RATE_BP_MAX = 10000;
