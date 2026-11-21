import { ImageRefused, sniffImage } from './image-sniff';
import { IMAGE_LIMITS } from './images.config';
import { makeGif, makeJpeg, makePng, makeSvg, makeWebp } from './image-test.util';

const refused = (bytes: Buffer): string => {
  try {
    sniffImage(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ImageRefused);
    return (error as ImageRefused).reason;
  }
  throw new Error('expected a refusal');
};

describe('sniffImage: the bytes decide, never the name', () => {
  it('reads PNG, JPEG and WebP with their real size', () => {
    expect(sniffImage(makePng(120, 60))).toEqual({
      contentType: 'image/png',
      width: 120,
      height: 60,
    });
    expect(sniffImage(makeJpeg(300, 200))).toEqual({
      contentType: 'image/jpeg',
      width: 300,
      height: 200,
    });
    expect(sniffImage(makeWebp(64, 32))).toEqual({
      contentType: 'image/webp',
      width: 64,
      height: 32,
    });
  });

  it('refuses nothing, text, SVG (it can carry scripts), GIF and other files', () => {
    expect(refused(Buffer.alloc(0))).toBe('EMPTY');
    expect(refused(Buffer.from('hello, I am not a picture at all'))).toBe('NOT_AN_IMAGE');
    expect(refused(makeSvg())).toBe('NOT_AN_IMAGE');
    expect(refused(makeGif())).toBe('NOT_AN_IMAGE');
    expect(refused(Buffer.from('%PDF-1.7 fake'))).toBe('NOT_AN_IMAGE');
    expect(refused(Buffer.from('MZ\x90\x00 an executable'))).toBe('NOT_AN_IMAGE');
  });

  it('refuses a file that is cut short or has junk after the end', () => {
    const png = makePng(50, 50);
    expect(refused(png.subarray(0, png.length - 5))).toBe('CORRUPT');
    expect(refused(Buffer.concat([png, Buffer.from('<?php evil ?>')]))).toBe('CORRUPT');
    const jpeg = makeJpeg(50, 50);
    expect(refused(jpeg.subarray(0, jpeg.length - 2))).toBe('CORRUPT');
    const webp = makeWebp(50, 50);
    expect(refused(webp.subarray(0, webp.length - 3))).toBe('CORRUPT');
    expect(refused(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))).toBe(
      'CORRUPT',
    );
    expect(refused(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('CORRUPT');
  });

  it('a JPEG header that claims a bigger segment than the file has is refused', () => {
    const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x00, 0x00, 0xff, 0xd9]);
    expect(refused(bad)).toBe('CORRUPT');
  });

  it('enforces the size limits: too small, too many pixels, too many bytes', () => {
    expect(refused(makePng(IMAGE_LIMITS.minSidePx - 1, 100))).toBe('TOO_SMALL');
    expect(refused(makePng(100, IMAGE_LIMITS.minSidePx - 1))).toBe('TOO_SMALL');
    expect(sniffImage(makePng(IMAGE_LIMITS.minSidePx, IMAGE_LIMITS.minSidePx)).width).toBe(
      IMAGE_LIMITS.minSidePx,
    );
    expect(refused(makePng(IMAGE_LIMITS.maxSidePx + 1, 100))).toBe('TOO_LARGE_PIXELS');
    expect(refused(makeJpeg(100, IMAGE_LIMITS.maxSidePx + 1))).toBe('TOO_LARGE_PIXELS');
    expect(sniffImage(makePng(IMAGE_LIMITS.maxSidePx, IMAGE_LIMITS.maxSidePx)).height).toBe(
      IMAGE_LIMITS.maxSidePx,
    );
    expect(refused(makePng(100, 100, IMAGE_LIMITS.maxBytes))).toBe('TOO_BIG');
    const exactly = makePng(100, 100);
    const pad = IMAGE_LIMITS.maxBytes - exactly.length - 12;
    expect(sniffImage(makePng(100, 100, pad)).width).toBe(100); // exactly the limit is allowed
  });

  it('a PNG pretending to be a JPEG (or the reverse) is judged by what it is', () => {
    expect(sniffImage(makePng(40, 40)).contentType).toBe('image/png');
    expect(sniffImage(makeJpeg(40, 40)).contentType).toBe('image/jpeg');
  });
});
