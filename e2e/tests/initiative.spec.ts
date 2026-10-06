import { expect, test, type Page } from '@playwright/test';
import { selectScene, selectTokenRow, tokenPopover } from './canvas-view.js';
import { openWorkspace, seedCampaign } from './dm.js';
import { solidPng } from './png.js';
import { framesOf } from './journeys/support.js';

// TBL-06 and DMT-02: a whole combat against the production server (specs/04-live-sync.md §4, §14,
// specs/08-ux-journeys.md §12, Q-111, Q-117, Q-118). A DM context and a player context at once: combat started
// from two player characters and three bandits, numbers typed with a tie the DM breaks by a drag, turns passed
// with Enter across rounds, a bandit killed by its hit points and passed over, a hidden bandit revealed
// mid-fight and added with its number, the TV reloaded, the rest killed, the prompt, and combat ended. The TV's
// strip names each bandit by its label, follows the DM's order throughout, greys the dead and never carries an
// initiative number.

const player = (page: Page) => page.locator('main[data-view="player"]');
const panel = (page: Page) => page.locator('main.eg-scene');
const liveBar = (page: Page) => page.getByRole('region', { name: 'Live scene' });
const initiativeTab = (page: Page) => page.getByRole('tab', { name: /^Initiative/ });
const rows = (page: Page) => page.locator('.eg-initiative__row .eg-initiative__line .eg-initiative__name');
const rowOf = (page: Page, name: string) =>
  page.locator('.eg-initiative__row').filter({ has: page.locator('.eg-initiative__name', { hasText: name }) });
const currentRow = (page: Page) =>
  page.locator('.eg-initiative__row--current .eg-initiative__line .eg-initiative__name');
const strip = (page: Page) => page.locator('.eg-player__initiative');
const cards = (page: Page) => page.locator('.eg-player__initiative-card .eg-player__initiative-name');
const stripTurn = (page: Page) => page.locator('.eg-player__initiative-card--current .eg-player__initiative-name');
const field = (page: Page, name: string) =>
  page.locator('.eg-initiative__list').getByRole('textbox', { name: `Initiative of ${name}`, exact: true });

