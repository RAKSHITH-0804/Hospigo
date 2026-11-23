/** Behaviour numbers of the availability pop-up. No UI text here. */
export const availabilityScreenConfig = {
  /** The quick fill for a full-time doctor: these weekdays (0 is Sunday) between these times. */
  presetDays: [1, 2, 3, 4, 5],
  presetStart: '09:00',
  presetEnd: '17:00',
} as const;
