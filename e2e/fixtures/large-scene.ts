import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createInterface } from 'node:readline/promises';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

// The large-scene fixture of specs/10-testing-acceptance.md §3 (Q-060, Q-088, D-036): a generated map
// of 10,000 × 7,000 px with 50 tokens, plus a scene without a map. Nothing in it is third-party art:
// every image is drawn here, from its pixels, and encoded as PNG with Node's own zlib.
//
// `seedLargeScene` builds it through the REST API of a running server, for the end-to-end test that
// activates it (tests/journeys/large-scene.spec.ts). As a command it writes the images to a folder, so
// the same fixture can be loaded by hand on the owner's TV run (REL-03):
//
//   node e2e/fixtures/large-scene.ts <folder>
//
// or builds it whole on a running server, in a new campaign, signing in with the DM PIN from
// EMBERGLASS_PIN or typed when asked (REL-03, docs/acceptance/rel-03-owner-run.md):
//
//   node e2e/fixtures/large-scene.ts --seed http://localhost:3000

export const MAP_WIDTH = 10_000;
export const MAP_HEIGHT = 7_000;
/** The map's drawn grid: squares of 100 px from the corner, 100 columns and 70 rows. */
export const SQUARE = 100;
export const TOKEN_COUNT = 50;
const TOKEN_SIDE = 256;
const LINE: RGB = [24, 22, 20];

export type RGB = [number, number, number];

/** The colour of the map's region `(bx, by)`, each region 1,000 px square: a 10 × 7 patchwork. */
export function regionColour(bx: number, by: number): RGB {
  return [70 + ((bx * 37 + by * 11) % 120), 90 + ((bx * 13 + by * 53) % 100), 60 + ((bx * 29 + by * 17) % 90)];
}

/** The colour of each of the fixture's token assets, one per asset. */
export const TOKEN_COLOURS: RGB[] = [
  [220, 40, 40],
  [40, 200, 220],
  [240, 200, 20],
  [200, 40, 220],
  [250, 250, 250],
];

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An 8-bit RGB PNG whose scanline `y` is `row(y)`: a 0 filter byte, then the pixels. */
function encodePng(width: number, height: number, row: (y: number) => Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, (_, y) => row(y))))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The 10,000 × 7,000 map: a patchwork of 1,000 px regions under a 2 px grid of 100 px squares. */
export function largeMapPng(): Buffer {
  const onLine = (at: number) => at % SQUARE === 0 || at % SQUARE === SQUARE - 1;
  // Few distinct scanlines: one per band of regions, lined or not, each built once.
  const rows = new Map<string, Buffer>();
  const rowFor = (y: number): Buffer => {
    const key = `${Math.floor(y / 1000)}:${onLine(y)}`;
    let row = rows.get(key);
    if (!row) {
      row = Buffer.alloc(1 + MAP_WIDTH * 3);
      for (let x = 0; x < MAP_WIDTH; x++) {
        row.set(onLine(y) || onLine(x) ? LINE : regionColour(Math.floor(x / 1000), Math.floor(y / 1000)), 1 + x * 3);
      }
      rows.set(key, row);
    }
    return row;
  };
  return encodePng(MAP_WIDTH, MAP_HEIGHT, rowFor);
}

