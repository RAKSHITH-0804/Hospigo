/** Behaviour numbers of the Excel upload screen (Settings, OPD, Upload lists). No UI text here. */
export const importScreenConfig = {
  /** The web server refuses a request body larger than this before reading it (bytes). */
  bffMaxBodyBytes: 2_300_000,
  /** What the file chooser offers (the API checks the real bytes). */
  accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  /** How often the screen asks for the status while a batch is being read or saved. */
  pollMs: 1500,
  /** Rows shown per page in the preview. */
  rowsPageSize: 50,
  /** Batches shown per page in the history. */
  historyPageSize: 10,
} as const;

/** The columns of each list, in the order of the Excel file, as the preview shows them (keys of the stored row values). */
export const importValueColumns = {
  TESTS: ['code', 'name', 'price', 'startDate', 'active'],
  DOCTOR_FEES: ['doctorCode', 'visitType', 'amount', 'startDate'],
  MEDICINES: ['code', 'name', 'composition', 'form', 'active'],
} as const;
