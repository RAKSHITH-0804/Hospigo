/** Limits and fixed lists of picture upload (hospital logo, doctor signature or stamp). One place, no magic numbers. */

export const IMAGE_LIMITS = {
  /** Largest file accepted (bytes). A logo or a scanned signature is far smaller. */
  maxBytes: 1_048_576,
  /** Longest side accepted (pixels): refuses pictures built to use up memory when drawn. */
  maxSidePx: 4000,
  /** Shortest side accepted (pixels): a smaller picture prints as a smudge. */
  minSidePx: 16,
} as const;

/** Only these picture types are kept. Anything else (SVG can carry scripts, GIF, PDF) is refused. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const IMAGE_PURPOSES = ['HOSPITAL_LOGO', 'DOCTOR_SIGNATURE'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** How long a browser may keep a picture: the address of a picture never serves other bytes. */
export const IMAGE_CACHE_SECONDS = 86_400;

/** Reasons a picture is refused (shown to the person in plain words by the web). */
export const ImageReason = {
  REQUIRED: 'REQUIRED',
  EMPTY: 'EMPTY',
  TOO_BIG: 'TOO_BIG',
  NOT_AN_IMAGE: 'NOT_AN_IMAGE',
  CORRUPT: 'CORRUPT',
  TOO_SMALL: 'TOO_SMALL',
  TOO_LARGE_PIXELS: 'TOO_LARGE_PIXELS',
} as const;