/** A token image: a disc of `colour` on a dark square, 256 px. */
export function tokenPng(colour: RGB): Buffer {
  const r = TOKEN_SIDE / 2;
  return encodePng(TOKEN_SIDE, TOKEN_SIDE, (y) => {
    const row = Buffer.alloc(1 + TOKEN_SIDE * 3);
    for (let x = 0; x < TOKEN_SIDE; x++) {
      const inside = (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= (r - 4) ** 2;
      row.set(inside ? colour : [16, 16, 16], 1 + x * 3);
    }
    return row;
  });
}

/** Where the n-th token stands, in grid units: a 10 × 5 block spread over the map, one square apart. */
export function tokenSquare(n: number): { x: number; y: number } {
  return { x: 5 + (n % 10) * 9, y: 5 + Math.floor(n / 10) * 12 };
}

export interface LargeScene {
  sceneId: string;
  maplessSceneId: string;
  mapImageId: string;
  assets: { id: string; image_id: string; colour: RGB }[];
  tokens: { id: string; asset_id: string; x: number; y: number }[];
}

/** Builds the fixture in `sessionId` through the REST API, as a signed-in DM's `request`. */
export async function seedLargeScene(request: APIRequestContext, sessionId: string, tag: string): Promise<LargeScene> {
  const upload = async (png: Buffer) => {
    const response = await request.post('/api/images', {
      data: png,
      headers: { 'content-type': 'application/octet-stream' },
      timeout: 120_000,
    });
    if (!response.ok()) throw new Error(`upload refused: ${response.status()} ${await response.text()}`);
    return (await response.json()) as { id: string };
  };
  const created = async <T>(response: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> => {
    if (!response.ok()) throw new Error(`${response.url()}: ${response.status()} ${await response.text()}`);
    return (await response.json()) as T;
  };
  const scene = await created<{ id: string }>(
    await request.post(`/api/sessions/${sessionId}/scenes`, { data: { name: `Large scene ${tag}` } }),
  );
  const mapless = await created<{ id: string }>(
    await request.post(`/api/sessions/${sessionId}/scenes`, { data: { name: `Map-less scene ${tag}` } }),
  );
  const map = await upload(largeMapPng());
  const patched = await request.patch(`/api/scenes/${scene.id}`, {
    data: {
      map_image_id: map.id,
      grid: { size: SQUARE, offset_x: 0, offset_y: 0, columns: MAP_WIDTH / SQUARE, rows: MAP_HEIGHT / SQUARE },
    },
  });
  if (!patched.ok()) throw new Error(`scene setup refused: ${await patched.text()}`);
  const assets: LargeScene['assets'] = [];
  for (const [n, colour] of TOKEN_COLOURS.entries()) {
    const image = await upload(tokenPng(colour));
    const asset = await created<{ id: string; image_id: string }>(
      await request.post('/api/assets', {
        data: {
          name: `Fixture token ${n + 1} ${tag}`,
          image_id: image.id,
          category: 'monster',
          size: 'medium',
          default_hidden: false,
        },
      }),
    );
    assets.push({ ...asset, colour });
  }
  const tokens: LargeScene['tokens'] = [];
  for (let n = 0; n < TOKEN_COUNT; n++) {
    const asset = assets[n % assets.length]!;
    const { token } = await created<{ token: { id: string } }>(
      await request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: asset.id, ...tokenSquare(n) } }),
    );
    tokens.push({ id: token.id, asset_id: asset.id, ...tokenSquare(n) });
  }
  return { sceneId: scene.id, maplessSceneId: mapless.id, mapImageId: map.id, assets, tokens };
}

// As a command: the images, written to the folder named.
/** Signs in to `server` with the DM PIN and builds the fixture in a new campaign; the PIN is never printed. */
async function seedOnServer(server: string): Promise<void> {
  let pin = process.env.EMBERGLASS_PIN;
  if (!pin) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    pin = (await prompt.question('DM PIN: ')).trim();
    prompt.close();
  }
  const request = await playwrightRequest.newContext({ baseURL: server });
  try {
    const signedIn = await request.post('/api/auth', { data: { pin } });
    if (!signedIn.ok()) throw new Error(`sign-in refused: ${signedIn.status()} ${await signedIn.text()}`);
    // Local time, as the DM reads it: 2026-10-01 20:30.
    const tag = new Date().toLocaleString('sv').slice(0, 16);
    const campaign = await request.post('/api/campaigns', { data: { name: `TV run ${tag}` } });
    if (!campaign.ok()) throw new Error(`campaign refused: ${await campaign.text()}`);
    const { id: campaignId } = (await campaign.json()) as { id: string };
    const session = await request.post(`/api/campaigns/${campaignId}/sessions`, { data: { title: 'TV run' } });
    if (!session.ok()) throw new Error(`session refused: ${await session.text()}`);
    const { id: sessionId } = (await session.json()) as { id: string };
    const built = await seedLargeScene(request, sessionId, tag);
    console.log(
      `Built campaign "TV run ${tag}": scene "Large scene ${tag}" (${MAP_WIDTH} × ${MAP_HEIGHT} px, ${built.tokens.length} tokens) and "Map-less scene ${tag}".`,
    );
    await request.delete('/api/auth');
  } finally {
    await request.dispose();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, second] = process.argv.slice(2);
  if (first === '--seed' && second) {
    await seedOnServer(second);
    process.exit(0);
  }
  const folder = first;
  if (!folder || folder === '--seed') {
    console.error(
      'usage: node e2e/fixtures/large-scene.ts <folder>\n       node e2e/fixtures/large-scene.ts --seed <server URL>',
    );
    process.exit(2);
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'large-map.png'), largeMapPng());
  for (const [n, colour] of TOKEN_COLOURS.entries())
    writeFileSync(path.join(folder, `token-${n + 1}.png`), tokenPng(colour));
  console.log(
    `Wrote the large-scene fixture's map (${MAP_WIDTH} × ${MAP_HEIGHT} px) and ${TOKEN_COLOURS.length} token images to ${folder}.`,
  );
}