test('a combat runs end to end: every bandit its own row, a tie, the dead passed over, a reveal, the prompt, and the TV strip in step', async ({
  browser,
}) => {
  const dmContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const dm = await dmContext.newPage();
  const tv = await playerContext.newPage();
  const tvFrames = framesOf(tv);
  await openWorkspace(dm);

  const stamp = Date.now();
  const names = { campaign: `Initiative DMT-02 ${stamp}`, session: 'Battle night', scene: 'Ambush at the ford' };
  const campaignId = await seedCampaign(dm, names.campaign, [names.session]);
  const [session] = (await (await dm.request.get(`/api/campaigns/${campaignId}/sessions`)).json()) as { id: string }[];
  const post = async <T>(url: string, data: unknown, binary = false): Promise<T> =>
    (await (
      await dm.request.post(url, binary ? { data, headers: { 'content-type': 'application/octet-stream' } } : { data })
    ).json()) as T;
  const map = await post<{ id: string }>('/api/images', solidPng(600, 400, [60, 50, 40]), true);
  const scene = await post<{ id: string }>(`/api/sessions/${session!.id}/scenes`, {
    name: names.scene,
    map_image_id: map.id,
  });
  const assets: string[] = [];
  const asset = async (name: string, category: 'pc' | 'monster', colour: [number, number, number], fields = {}) => {
    const image = await post<{ id: string }>('/api/images', solidPng(64, 64, colour), true);
    const made = await post<{ id: string }>('/api/assets', {
      name,
      category,
      image_id: image.id,
      size: 'medium',
      default_hidden: false,
      ...fields,
    });
    assets.push(made.id);
    return made;
  };
  const place = async (assetId: string, x: number, y: number, hidden = false) => {
    const placed = await post<{ token: { id: string } }>(`/api/scenes/${scene.id}/tokens`, { asset_id: assetId, x, y });
    if (hidden) await dm.request.patch(`/api/tokens/${placed.token.id}`, { data: { hidden: true } });
    return placed.token.id;
  };
  const labelOf = async (id: string) => {
    const tokens = (await (await dm.request.get(`/api/scenes/${scene.id}/tokens`)).json()) as {
      id: string;
      label: string;
    }[];
    return tokens.find((token) => token.id === id)!.label;
  };
  const tamsin = `Tamsin ${stamp}`;
  const wren = `Wren ${stamp}`;
  await place((await asset(tamsin, 'pc', [40, 90, 160])).id, 1, 1);
  await place((await asset(wren, 'pc', [40, 160, 90])).id, 2, 1);
  // Three bandits on the ford and a fourth hidden in the reeds, each at 7 hit points.
  const bandit = await asset(`Bandit ${stamp}`, 'monster', [160, 60, 40], { hp_max: 7 });
  const banditIds = [await place(bandit.id, 6, 4), await place(bandit.id, 7, 4), await place(bandit.id, 8, 4)];
  const hiddenId = await place(bandit.id, 9, 6, true);
  const [b1, b2, b3] = (await Promise.all(banditIds.map(labelOf))) as [string, string, string];
  await dm.reload();

  // A bandit killed by its hit points from its popover (DMT-01): Dead, so its row is passed over.
  const kill = async (label: string) => {
    await selectTokenRow(dm, label);
    const hp = tokenPopover(dm).getByRole('textbox', { name: `Damage, healing or hit points of ${label}` });
    await hp.fill('-7');
    await hp.press('Enter');
    await expect(tokenPopover(dm).locator('[data-hp]')).toHaveText('0 / 7');
    await initiativeTab(dm).click();
    await expect(rowOf(dm, label)).toHaveClass(/eg-initiative__row--dead/);
  };
  // A click on the round heading takes focus off any field, so Enter passes the turn.
  const next = async () => {
    await dm.locator('.eg-initiative__round').click();
    await dm.keyboard.press('Enter');
  };

  try {
    await tv.goto('/');
    await selectScene(dm, names);
    await liveBar(dm)
      .getByRole('button', { name: `Go live: ${names.scene}` })
      .click();
    await expect(panel(dm)).toHaveAttribute('data-mode', 'live');
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');

    // Start combat: the two player characters and the three bandits players see; the hidden one has no row.
    await initiativeTab(dm).click();
    await dm.getByRole('button', { name: 'Start combat' }).click();
    await expect(rows(dm)).toHaveText([tamsin, wren, b1, b2, b3]);
    await expect(strip(tv)).toBeVisible();
    // The TV shows only the turn and the next (Q-127).
    await expect(cards(tv)).toHaveText([tamsin, wren]);
    await expect(stripTurn(tv)).toHaveText(tamsin);
    await expect(initiativeTab(dm)).toHaveText('Initiative · R1');

    // Numbers, with a tie at 12 between Wren and the first bandit: they keep their order until the DM drags.
    for (const [name, value] of [
      [tamsin, '15'],
      [wren, '12'],
      [b1, '12'],
      [b2, '8'],
      [b3, '5'],
    ] as const) {
      await field(dm, name).fill(value);
      await field(dm, name).press('Enter');
    }
    await expect(rows(dm)).toHaveText([tamsin, wren, b1, b2, b3]);
    // The mouse wheel over a number steps it, the panel unscrolled: two notches down take the last bandit's 5 to 1,
    // sent once the pointer leaves, so the panel opened again shows it from the server (Q-127).
    const box = (await field(dm, b3).boundingBox())!;
    await dm.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await dm.mouse.wheel(0, 100);
    await dm.mouse.wheel(0, 100);
    await expect(field(dm, b3)).toHaveValue('1');
    await dm.mouse.move(box.x - 200, box.y);
    await dm.getByRole('tab', { name: 'In this scene' }).click();
    await initiativeTab(dm).click();
    await expect(field(dm, b3)).toHaveValue('1');
    await expect(rows(dm)).toHaveText([tamsin, wren, b1, b2, b3]);
    await rowOf(dm, b1).dragTo(rowOf(dm, wren));
    await expect(rows(dm)).toHaveText([tamsin, b1, wren, b2, b3]);
    // While a row is dragged, the others make room before it is dropped, its slot marked; let go outside the list,
    // the order goes back and nothing is sent.
    // Measured once the drop's rows have finished sliding into place.
    await dm.waitForFunction(() =>
      [...document.querySelectorAll('.eg-initiative__row')].every((row) => row.getAnimations().length === 0),
    );
    const grab = (await rowOf(dm, b3).boundingBox())!;
    const target = (await rowOf(dm, b1).boundingBox())!;
    await dm.mouse.move(grab.x + 40, grab.y + grab.height / 2);
    await dm.mouse.down();
    await dm.mouse.move(target.x + 40, target.y + target.height / 2 - 4, { steps: 12 });
    await expect(rows(dm)).toHaveText([tamsin, b3, b1, wren, b2]);
    await expect(dm.locator('.eg-initiative__row--dragging .eg-initiative__name')).toHaveText(b3);
    await dm.mouse.move(target.x + 40, target.y - 400, { steps: 6 });
    await dm.mouse.up();
    await expect(rows(dm)).toHaveText([tamsin, b1, wren, b2, b3]);
    await expect(dm.locator('.eg-initiative__row--dragging')).toHaveCount(0);
    await expect(cards(tv)).toHaveText([tamsin, b1]);

    // The bandit's turn: its token is the turn's on the TV too.
    await expect(currentRow(dm)).toHaveText(tamsin);
    await next();
    await expect(currentRow(dm)).toHaveText(b1);
    await expect(stripTurn(tv)).toHaveText(b1);
    // The TV names the bandit by its label, in the monster ring colour; each turn replaces the two cards.
    await expect(cards(tv)).toHaveText([b1, wren]);
    await expect(tv.locator('.eg-player__initiative-card--monster')).toHaveCount(1);

    // The second bandit falls to its hit points: its turn is passed over, so the TV never names it next.
    await kill(b2);
    await next();
    await expect(currentRow(dm)).toHaveText(wren);
    await expect(cards(tv)).toHaveText([wren, b3]);
    await next();
    await expect(currentRow(dm)).toHaveText(b3);
    await expect(stripTurn(tv)).toHaveText(b3);

    // The hidden bandit has stayed off the TV; revealed mid-fight, the DM is offered it and adds it with its 10.
    expect(tvFrames.join('')).not.toContain(hiddenId);
    const hiddenLabel = await labelOf(hiddenId);
    await selectTokenRow(dm, hiddenLabel);
    await tokenPopover(dm)
      .getByRole('button', { name: `Reveal token ${hiddenLabel}` })
      .click();
    const b4 = await labelOf(hiddenId);
    await initiativeTab(dm).click();
    const offer = dm.locator('.eg-initiative__offer');
    await expect(offer).toContainText(`Add ${b4} to initiative?`);
    await offer.getByRole('textbox', { name: `Initiative of ${b4}` }).fill('10');
    await offer.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(rows(dm)).toHaveText([tamsin, b1, wren, b4, b2, b3]);
    await expect(cards(tv)).toHaveText([b3, tamsin]);
    await expect(offer).toHaveCount(0);

    // The TV reloads: the strip comes back from its snapshot, in the same order and turn.
    await tv.reload();
    await expect(player(tv)).toHaveAttribute('data-scene', 'live');
    await expect(cards(tv)).toHaveText([b3, tamsin]);
    await expect(stripTurn(tv)).toHaveText(b3);

    // The rest fall; when the turn next passes, the DM is asked, and ends combat.
    for (const label of [b1, b3, b4]) await kill(label);
    await expect(dm.locator('.eg-initiative__prompt')).toHaveCount(0);
    await next();
    await expect(currentRow(dm)).toHaveText(tamsin);
    const prompt = dm.locator('.eg-initiative__prompt');
    await expect(prompt).toHaveText(/No enemies left\. End combat\?/);
    await prompt.getByRole('button', { name: 'End combat' }).click();
    await expect(dm.getByRole('button', { name: 'Start combat' })).toBeVisible();
    await expect(strip(tv)).toHaveCount(0);

    // Nothing the TV received carried a number of the order or a hit point.
    const received = tvFrames.join('');
    expect(received).not.toContain('"initiative"');
    expect(received).not.toContain('enemies_seen');
    expect(received).not.toContain('"hp_');
  } finally {
    await liveBar(dm)
      .getByRole('button', { name: 'Go idle' })
      .click()
      .catch(() => undefined);
    const summary = await dm.request.get(`/api/campaigns/${campaignId}/deletion`);
    if (summary.ok()) {
      await dm.request.delete(`/api/campaigns/${campaignId}`, { data: { confirm: (await summary.json()) as object } });
    }
    for (const id of assets) await dm.request.delete(`/api/assets/${id}`);
    await dmContext.close();
    await playerContext.close();
  }
});
