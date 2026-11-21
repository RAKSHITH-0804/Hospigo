/** What the picture APIs answer (Step 7e). The API checks every file; these are only the shapes. */

export const API_BRANDING = '/settings/branding';

/** The Next route handlers the browser calls (the access token never leaves the server). */
export const IMAGE_ROUTES = {
  images: '/api/staff/images',
  logo: '/api/staff/branding/logo',
  logoRemove: '/api/staff/branding/logo/remove',
  mySignature: '/api/staff/doctor-profiles/me/signature',
  mySignatureRemove: '/api/staff/doctor-profiles/me/signature/remove',
  doctors: '/api/staff/doctor-profiles',
} as const;

/** The address a picture is shown from (an <img> on a screen or a print page). */
export const imageUrl = (id: string): string => `${IMAGE_ROUTES.images}/${encodeURIComponent(id)}`;

export const doctorSignatureRoute = (doctorId: string): string =>
  `${IMAGE_ROUTES.doctors}/${encodeURIComponent(doctorId)}/signature`;

export type ImageMeta = {
  id: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
};

export type ImageLimits = {
  maxBytes: number;
  maxSidePx: number;
  minSidePx: number;
  types: string[];
};

export type BrandingResponse = {
  logo: ImageMeta | null;
  canWrite: boolean;
  limits: ImageLimits;
};
