import { deflateSync } from 'node:zlib';

/**
 * A small, simple logo mark as a PNG, drawn in code (no picture files in the repository): a coloured
 * disc with a white cross and a thin ring, for a fictional hospital. Square, `size` pixels a side.
 */
const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export type Rgb = [number, number, number];

export function logoPng(size: number, colour: Rgb, variant: 'CROSS' | 'HEART'): Buffer {
  const rows: Buffer[] = [];
  const c = (size - 1) / 2;
  const radius = size * 0.46;
  const ring = size * 0.42;
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const dx = x - c;
      const dy = y - c;
      const dist = Math.hypot(dx, dy);
      let pixel: [number, number, number, number] = [255, 255, 255, 0];
      if (dist <= radius) {
        pixel = [...colour, 255];
        const onRing = Math.abs(dist - ring) < size * 0.012;
        let white = onRing;
        if (variant === 'CROSS') {
          const arm = size * 0.09;
          const length = size * 0.26;
          white =
            white ||
            (Math.abs(dx) <= arm && Math.abs(dy) <= length) ||
            (Math.abs(dy) <= arm && Math.abs(dx) <= length);
        } else {
          // a plus sign with a smaller square at the centre: reads as a simple health mark
          const arm = size * 0.06;
          const length = size * 0.28;
          white =
            white ||
            (Math.abs(dx) <= arm && Math.abs(dy) <= length) ||
            (Math.abs(dy) <= arm && Math.abs(dx) <= length) ||
            (Math.abs(dx) <= arm * 2.2 && Math.abs(dy) <= arm * 2.2);
        }
        if (white) {
          pixel = [255, 255, 255, 255];
        }
      }
      row.set(pixel, 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
