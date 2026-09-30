import { expect, test, type Page } from '@playwright/test';
import {
  onScreen,
  openSetup,
  sceneRow,
  selectScene,
  selectTokenRow,
  tokenMenu,
  tokenPopover,
  viewport,
} from '../canvas-view.js';
import { openWorkspace, seedCampaign } from '../dm.js';
import { pick } from '../prep.js';
import { solidPng } from '../png.js';
import { commandFromPage } from '../socket.js';
import { deleteAssets, deleteCampaign, liveBar, panel, player, tvCanvas, tvTokens, unique } from './support.js';

// Journey 4, Run (specs/10-testing-acceptance.md §5, specs/08-ux-journeys.md §2, §10, specs/04-live-sync.md
// §2–§4, §8, §9, §11, Q-024, Q-027, Q-080), in one test with a DM context and a player context, which is
// Phase 3's remaining exit criterion (specs/13-implementation-plan.md §6): go live, move, reveal, hide,
// delete, undo, measure on the TV, steer the TV camera, edit the next scene in prep mode with nothing
// reaching the TV, go live on it, and Blank TV. The scenes are seeded over REST; preparing them in the
// browser is journey 2.

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const tvCamera = async (page: Page): Promise<Camera> =>
  tvCanvas(page).evaluate((element: HTMLElement) => ({
    x: Number(element.dataset.cameraX),
    y: Number(element.dataset.cameraY),
    scale: Number(element.dataset.cameraScale),
  }));
const rulerOf = async (locator: ReturnType<typeof viewport>): Promise<{ feet: number } | null> =>
  JSON.parse((await locator.getAttribute('data-ruler')) ?? 'null') as { feet: number } | null;

/** The Socket.io event frames a page receives: engine pings and acknowledgements left out. */
function eventFramesOf(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framereceived', ({ payload }) => {
      if (String(payload).startsWith('42')) frames.push(String(payload));
    }),
  );
  return frames;
}

