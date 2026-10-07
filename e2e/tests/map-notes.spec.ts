import { expect, test, type Page } from '@playwright/test';
import { selectScene, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// UXR-08 (specs/08-ux-journeys.md §14, specs/04-live-sync.md §4, §16, Q-128) against the production server, a DM
// context and a TV context at once: a map note placed from the rail on a prepared scene, its text typed and saved,
// still there after a reload; dragged to another square; its whole text previewed when the mouse rests on it; its
// popover toggled by two clicks; edited on the live scene; deleted after being asked. The TV never receives its text,
// its id or any map-notes key, before or after the scene goes live.

interface DrawnNote {
  id: string;
  x: number;
  y: number;
  left: number;
  top: number;
}
const notes = async (page: Page): Promise<DrawnNote[]> =>
  JSON.parse((await viewport(page).getAttribute('data-map-notes')) ?? '[]') as DrawnNote[];
const player = (page: Page) => page.locator('main[data-view="player"]');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const notePopover = (page: Page) => page.locator('.eg-note-popover');

test('a map note is placed, written, moved, previewed, toggled, edited live and deleted, and never reaches the TV', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const tvContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await tvContext.newPage();
  const tvFrames = framesOf(tv);
  try {
    await openWorkspace(dm);
    const stamp = Date.now();
    const names = { campaign: `Map notes UXR-08 ${stamp}`, session: 'Prep', scene: 'Sunken temple' };
    const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
    const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
      id: string;
    }[];
    const map = (await (
      await dm.request.post('/api/images', {
        data: solidPng(600, 390, [40, 50, 60]),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
    const scene = (await (
      await dm.request.post(`/api/sessions/${session!.id}/scenes`, {
        data: { name: names.scene, map_image_id: map.id },
      })
    ).json()) as { id: string };
    await dm.request.patch(`/api/scenes/${scene.id}`, {
      data: { grid: { size: 30, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
    });
    await tv.goto('/');
    await dm.reload();
    await selectScene(dm, names);
    const box = (await viewport(dm).boundingBox())!;
    const screenOf = (note: DrawnNote) => [box.x + 1 + note.left, box.y + 1 + note.top] as const;

    // Placed from the rail by a click on the map; its popover opens with the cursor in its text.
    await dm.getByRole('button', { name: 'Add note, O' }).click();
    await expect(dm.getByRole('button', { name: 'Add note, O' })).toHaveAttribute('aria-pressed', 'true');
    await dm.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(notePopover(dm)).toBeVisible();
    const text = ['Secret: the third statue turns.', 'Behind it, the stair down.', 'DC 15 to spot.'].join('\n');
    const field = notePopover(dm).getByRole('textbox', { name: 'Map note text' });
    await expect(field).toBeFocused();
    await field.fill(text);
    await expect(notePopover(dm)).toContainText('Saved');
    await expect.poll(async () => (await notes(dm)).length).toBe(1);
    const [placed] = await notes(dm);
    // At the centre of a square.
    expect(placed!.x % 1).toBe(0.5);
    expect(placed!.y % 1).toBe(0.5);

    // Still there after a reload, where it was; its text, read back from the server, is what the preview below shows.
    await dm.reload();
    await selectScene(dm, names);
    await expect.poll(async () => (await notes(dm)).length).toBe(1);
    expect((await notes(dm))[0]).toMatchObject({ id: placed!.id, x: placed!.x, y: placed!.y });

    // Dragged three squares right, snapped to that square's centre.
    const [before] = await notes(dm);
    const from = screenOf(before!);
    // A square on screen: the 600 × 390 map fitted to the canvas, 30 px squares.
    const square = 30 * Math.min(box.width / 600, box.height / 390);
    await dm.mouse.move(...from);
    await dm.mouse.down();
    await dm.mouse.move(from[0] + 3 * square, from[1], { steps: 8 });
    await dm.mouse.up();
    await expect.poll(async () => (await notes(dm))[0]!.x).toBe(before!.x + 3);
    expect((await notes(dm))[0]!.y).toBe(before!.y);

    // Resting on it: the whole note, read-only, after half a second.
    const [moved] = await notes(dm);
    const at = screenOf(moved!);
    await dm.mouse.move(box.x + 10, box.y + box.height - 10);
    await dm.mouse.move(...at, { steps: 4 });
    const preview = dm.locator('.eg-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.eg-preview__text')).toHaveText(text);
    await expect(preview).toHaveCSS('pointer-events', 'none');

    // A click opens its popover, a second click closes it; the note stays.
    await dm.mouse.click(...at);
    await expect(notePopover(dm)).toBeVisible();
    await expect(preview).toHaveCount(0);
    await dm.mouse.click(...at);
    await expect(notePopover(dm)).toHaveCount(0);
    expect(await notes(dm)).toHaveLength(1);

    // Live: the TV shows the scene, and the note is edited there.
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    // Live, the TV camera's bar sits above the canvas, which moves down: the note is found again where it is drawn.
    const liveBox = (await viewport(dm).boundingBox())!;
    const [shown] = await notes(dm);
    await dm.mouse.click(liveBox.x + 1 + shown!.left, liveBox.y + 1 + shown!.top);
    const live = 'The temple floods on round 4.';
    await notePopover(dm).getByRole('textbox', { name: 'Map note text' }).fill(live);
    await expect(notePopover(dm)).toContainText('Saved');

    // The TV never received any of it, nor learnt there is a note at all, and draws nothing of it.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(tv.locator('body')).not.toContainText('statue');
    await expect(tv.locator('body')).not.toContainText('floods');
    const received = tvFrames.join('');
    for (const secret of ['third statue', 'floods', 'map_notes', 'mapNotes', 'map-note', moved!.id]) {
      expect(received, secret).not.toContain(secret);
    }
    expect(await tv.locator('.eg-canvas--player').getAttribute('data-map-notes')).toBeNull();

    // Deleted after being asked.
    await notePopover(dm).getByRole('button', { name: 'Delete note' }).click();
    await notePopover(dm).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(notePopover(dm)).toHaveCount(0);
    await expect.poll(async () => (await notes(dm)).length).toBe(0);
  } finally {
    await dmContext.close();
    await tvContext.close();
  }
});
