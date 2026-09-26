import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { commandFromPage } from './socket.js';

// LIV-04: live and prep modes from the DM view against the production server (specs/08-ux-journeys.md
// §2, specs/04-live-sync.md §2, §3, §4, §10, Q-024, Q-025, D-109). Go live in a DM context makes a
// player context draw the scene; moving, hiding, revealing and deleting a token in live mode change
// what the player context draws, and a hidden token never reaches it; a setup edit reaches it as a
// snapshot; Blank TV returns it to the idle screen.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main .eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const tokenBar = (page: Page) => page.getByRole('group', { name: 'Tokens' });

interface Drawn {
  id: string;
  label: string;
  x: number;
  y: number;
}

async function tvTokens(page: Page): Promise<Drawn[]> {
  const raw = await tvCanvas(page).getAttribute('data-tokens');
  return raw ? (JSON.parse(raw) as Drawn[]) : [];
}

test('the DM runs a scene from the DM view: Go live, move, hide, reveal, delete, a setup edit and Blank TV reach the TV', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);

  const upload = async (width: number, height: number, colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const names = { campaign: `Live mode LIV-04 ${Date.now()}`, session: 'Run night', scene: 'Vault of echoes' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene } })
  ).json()) as { id: string };
  const map = await upload(600, 400, [30, 50, 70]);
  expect(
    (
      await dm.request.patch(`/api/scenes/${scene.id}`, {
        data: { map_image_id: map.id, grid: { size: 30, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
      })
    ).ok(),
  ).toBe(true);
  const asset = async (name: string, colour: [number, number, number], hidden: boolean) =>
    (await (
      await dm.request.post('/api/assets', {
        data: {
          name,
          image_id: (await upload(64, 64, colour)).id,
          category: 'monster',
          size: 'medium',
          default_hidden: hidden,
        },
      })
    ).json()) as { id: string; image_id: string };
  const knight = await asset('Knight of LIV-04', [230, 200, 30], false);
  const shade = await asset('Shade of LIV-04', [120, 20, 160], true);
  const place = async (assetId: string, x: number, y: number) =>
    (
      (await (
        await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: assetId, x, y } })
      ).json()) as { token: { id: string; label: string } }
    ).token;
  const knightToken = await place(knight.id, 2, 2);
  const shadeToken = await place(shade.id, 6, 3);
  // The tree was read before the seeding above.
  await dm.reload();

  // Every frame the TV's socket receives, and every image its browser asks for.
  const frames: string[] = [];
  tv.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => frames.push(String(payload))));
  const requested: string[] = [];
  tv.on('request', (request) => requested.push(new URL(request.url()).pathname));

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');

    // Prep mode: nothing reaches the TV; Go live on the scene being edited.
    await selectScene(dm, names);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await expect(dm.locator('.eg-scene__canvas--live')).toHaveCount(0);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(dm.locator('.eg-scene__canvas--live')).toBeVisible();
    await expect(panel(dm).getByText('Live on the TV')).toBeVisible();
    await expect(liveBar(dm).getByRole('status')).toHaveText(`Live: ${names.scene}`);
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.label)).toEqual([knightToken.label]);

    // Move the knight with the keyboard: one square right, on the TV too.
    await tokenBar(dm).getByLabel('Selected token').selectOption({ label: knightToken.label });
    // Live mode keeps the canvas where prep mode has it at 1,280 × 720 with a token selected (G-022).
    const canvasTop = await viewport(dm).evaluate((element) => element.getBoundingClientRect().top);
    expect(canvasTop).toBeLessThanOrEqual(560);
    await viewport(dm).focus();
    await dm.keyboard.press('ArrowRight');
    await expect.poll(async () => (await tvTokens(tv)).find((each) => each.id === knightToken.id)?.x).toBe(3);

    // Hide the knight: gone from the TV.
    await tokenBar(dm)
      .getByRole('button', { name: `Hide token ${knightToken.label}` })
      .click();
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(0);
    // Until now nothing of the shade reached the TV: no id, name or image.
    for (const secret of [shadeToken.id, shade.id, shade.image_id, 'Shade of LIV-04']) {
      expect(frames.join('\n'), secret).not.toContain(secret);
    }
    expect(requested.some((path) => path.includes(shade.image_id))).toBe(false);

    // Reveal the shade: drawn on the TV with its label.
    await tokenBar(dm)
      .getByLabel('Selected token')
      .selectOption({ label: `${shadeToken.label} (hidden)` });
    await tokenBar(dm)
      .getByRole('button', { name: `Reveal token ${shadeToken.label}` })
      .click();
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([shadeToken.id]);

    // Delete it, after the confirmation: gone from the TV, the hidden knight still not drawn.
    const shadeLabel = (await tvTokens(tv))[0]!.label;
    await tokenBar(dm)
      .getByRole('button', { name: `Delete token ${shadeLabel}` })
      .click();
    await dm.getByRole('dialog').getByRole('button', { name: 'Delete token', exact: true }).click();
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(0);
    await expect(tvCanvas(tv)).toBeVisible();

    // A setup edit in live mode reaches the TV as a snapshot (04 §10): the grid hidden for players.
    const snapshotsBefore = Number(await player(tv).getAttribute('data-snapshots'));
    await panel(dm).getByLabel('Players see the grid').uncheck();
    await expect(player(tv)).toHaveAttribute('data-snapshots', String(snapshotsBefore + 1));

    // No token was written over REST from the DM view while live (G-024).
    const tokens = (await (await dm.request.get(`/api/scenes/${scene.id}/tokens`)).json()) as {
      id: string;
      hidden: boolean;
      x: number;
    }[];
    expect(tokens.map((each) => each.id)).toEqual([knightToken.id]);
    expect(tokens[0]).toMatchObject({ hidden: true, x: 3 });

    // Blank TV: the idle screen, and the canvas back in prep mode.
    await liveBar(dm).getByRole('button', { name: 'Blank TV' }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(player(tv)).toHaveText('Emberglass');
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await expect(liveBar(dm).getByRole('status')).toHaveText('Nothing is live. The TV shows the idle screen.');
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await dmContext.close();
    await playerContext.close();
  }
});

test('deleting the live scene from the DM view blanks the TV (03 §7, Q-031)', async ({ browser }) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  await openWorkspace(dm);
  const names = { campaign: `Doomed LIV-04 ${Date.now()}`, session: 'Last night', scene: 'Collapsing hall' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene } })
  ).json()) as { id: string };
  await dm.reload();
  const frames: string[] = [];
  tv.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => frames.push(String(payload))));
  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await dm
      .locator(`[data-item="${scene.id}"]`)
      .getByRole('button', { name: `Delete ${names.scene}` })
      .click();
    await dm.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(liveBar(dm).getByRole('status')).toHaveText('Nothing is live. The TV shows the idle screen.');
    expect(frames.join('\n')).not.toContain(scene.id);
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await dmContext.close();
    await playerContext.close();
  }
});
