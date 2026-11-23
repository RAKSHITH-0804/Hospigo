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
