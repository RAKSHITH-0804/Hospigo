/** API paths (server side) and the Next route handlers that proxy them (browser side). */
export const API_OPD_RULES = '/settings/opd-rules';
export const API_PATIENT_FIELDS = '/settings/patient-fields';
export const API_UHID_FORMAT = '/settings/uhid-format';

export const SETTINGS_ROUTES = {
  opdRules: '/api/staff/settings/opd-rules',
  patientFields: '/api/staff/settings/patient-fields',
  uhidFormat: '/api/staff/settings/uhid-format',
} as const;
