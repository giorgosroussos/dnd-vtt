import zlib from 'node:zlib';

// Generated PNGs, so no third-party art enters the tests (Q-088), 8-bit RGB, built from
// their chunks with Node's own zlib.

/** A solid colour of `width` × `height`. */
export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  return encodePng(width, height, Buffer.concat(Array.from({ length: height }, () => row)));
}

/** An 8-bit RGB PNG from its filtered scanlines, each a 0 filter byte then its pixels. */
function encodePng(width: number, height: number, scanlines: Buffer): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A generated map with a drawn square grid (Q-088): `background` with 2 px lines of `line`
 * at each multiple of `size` from the offset, which may be a decimal, each line's two pixels
 * centred on its position to within half a pixel.
 */
export function griddedPng(
  width: number,
  height: number,
  grid: { size: number; offsetX: number; offsetY: number },
  background: [number, number, number],
  line: [number, number, number],
): Buffer {
  const onLine = (at: number, offset: number) => {
    for (let k = Math.floor((at - offset) / grid.size) - 1; k <= Math.ceil((at - offset) / grid.size) + 1; k++) {
      const first = Math.floor(offset + k * grid.size - 0.5);
      if (at === first || at === first + 1) return true;
    }
    return false;
  };
  const columns = Array.from({ length: width }, (_, x) => onLine(x, grid.offsetX));
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const full = onLine(y, grid.offsetY);
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(full || columns[x] ? line : background, 1 + x * 3);
    rows.push(row);
  }
  return encodePng(width, height, Buffer.concat(rows));
}
