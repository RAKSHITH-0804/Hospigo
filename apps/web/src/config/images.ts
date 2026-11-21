/**
 * Picture upload (hospital logo, doctor signature or stamp). The API is the authority on the real
 * limits (it sends them with every screen); these numbers only keep an absurd upload from being
 * read by the web server at all.
 */
export const imageUploadConfig = {
  /** The web server refuses a request body larger than this before reading it (bytes). */
  bffMaxBodyBytes: 2_097_152,
  /** Types the file chooser offers (the API checks the real bytes). */
  accept: 'image/png,image/jpeg,image/webp',
  /** Browsers may keep a picture this long (seconds): a picture address never serves other bytes. */
  cacheSeconds: 86_400,
  /** The only picture types passed on to the browser; anything else is never shown. */
  shownTypes: ['image/png', 'image/jpeg', 'image/webp'],
} as const;
