import { expect, test, type Page } from '@playwright/test';
import { sceneRow, selectScene, selectTokenRow, tokenMenu, tokenPopover, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { commandFromPage } from './socket.js';

// LIV-05: Ctrl+Z in the DM view's live mode against the production server (specs/04-live-sync.md §8,
// specs/08-ux-journeys.md §3, D-040, D-117). A DM context and a player context at once: undoing a
// move, a reveal and a deletion changes what the player context draws, the hidden token undone out of
// sight never reaches it, and Ctrl+Z in prep mode sends nothing.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

interface Drawn {
  id: string;
  label: string;
  x: number;
  y: number;
}

async function dmTokens(page: Page): Promise<Drawn[]> {
  const raw = await viewport(page).getAttribute('data-tokens');
  return raw ? (JSON.parse(raw) as Drawn[]) : [];
}

async function tvTokens(page: Page): Promise<Drawn[]> {
  const raw = await tvCanvas(page).getAttribute('data-tokens');
  return raw ? (JSON.parse(raw) as Drawn[]) : [];
}

test('Ctrl+Z in live mode undoes a move, a reveal and a deletion on the TV, and sends nothing while preparing another scene', async ({
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
  const names = { campaign: `Undo LIV-05 ${Date.now()}`, session: 'Oops night', scene: 'Hall of second thoughts' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: names.scene } })
  ).json()) as { id: string };
  // A second scene, prepared while the first is live: Ctrl+Z there must not undo the live one.
  const antechamber = 'Antechamber of doubt';
  expect((await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name: antechamber } })).ok()).toBe(
    true,
  );
  const map = await upload(600, 400, [40, 60, 40]);
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
  const ogre = await asset('Ogre of LIV-05', [200, 90, 30], false);
  const wraith = await asset('Wraith of LIV-05', [90, 90, 200], true);
  const place = async (assetId: string, x: number, y: number) =>
    (
      (await (
        await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: assetId, x, y } })
      ).json()) as { token: { id: string; label: string } }
    ).token;
  const ogreToken = await place(ogre.id, 2, 2);
  const wraithToken = await place(wraith.id, 5, 3);

  // Every command the DM page's own socket sends, and every frame the TV's receives.
  const sent: string[] = [];
  dm.on('websocket', (socket) => socket.on('framesent', ({ payload }) => sent.push(String(payload))));
  const undoFrames = () => sent.filter((frame) => frame.includes('"undo"')).length;
  const frames: string[] = [];
  tv.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => frames.push(String(payload))));
  // The tree was read before the seeding above.
  await dm.reload();

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([ogreToken.id]);

    // Move the ogre a square, then Ctrl+Z: back where it was, on the TV too.
    await selectTokenRow(dm, ogreToken.label);
    await viewport(dm).focus();
    await dm.keyboard.press('ArrowRight');
    await expect(panel(dm).getByRole('status')).toHaveText(`${ogreToken.label} moved to column 4, row 3.`);
    await expect.poll(async () => (await tvTokens(tv)).find((each) => each.id === ogreToken.id)?.x).toBe(3);
    await dm.keyboard.press('Control+z');
    await expect.poll(async () => (await tvTokens(tv)).find((each) => each.id === ogreToken.id)?.x).toBe(2);
    await expect(panel(dm).getByRole('status')).toHaveText(`Undone: ${ogreToken.label} moved back to column 3, row 3.`);

    // Move the hidden wraith and undo it: nothing of it reaches the TV.
    await selectTokenRow(dm, wraithToken.label);
    await viewport(dm).focus();
    await dm.keyboard.press('ArrowDown');
    // Announced once the server answered: the canvas draws a move before that (D-115).
    await expect(panel(dm).getByRole('status')).toHaveText(`${wraithToken.label} moved to column 6, row 5.`);
    expect((await dmTokens(dm)).find((each) => each.id === wraithToken.id)?.y).toBe(4);
    await dm.keyboard.press('Control+z');
    await expect.poll(async () => (await dmTokens(dm)).find((each) => each.id === wraithToken.id)?.y).toBe(3);
    await expect(panel(dm).getByRole('status')).toHaveText(
      `Undone: ${wraithToken.label} moved back to column 6, row 4.`,
    );
    expect(undoFrames()).toBe(2);
    for (const secret of [wraithToken.id, wraith.id, wraith.image_id, 'Wraith of LIV-05']) {
      expect(frames.join('\n'), secret).not.toContain(secret);
    }

    // Reveal the wraith, then Ctrl+Z: gone from the TV again.
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${wraithToken.label}` })
      .click();
    await expect
      .poll(async () => (await tvTokens(tv)).map((each) => each.id).sort())
      .toEqual([ogreToken.id, wraithToken.id].sort());
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([ogreToken.id]);

    // Delete the ogre after the confirmation, then Ctrl+Z: the same token is back on the TV.
    await selectTokenRow(dm, ogreToken.label);
    await tokenMenu(dm, ogreToken.label, 'Delete');
    await dm.getByRole('dialog').getByRole('button', { name: 'Delete token', exact: true }).click();
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(0);
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await expect
      .poll(async () => (await tvTokens(tv)).map(({ id, label, x, y }) => ({ id, label, x, y })))
      .toEqual([{ id: ogreToken.id, label: ogreToken.label, x: 2, y: 2 }]);

    // Move the ogre again, then Ctrl+Z while preparing the other scene: nothing is sent, and the move
    // stands. Blank TV is then sent on the same socket, after anything the key presses sent.
    await selectTokenRow(dm, ogreToken.label);
    await viewport(dm).focus();
    await dm.keyboard.press('ArrowRight');
    await expect(panel(dm).getByRole('status')).toHaveText(`${ogreToken.label} moved to column 4, row 3.`);
    await expect.poll(async () => (await tvTokens(tv)).find((each) => each.id === ogreToken.id)?.x).toBe(3);
    await sceneRow(dm, antechamber).click();
    await expect(dm.getByRole('heading', { level: 1 })).toHaveText(antechamber);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    const from = sent.length;
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await dm.keyboard.press('Control+z');
    await liveBar(dm).getByRole('button', { name: 'Go idle' }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect.poll(() => sent.slice(from).some((frame) => frame.includes('"scene.deactivate"'))).toBe(true);
    const after = sent.slice(from);
    const blank = after.findIndex((frame) => frame.includes('"scene.deactivate"'));
    expect(after.slice(0, blank).filter((frame) => frame.includes('"undo"'))).toEqual([]);
    const tokens = (await (await dm.request.get(`/api/scenes/${scene.id}/tokens`)).json()) as {
      id: string;
      x: number;
    }[];
    expect(tokens.find((each) => each.id === ogreToken.id)?.x).toBe(3);
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await dmContext.close();
    await playerContext.close();
  }
});
