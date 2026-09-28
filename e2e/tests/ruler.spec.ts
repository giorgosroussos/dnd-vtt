import { expect, test, type Page } from '@playwright/test';
import { selectScene, tree, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';

// LIV-07: the ruler against the production server (specs/06-grid-and-measurement.md §5, specs/04-live-sync.md
// §2, §3, §11, specs/08-ux-journeys.md §8, Q-027, Q-048, Q-086, Q-087, D-121). A DM context and a player
// context at once: a measurement dragged on the live scene shows its line and distance on the TV, and
// clearing it removes them; the feet per square set in the scene's setup scales it; a measurement on a
// scene that is not live reaches the TV not at all.

const player = (page: Page) => page.locator('main[data-view="player"]');
const tvCanvas = (page: Page) => page.locator('main[data-view="player"] .eg-canvas--player');
const panel = (page: Page) => page.locator('main .eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });

interface Drawn {
  from: { column: number; row: number };
  to: { column: number; row: number };
  feet: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

const rulerOf = async (locator: ReturnType<typeof viewport>): Promise<Drawn | null> =>
  JSON.parse((await locator.getAttribute('data-ruler')) ?? 'null') as Drawn | null;

/** Every event the page receives over its WebSocket, by type, in order. */
function eventsOf(page: Page): string[] {
  const events: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const frame = String(payload);
      if (!frame.startsWith('42')) return;
      const [, event] = JSON.parse(frame.slice(2)) as [string, { type: string }];
      events.push(event.type);
    });
  });
  return events;
}

test('a measurement on the live scene shows its line and distance on the TV and clearing it removes them; one in prep mode reaches no TV', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvEvents = eventsOf(tv);
  await openWorkspace(dm);

  const names = { campaign: `Ruler LIV-07 ${Date.now()}`, session: 'Measuring night', scene: 'Long hall' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const createScene = async (name: string) =>
    (await (await dm.request.post(`/api/sessions/${session!.id}/scenes`, { data: { name } })).json()) as {
      id: string;
    };
  const hall = await createScene(names.scene);
  await createScene('Crypt');
  const map = (await (
    await dm.request.post('/api/images', {
      data: solidPng(600, 400, [60, 50, 40]),
      headers: { 'content-type': 'application/octet-stream' },
    })
  ).json()) as { id: string };
  expect((await dm.request.patch(`/api/scenes/${hall.id}`, { data: { map_image_id: map.id } })).ok()).toBe(true);
  await dm.reload();

  try {
    await tv.goto('/');
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');

    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(tvCanvas(tv)).not.toHaveAttribute('data-ruler');

    // Measure by dragging on the DM's canvas, left to right across the middle of the map.
    await panel(dm).getByRole('button', { name: 'Ruler', exact: true }).click();
    await expect(viewport(dm)).toHaveAttribute('data-ruler-tool', 'on');
    // At 1,280 × 720 the canvas starts low in the page (G-022): brought into view before using the pointer.
    await viewport(dm).scrollIntoViewIfNeeded();
    const box = (await viewport(dm).boundingBox())!;
    const from = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.5 };
    const to = { x: box.x + box.width * 0.65, y: box.y + box.height * 0.6 };
    await dm.mouse.move(from.x, from.y);
    await dm.mouse.down();
    await dm.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
    await dm.mouse.move(to.x, to.y, { steps: 5 });
    await dm.mouse.up();

    // The TV draws the same squares and distance the DM sees, as a line of some length.
    await expect.poll(async () => (await rulerOf(viewport(dm)))?.feet ?? 0).toBeGreaterThan(0);
    const measuredTo = (await rulerOf(viewport(dm)))!.to;
    await expect.poll(async () => (await rulerOf(tvCanvas(tv)))?.to ?? null).toEqual(measuredTo);
    const onTv = (await rulerOf(tvCanvas(tv)))!;
    const inDm = (await rulerOf(viewport(dm)))!;
    expect(onTv.from).toEqual(inDm.from);
    expect(onTv.feet).toBe(inDm.feet);
    // An uncalibrated 600-pixel map of 30 columns: squares of 20 pixels, 5 ft each by the PHB rule.
    const squares = Math.max(Math.abs(inDm.to.column - inDm.from.column), Math.abs(inDm.to.row - inDm.from.row));
    expect(squares).toBeGreaterThan(2);
    expect(onTv.feet).toBe(squares * 5);
    expect(Math.hypot(onTv.end.x - onTv.start.x, onTv.end.y - onTv.start.y)).toBeGreaterThan(40);
    await expect(panel(dm).getByRole('status')).toHaveText(`Distance: ${onTv.feet} ft.`);

    // Feet per square set in the scene's setup: the TV's distance follows at once.
    await panel(dm).getByLabel('Feet per square').fill('10');
    await panel(dm).getByLabel('Feet per square').press('Enter');
    await expect.poll(async () => (await rulerOf(tvCanvas(tv)))?.feet).toBe(squares * 10);
    expect((await rulerOf(viewport(dm)))?.feet).toBe(squares * 10);

    // Escape on the canvas clears the measurement: gone from the TV.
    await viewport(dm).focus();
    await dm.keyboard.press('Escape');
    await expect(tvCanvas(tv)).not.toHaveAttribute('data-ruler');
    await expect(viewport(dm)).not.toHaveAttribute('data-ruler');
    await expect(panel(dm).getByRole('status')).toHaveText('Measurement cleared.');

    // By keyboard, still live: Enter starts at the centre of the view, an arrow moves the end a square.
    await dm.keyboard.press('Enter');
    await dm.keyboard.press('ArrowRight');
    await dm.keyboard.press('ArrowRight');
    await expect.poll(async () => (await rulerOf(tvCanvas(tv)))?.feet).toBe(20);
    // Turning the ruler off takes it off the TV too.
    await dm.keyboard.press('m');
    await expect(viewport(dm)).toHaveAttribute('data-ruler-tool', 'off');
    await expect(tvCanvas(tv)).not.toHaveAttribute('data-ruler');

    // Prep mode, on a scene that is not live: the DM sees the measurement, the TV receives nothing at all.
    await tree(dm).getByRole('button', { name: 'Crypt', exact: true }).click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'prep');
    const received = tvEvents.length;
    await panel(dm).getByRole('button', { name: 'Ruler', exact: true }).click();
    await viewport(dm).scrollIntoViewIfNeeded();
    const prep = (await viewport(dm).boundingBox())!;
    await dm.mouse.move(prep.x + prep.width * 0.3, prep.y + prep.height * 0.4);
    await dm.mouse.down();
    await dm.mouse.move(prep.x + prep.width * 0.6, prep.y + prep.height * 0.5, { steps: 6 });
    await dm.mouse.up();
    await expect.poll(async () => (await rulerOf(viewport(dm)))?.feet ?? 0).toBeGreaterThan(0);
    await expect(panel(dm).getByRole('status')).toHaveText(/^Distance: \d+ ft\.$/);
    // Whatever the TV might have been sent would have arrived by now: a Blank TV's event does.
    await liveBar(dm).getByRole('button', { name: 'Blank TV' }).click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'idle');
    expect(tvEvents.slice(received)).toEqual(['scene.cleared']);
  } finally {
    // Leave no campaign behind: the keyboard walk (keyboard.spec.ts) visits every control of the tree.
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    await dmContext.close();
    await playerContext.close();
  }
});
