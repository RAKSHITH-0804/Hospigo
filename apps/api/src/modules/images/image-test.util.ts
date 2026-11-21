/**
 * Small, valid-looking picture files for tests (headers and end markers are real; the picture data
 * is not, because the code only reads the headers and never decodes). Test use only.
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

export function makePng(width: number, height: number, extra = 0): Buffer {
  const ihdr = Buffer.concat([
    u32(13),
    Buffer.from('IHDR', 'latin1'),
    u32(width),
    u32(height),
    Buffer.from([8, 2, 0, 0, 0]),
    u32(0), // checksum (not checked)
  ]);
  const idat = Buffer.concat([
    u32(extra),
    Buffer.from('IDAT', 'latin1'),
    Buffer.alloc(extra),
    u32(0),
  ]);
  const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  return Buffer.concat([PNG_SIGNATURE, ihdr, idat, iend]);
}

export function makeJpeg(width: number, height: number): Buffer {
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ]);
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.set([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], 9);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const data = Buffer.alloc(16, 0x11);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    sos,
    data,
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function makeWebp(width: number, height: number): Buffer {
  // VP8X (extended) header: flags, 3 reserved bytes, canvas width - 1 and height - 1 (24 bits)
  const body = Buffer.alloc(18);
  body.write('VP8X', 0, 'latin1');
  body.writeUInt32LE(10, 4);
  body.writeUIntLE(width - 1, 12, 3);
  body.writeUIntLE(height - 1, 15, 3);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(4 + body.length, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

export const makeGif = (): Buffer => Buffer.from('GIF89a\x10\x00\x10\x00\x00\x00\x00;', 'latin1');

export const makeSvg = (): Buffer =>
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><script>alert(1)</script></svg>',
    'utf8',
  );
