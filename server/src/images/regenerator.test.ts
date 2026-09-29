import { createHash } from 'node:crypto';
import { statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readImage } from '../db/images.js';
import { createTestData, type TestData } from '../http/testing/app.js';
import type { Logger } from '../log/logger.js';
import { createDisplayRegenerator, type DisplayRegenerator } from './regenerator.js';
import { imageFilePath, imagesDirOf, prepareImagesDir, regenerateDisplayVersion, storeUpload } from './store.js';

// The display regenerator against a real SQLite file and a real images folder (REL-01,
// specs/05-assets-and-images.md §7, G-015, D-124). A pass can be held part-way through a wrapped
// `regenerate`, so what happens while one runs is tested, not only what is left after it.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let data: TestData;
let imagesDir: string;
let lines: { event: string; fields: Record<string, unknown> }[];
let regenerator: DisplayRegenerator | undefined;
const logger: Logger = {
  info: (event, _msg, fields = {}) => lines.push({ event, fields }),
  warn: (event, _msg, fields = {}) => lines.push({ event, fields }),
  error: (event, _msg, fields = {}) => lines.push({ event, fields }),
};

beforeEach(() => {
  data = createTestData('emberglass-regen-');
  imagesDir = imagesDirOf(data.dataDir);
  prepareImagesDir(data.db, imagesDir);
  lines = [];
});

afterEach(async () => {
  await regenerator?.stop();
  regenerator = undefined;
  data.remove();
});

let seed = 0;
async function stored(width: number, height: number, displaySize = 4096): Promise<string> {
  const [r, g, b] = createHash('sha256').update(`regen ${seed++}`).digest();
  const png = await sharp({ create: { width, height, channels: 3, background: { r: r!, g: g!, b: b! } } })
    .png()
    .toBuffer();
  const { image } = await storeUpload(data.db, imagesDir, Readable.from([png]), { limit: 1e9, displaySize });
  return image.id;
}
const setSize = (size: number) => data.db.prepare('UPDATE settings SET display_variant_size = ?').run(size);
const displayOf = (id: string) => readImage(data.db, id)!.variants.display!;
const regenerated = () => lines.filter((line) => line.event === 'images.regenerated').map((line) => line.fields);

/** A `regenerate` that stops before the image named `at`, until `release` is called. */
function holdAt(at: () => string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let reached!: () => void;
  const held = new Promise<void>((resolve) => (reached = resolve));
  const calls: { id: string; size: number }[] = [];
  const regenerate: typeof regenerateDisplayVersion = async (db, dir, id, size, commit) => {
    calls.push({ id, size });
    if (id === at()) {
      reached();
      await released;
    }
    return regenerateDisplayVersion(db, dir, id, size, commit);
  };
  return { regenerate, calls, held, release };
}

describe('the display regenerator (G-015, D-124)', () => {
  it('runs another pass for a kick that arrives during one, so an image stored meanwhile at the old size follows', async () => {
    const first = await stored(1600, 1200);
    const hold = holdAt(() => first);
    regenerator = createDisplayRegenerator({ db: data.db, imagesDir, logger, regenerate: hold.regenerate });
    setSize(800);
    regenerator.kick();
    await hold.held;
    // An upload that read the old size before the change, stored while the pass is on its first image.
    const late = await stored(2000, 1000, 4096);
    expect(displayOf(late)).toEqual({ width: 2000, height: 1000 });
    regenerator.kick();
    hold.release();
    await regenerator.idle();
    expect(displayOf(first)).toEqual({ width: 800, height: 600 });
    expect(displayOf(late)).toEqual({ width: 800, height: 400 });
  });

  it('reads the setting before each image: a change mid-pass regenerates nothing more at the old size', async () => {
    const ids = [await stored(1600, 1200), await stored(1500, 1000), await stored(1400, 1400)].sort();
    const hold = holdAt(() => ids[1]!);
    regenerator = createDisplayRegenerator({ db: data.db, imagesDir, logger, regenerate: hold.regenerate });
    setSize(1000);
    regenerator.kick();
    await hold.held;
    setSize(700);
    regenerator.kick();
    hold.release();
    await regenerator.idle();
    // Image 1 and the held image 2 at 1,000 px; nothing after the change at 1,000; then all three at 700.
    expect(hold.calls.filter((call) => call.size === 1000).map((call) => call.id)).toEqual(ids.slice(0, 2));
    expect(regenerated()).toEqual([
      { regenerated: 2, size: 1000 },
      { regenerated: 3, size: 700 },
    ]);
    expect(ids.map((id) => Math.max(displayOf(id).width, displayOf(id).height))).toEqual([700, 700, 700]);
  });

  it('leaves an image already at the setting alone: no file written, nothing stored, nobody told', async () => {
    const id = await stored(1600, 1200);
    const commit = vi.fn((work: () => void) => work());
    regenerator = createDisplayRegenerator({ db: data.db, imagesDir, logger, commit });
    setSize(800);
    regenerator.kick();
    await regenerator.idle();
    expect(commit).toHaveBeenCalledTimes(1);
    const written = statSync(imageFilePath(imagesDir, id, 'display')).mtimeMs;
    regenerator.kick();
    regenerator.kick();
    await regenerator.idle();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(statSync(imageFilePath(imagesDir, id, 'display')).mtimeMs).toBe(written);
    expect(regenerated()).toEqual([{ regenerated: 1, size: 800 }]);
  });

  it('keeps the previous display version of an image whose original no longer decodes, and logs it', async () => {
    const good = await stored(1600, 1200);
    const broken = await stored(1200, 1200);
    writeFileSync(imageFilePath(imagesDir, broken, 'original'), 'no longer an image');
    regenerator = createDisplayRegenerator({ db: data.db, imagesDir, logger });
    setSize(600);
    regenerator.kick();
    await regenerator.idle();
    expect(displayOf(good)).toEqual({ width: 600, height: 450 });
    expect(displayOf(broken)).toEqual({ width: 1200, height: 1200 });
    expect(lines).toContainEqual({ event: 'images.regenerate_failed', fields: { ids: [broken] } });
  });

  it('stops after the image in hand and starts nothing afterwards', async () => {
    const ids = [await stored(1600, 1200), await stored(1500, 1000)].sort();
    const hold = holdAt(() => ids[0]!);
    regenerator = createDisplayRegenerator({ db: data.db, imagesDir, logger, regenerate: hold.regenerate });
    setSize(800);
    regenerator.kick();
    await hold.held;
    const stopping = regenerator.stop();
    hold.release();
    await stopping;
    expect(Math.max(displayOf(ids[0]!).width, displayOf(ids[0]!).height)).toBe(800);
    expect(displayOf(ids[1]!)).toEqual({ width: 1500, height: 1000 });
    regenerator.kick();
    await regenerator.idle();
    expect(hold.calls).toHaveLength(1);
  });
});
