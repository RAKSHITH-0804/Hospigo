import { IMAGE_LIMITS, ImageReason, type ImageType } from './images.config';

export type Sniffed = { contentType: ImageType; width: number; height: number };

/** A refusal of a picture: the reason is one of `ImageReason`. */
export class ImageRefused extends Error {
  constructor(readonly reason: string) {
    super(`picture refused: ${reason}`);
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

function pngSize(b: Buffer): { width: number; height: number } {
  // signature, then the IHDR chunk: length 13, "IHDR", width, height
  if (b.length < 33 || b.readUInt32BE(8) !== 13 || b.toString('latin1', 12, 16) !== 'IHDR') {
    throw new ImageRefused(ImageReason.CORRUPT);
  }
  // a whole PNG ends with the IEND chunk: a cut-off file does not
  if (!b.subarray(b.length - PNG_END.length).equals(PNG_END)) {
    throw new ImageRefused(ImageReason.CORRUPT);
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b: Buffer): { width: number; height: number } {
  // marker segments: FF xx length(2) data. The size is in the first "start of frame" marker.
  let i = 2;
  let size: { width: number; height: number } | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) {
      throw new ImageRefused(ImageReason.CORRUPT);
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9) {
      break;
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > b.length) {
      throw new ImageRefused(ImageReason.CORRUPT);
    }
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame && size === null) {
      if (length < 8) {
        throw new ImageRefused(ImageReason.CORRUPT);
      }
      size = { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) {
      break; // start of the picture data: the rest is entropy-coded
    }
    i += 2 + length;
  }
  // a whole JPEG ends with the end-of-image marker (zero padding after it is allowed)
  let end = b.length;
  while (end > 2 && b[end - 1] === 0x00) {
    end -= 1;
  }
  if (size === null || b[end - 2] !== 0xff || b[end - 1] !== 0xd9) {
    throw new ImageRefused(ImageReason.CORRUPT);
  }
  return size;
}

function webpSize(b: Buffer): { width: number; height: number } {
  if (b.length < 30 || b.readUInt32LE(4) !== b.length - 8) {
    throw new ImageRefused(ImageReason.CORRUPT);
  }
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    // lossy: frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      throw new ImageRefused(ImageReason.CORRUPT);
    }
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) {
      throw new ImageRefused(ImageReason.CORRUPT);
    }
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') {
    return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  }
  throw new ImageRefused(ImageReason.CORRUPT);
}

/**
 * Looks at the BYTES of an upload, never at its name or the type the browser claimed. Accepts PNG,
 * JPEG and WebP only, checks the file is whole, reads the real size and enforces the limits. The
 * picture is stored exactly as uploaded (it is never decoded or re-drawn here).
 */
export function sniffImage(bytes: Buffer): Sniffed {
  if (bytes.length === 0) {
    throw new ImageRefused(ImageReason.EMPTY);
  }
  if (bytes.length > IMAGE_LIMITS.maxBytes) {
    throw new ImageRefused(ImageReason.TOO_BIG);
  }
  let contentType: ImageType;
  let size: { width: number; height: number };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    contentType = 'image/png';
    size = pngSize(bytes);
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    contentType = 'image/jpeg';
    size = jpegSize(bytes);
  } else if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    contentType = 'image/webp';
    size = webpSize(bytes);
  } else {
    throw new ImageRefused(ImageReason.NOT_AN_IMAGE);
  }
  const { width, height } = size;
  if (width < IMAGE_LIMITS.minSidePx || height < IMAGE_LIMITS.minSidePx) {
    throw new ImageRefused(ImageReason.TOO_SMALL);
  }
  if (width > IMAGE_LIMITS.maxSidePx || height > IMAGE_LIMITS.maxSidePx) {
    throw new ImageRefused(ImageReason.TOO_LARGE_PIXELS);
  }
  return { contentType, width, height };
}