test('Run: go live, move, reveal, hide, delete, undo, measure, steer the TV, prepare the next scene unseen, go live on it, Blank TV', async ({
  browser,
}, info) => {
  // A long journey: WebKit and Firefox on the CI runners take more than the default 30 s for it, as they do
  // for Prepare; on Windows WebKit it ran out during the final cleanup, every step passed (CI, PR #26).
  if (['webkit', 'firefox'].includes(info.project.name)) test.setTimeout(90_000);
  const dmContext = await browser.newContext();
  const tvContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await tvContext.newPage();
  await openWorkspace(dm);

  const upload = async (width: number, height: number, colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const names = { campaign: unique(info, 'Run journey'), session: 'Game night', scene: 'Vault' };
  const next = 'Crypt';
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const createScene = async (name: string) =>
    (await (await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).json()) as {
      id: string;
    };
  const vault = await createScene(names.scene);
  const crypt = await createScene(next);
  const map = await upload(600, 400, [30, 50, 70]);
  expect(
    (
      await dm.request.patch(`/api/scenes/${vault.id}`, {
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
    ).json()) as { id: string; image_id: string; name: string };
  const knight = await asset(unique(info, 'Knight'), [230, 200, 30], false);
  const shade = await asset(unique(info, 'Shade'), [120, 20, 160], true);
  const ghoul = await asset(unique(info, 'Ghoul'), [40, 160, 60], false);
  const place = async (assetId: string, x: number, y: number) =>
    (
      (await (
        await dm.request.post(`/api/scenes/${vault.id}/tokens`, { data: { asset_id: assetId, x, y } })
      ).json()) as { token: { id: string; label: string } }
    ).token;
  const knightToken = await place(knight.id, 2, 2);
  const shadeToken = await place(shade.id, 6, 3);
  await dm.reload();

  const tvFrames = eventFramesOf(tv);
  const requested: string[] = [];
  tv.on('request', (request) => requested.push(new URL(request.url()).pathname));

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');

    // Go live on the scene being edited: the TV draws it with the visible knight only.
    await selectScene(dm, names);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(dm.locator('.eg-scene__canvas--live')).toBeVisible();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([knightToken.id]);
    for (const secret of [shadeToken.id, shade.id, shade.image_id, shade.name]) {
      expect(tvFrames.join('\n'), secret).not.toContain(secret);
    }

    // Move the knight one square right.
    await selectTokenRow(dm, knightToken.label);
    await viewport(dm).focus();
    await dm.keyboard.press('ArrowRight');
    await expect.poll(async () => (await tvTokens(tv)).find((each) => each.id === knightToken.id)?.x).toBe(3);

    // Reveal the shade: now on the TV.
    await selectTokenRow(dm, shadeToken.label);
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${shadeToken.label}` })
      .click();
    await expect
      .poll(async () => (await tvTokens(tv)).map((each) => each.id).sort())
      .toEqual([knightToken.id, shadeToken.id].sort());
    const shadeShown = (await tvTokens(tv)).find((each) => each.id === shadeToken.id)!.label;

    // Hide the knight: gone from the TV.
    await selectTokenRow(dm, knightToken.label);
    await tokenPopover(dm)
      .getByRole('button', { name: `Hide token ${knightToken.label}` })
      .click();
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([shadeToken.id]);

    // Delete the shade after the confirmation, then undo it: the same token is back on the TV.
    await selectTokenRow(dm, shadeShown);
    await tokenMenu(dm, shadeShown, 'Delete');
    await dm.getByRole('dialog').getByRole('button', { name: 'Delete token', exact: true }).click();
    await expect.poll(async () => (await tvTokens(tv)).length).toBe(0);
    await viewport(dm).focus();
    await dm.keyboard.press('Control+z');
    await expect
      .poll(async () => (await tvTokens(tv)).map(({ id, label, x, y }) => ({ id, label, x, y })))
      .toEqual([{ id: shadeToken.id, label: shadeShown, x: 6, y: 3 }]);

    // Measure: the line and its distance are drawn on the TV, as the DM sees them; Escape clears it.
    await panel(dm).getByRole('button', { name: 'Ruler, M' }).click();
    await expect(viewport(dm)).toHaveAttribute('data-ruler-tool', 'on');
    await viewport(dm).scrollIntoViewIfNeeded();
    const box = (await viewport(dm).boundingBox())!;
    const [from, to] = (await onScreen(dm, [
      [box.x + box.width * 0.35, box.y + box.height * 0.5],
      [box.x + box.width * 0.65, box.y + box.height * 0.6],
    ])) as [[number, number], [number, number]];
    await dm.mouse.move(...from);
    await dm.mouse.down();
    await dm.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
    await dm.mouse.move(...to, { steps: 5 });
    await dm.mouse.up();
    await expect.poll(async () => (await rulerOf(viewport(dm)))?.feet ?? 0).toBeGreaterThan(0);
    const feet = (await rulerOf(viewport(dm)))!.feet;
    await expect.poll(async () => (await rulerOf(tvCanvas(tv)))?.feet).toBe(feet);
    await viewport(dm).focus();
    await dm.keyboard.press('Escape');
    await expect(tvCanvas(tv)).not.toHaveAttribute('data-ruler');
    await dm.keyboard.press('m');
    await expect(viewport(dm)).toHaveAttribute('data-ruler-tool', 'off');

    // Steer the TV camera with its buttons (UIX-01): TV zoom out zooms the TV out while the DM's own view
    // stays; Fit map fits it again.
    const fitted = await tvCamera(tv);
    const own = await viewport(dm).getAttribute('data-camera-scale');
    await dm.getByRole('button', { name: 'TV zoom out' }).click();
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeLessThan(fitted.scale * 0.9);
    expect(await viewport(dm).getAttribute('data-camera-scale')).toBe(own);
    await dm.getByRole('button', { name: 'Fit map on the TV' }).click();
    await expect.poll(async () => (await tvCamera(tv)).scale).toBeCloseTo(fitted.scale, 4);

    // Prepare the next scene in prep mode: a token placed through the picker and its grid hidden
    // from players. Nothing of it reaches the TV, which keeps the live scene.
    const heard = tvFrames.length;
    const gridBefore = await tvCanvas(tv).getAttribute('data-grid');
    await sceneRow(dm, next).click();
    await expect(dm.getByRole('heading', { level: 1 })).toHaveText(next);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await expect(liveBar(dm).getByRole('status')).toHaveText(`Players see ${names.scene}`);
    await pick(dm, ghoul.name);
    await expect(viewport(dm)).toBeFocused();
    await dm.keyboard.press('Enter');
    await expect(dm.locator('main [role="status"]')).toHaveText(`${ghoul.name} placed.`);
    await openSetup(dm);
    await panel(dm).getByLabel('Players see the grid').uncheck();
    await expect
      .poll(
        async () =>
          ((await (await dm.request.get(`/api/scenes/${crypt.id}`)).json()) as { grid: { visible: boolean } }).grid
            .visible,
      )
      .toBe(false);
    const [ghoulToken] = (await (await dm.request.get(`/api/scenes/${crypt.id}/tokens`)).json()) as { id: string }[];
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    expect((await tvTokens(tv)).map((each) => each.id)).toEqual([shadeToken.id]);
    expect(requested.some((path) => path.includes(ghoul.image_id))).toBe(false);
    // Hiding the grid of the scene being prepared left the live scene's grid on the TV as it was.
    expect(await tvCanvas(tv).getAttribute('data-grid')).toBe(gridBefore);

    // Go live on it: the TV switches to the next scene and draws its token, fitted afresh.
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${next}` })
      .click();
    await expect(liveBar(dm).getByRole('status')).toHaveText(`Players see ${next}`);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect.poll(async () => (await tvTokens(tv)).map((each) => each.id)).toEqual([ghoulToken!.id]);
    await expect(tvCanvas(tv)).toHaveAttribute('data-grid', 'none');
    // What the TV heard since the prep edits began: nothing at all before the activation's snapshot.
    // Its socket delivers in the order the server sent, so any frame the edits had caused would come
    // first; the order proves it without waiting on a clock (review M4).
    const since = tvFrames.slice(heard);
    expect(since.length).toBeGreaterThan(0);
    expect(since[0]).toContain('"scene.snapshot"');
    // The next scene's, by its token: a players' snapshot names no scene.
    expect(since[0]).toContain(ghoulToken!.id);

    // Blank TV: the idle screen, and the canvas back in prep mode.
    await liveBar(dm).getByRole('button', { name: 'Go idle' }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    await expect(player(tv)).toHaveText(/^Emberglass\s*The table is set\. Waiting for the Dungeon Master\.$/);
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    await expect(liveBar(dm).getByRole('status')).toHaveText('Nothing is live. The TV shows the idle screen.');
  } finally {
    await commandFromPage(dm, 'scene.deactivate', {}).catch(() => undefined);
    await deleteCampaign(dm, campaignId);
    await deleteAssets(dm, [knight.id, shade.id, ghoul.id]);
    await dmContext.close();
    await tvContext.close();
  }
});
