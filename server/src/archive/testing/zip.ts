import zlib from 'node:zlib';

// A zip writer for tests (DMT-05), which writes exactly what it is told, including what no honest zip tool writes: a
// size its headers lie about, a name with `..`, a backslash or a drive letter, a link, an encrypted flag, the same
// name twice, or more entries than the classic format counts. Archives the server's own export writes come from
// yazl (export.ts); these are the hostile ones an import must refuse.

export interface RawEntry {
  name: string | Buffer;
  data?: Buffer;
  /** 0 stored, 8 deflated (the default for a file with data). */
  method?: number;
  /** The uncompressed size the headers declare; the real one when left out. */
  declaredSize?: number;
  /** The CRC-32 the headers declare; the real one when left out. */
  crc?: number;
  flags?: number;
  /** The high byte is the system it was made on: 3 for Unix (the default), 0 for MS-DOS. */
  versionMadeBy?: number;
  /** The Unix mode in the high half; a regular file's 0o100644 or a folder's 0o040755 by default. */
  externalAttributes?: number;
}

const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};
const u64 = (value: number) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

/** The zip of `entries`, in order, local headers first and the central directory after. */
export function rawZip(entries: readonly RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name, 'utf8');
    const folder = name.toString('latin1').endsWith('/');
    const data = entry.data ?? Buffer.alloc(0);
    const method = entry.method ?? (data.length > 0 ? 8 : 0);
    const stored = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = entry.crc ?? zlib.crc32(data);
    const size = entry.declaredSize ?? data.length;
    const flags = entry.flags ?? 0;
    const header = [u16(20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc), u32(stored.length), u32(size)];
    const local = Buffer.concat([u32(0x04034b50), ...header, u16(name.length), u16(0), name, stored]);
    const attributes = entry.externalAttributes ?? (folder ? 0o040755 : 0o100644) * 0x10000;
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(entry.versionMadeBy ?? 0x031e),
        ...header,
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(attributes),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const count = entries.length;
  const end: Buffer[] = [];
  if (count > 0xffff) {
    // ZIP64: the classic record's count cannot hold it, so it says 0xffff and points to the ZIP64 record.
    const zip64At = offset + directory.length;
    end.push(
      Buffer.concat([
        u32(0x06064b50),
        u64(44),
        u16(45),
        u16(45),
        u32(0),
        u32(0),
        u64(count),
        u64(count),
        u64(directory.length),
        u64(offset),
      ]),
      Buffer.concat([u32(0x07064b50), u32(0), u64(zip64At), u32(1)]),
    );
  }
  const classic = Math.min(count, 0xffff);
  end.push(
    Buffer.concat([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(classic),
      u16(classic),
      u32(directory.length),
      u32(offset),
      u16(0),
    ]),
  );
  return Buffer.concat([...locals, directory, ...end]);
}
