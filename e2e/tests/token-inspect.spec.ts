import { expect, test } from '@playwright/test';
import { selectScene, tokenPopover, viewport } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { drawn } from './prep.js';

// UXR-06 (specs/08-ux-journeys.md §14): in a real browser, a click on a token opens its popover and a second click
// closes it, the token staying selected; the mouse resting on a token for half a second shows its read-only preview,
// with its hit points, armour class, conditions and notes, which leaving the token hides; a mouse sweeping across
// it shows none.

test('a click toggles the popover and a resting mouse previews the token', async ({ page: dm }) => {
  await openWorkspace(dm);
  const stamp = Date.now();
  const names = { campaign: `Inspect UXR-06 ${stamp}`, session: 'Prep', scene: 'Crossroads' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as {
    id: string;
  }[];
  const upload = async (width: number, height: number, colour: [number, number, number]) =>
    (await (
      await dm.request.post('/api/images', {
        data: solidPng(width, height, colour),
        headers: { 'content-type': 'application/octet-stream' },
      })
    ).json()) as { id: string };
  const scene = (await (
    await dm.request.post(`/api/sessions/${session!.id}/scenes`, {
      data: { name: names.scene, map_image_id: (await upload(600, 390, [50, 40, 30])).id },
    })
  ).json()) as { id: string };
  await dm.request.patch(`/api/scenes/${scene.id}`, {
    data: { grid: { size: 30, offset_x: 0, offset_y: 0, columns: 20, rows: 13 } },
  });
  const label = `Troll ${stamp}`;
  const asset = (await (
    await dm.request.post('/api/assets', {
      data: {
        name: label,
        image_id: (await upload(64, 64, [90, 120, 60])).id,
        category: 'monster',
        size: 'large',
        default_hidden: false,
        hp_max: 84,
        ac: 15,
      },
    })
  ).json()) as { id: string };
  const placed = (await (
    await dm.request.post(`/api/scenes/${scene.id}/tokens`, { data: { asset_id: asset.id, x: 6, y: 4 } })
  ).json()) as { token: { id: string } };
  const note = [
    'Regenerates unless burned.',
    ...Array.from({ length: 9 }, (_, n) => `Line ${n + 2} of the note.`),
  ].join('\n');
  await dm.request.put(`/api/tokens/${placed.token.id}/notes`, { data: { notes: note } });

  await dm.reload();
  await selectScene(dm, names);
  await expect.poll(async () => (await drawn(dm)).length).toBe(1);
  const token = (await drawn(dm))[0]!;
  const box = (await viewport(dm).boundingBox())!;
  const centre = [box.x + 1 + token.left + token.side / 2, box.y + 1 + token.top + token.side / 2] as const;
  const away = [box.x + 20, box.y + box.height - 20] as const;
  const preview = dm.locator('.eg-preview');

  // A click opens the popover; a second click on the same token closes it.
  await dm.mouse.click(...centre);
  await expect(tokenPopover(dm)).toBeVisible();
  // The hit points' editor: its three fields side by side within the popover, which never scrolls sideways.
  await tokenPopover(dm)
    .getByRole('button', { name: `Edit the hit points and armour class of ${label}` })
    .first()
    .click();
  const popoverBox = (await tokenPopover(dm).boundingBox())!;
  for (const name of ['Max HP', 'Temp HP', 'AC']) {
    const input = tokenPopover(dm).getByRole('textbox', { name, exact: true });
    await input.focus();
    const at = (await input.boundingBox())!;
    expect(at.x).toBeGreaterThanOrEqual(popoverBox.x);
    expect(at.x + at.width).toBeLessThanOrEqual(popoverBox.x + popoverBox.width);
    expect(await tokenPopover(dm).evaluate((element) => element.scrollLeft)).toBe(0);
  }
  await tokenPopover(dm).getByRole('button', { name: 'Cancel' }).click();
  await dm.mouse.click(...centre);
  await expect(tokenPopover(dm)).toHaveCount(0);
  await expect(dm.locator('.eg-token-row--selected')).toContainText(label);

  // A mouse sweeping across the token shows no preview.
  await dm.mouse.move(...away);
  await dm.mouse.move(centre[0] - 60, centre[1], { steps: 1 });
  await dm.mouse.move(centre[0] + 60, centre[1], { steps: 12 });
  await dm.mouse.move(...away, { steps: 4 });
  await dm.waitForTimeout(800);
  await expect(preview).toHaveCount(0);

  // Resting on it: nothing before half a second has passed, then the preview with what the DM looks up.
  await dm.mouse.move(...centre, { steps: 4 });
  await dm.waitForTimeout(200);
  await expect(preview).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-hp]')).toHaveText('84 / 84');
  await expect(preview.locator('[data-ac]')).toHaveText('15');
  // The whole note, its last line included, inside the canvas.
  await expect(preview.locator('.eg-preview__text')).toHaveText(note);
  const card = (await preview.boundingBox())!;
  expect(card.y + card.height).toBeLessThanOrEqual(box.y + box.height);
  expect(card.y).toBeGreaterThanOrEqual(box.y);
  await expect(preview).toHaveCSS('pointer-events', 'none');
  await expect(tokenPopover(dm)).toHaveCount(0);

  // Clicking through it opens the popover in its place; leaving the token hides a preview at once.
  await dm.mouse.click(...centre);
  await expect(tokenPopover(dm)).toBeVisible();
  await expect(preview).toHaveCount(0);
  await dm.mouse.click(...centre);
  await dm.mouse.move(centre[0] + 3, centre[1] + 3);
  await expect(preview).toBeVisible();
  await dm.mouse.move(...away);
  await expect(preview).toHaveCount(0);
});
