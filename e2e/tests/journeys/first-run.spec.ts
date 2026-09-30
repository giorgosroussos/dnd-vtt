import { expect, test } from '@playwright/test';
import {
  lanAddress,
  lanWait,
  player,
  SLOW_LAN_LOAD_MS,
  startOwnServer,
  timedLanLoad,
  type OwnServer,
} from './support.js';

// Journey 1, First run (specs/10-testing-acceptance.md §5, specs/08-ux-journeys.md §10,
// specs/07-security-and-access.md §1, specs/09-operations.md §2, Q-007): start the server on an
// empty data directory, a browser on the LAN is refused setup, the PIN is set from localhost, and the
// DM view opens. The server is this journey's own, started as `npm start` starts it, so the journey
// runs in every browser of the matrix, each on a fresh data directory (D-127).

let server: OwnServer;

test.beforeEach(async () => {
  server = await startOwnServer();
});

test.afterEach(async () => {
  await server.stop();
});

test('First run: the server starts, a LAN browser cannot set the PIN, the server PC sets it and opens the DM view', async ({
  browser,
}, info) => {
  // Four loads from the LAN address, allowed longer where they are known to be slow (G-040).
  const wait = lanWait(info);
  if ('timeout' in wait) test.setTimeout(4 * SLOW_LAN_LOAD_MS + 30_000);
  const local = `http://localhost:${server.port}`;
  const lan = `http://${lanAddress()}:${server.port}`;
  // The console names the player view's address and how to set the PIN (specs/09-operations.md §2).
  await expect.poll(() => server.output()).toContain(`http://localhost:${server.port}/dm`);
  expect(server.output()).toContain('No DM PIN is set yet.');
  expect(server.output()).toMatch(new RegExp(`http://[\\d.]+:${server.port}/\\s`));

  const lanContext = await browser.newContext();
  const pcContext = await browser.newContext();
  try {
    // A browser on the LAN: told to set up on the server PC, offered nothing else, and refused.
    const guest = await lanContext.newPage();
    await timedLanLoad(info, 'the DM view from the LAN address', async () => {
      await guest.goto(`${lan}/dm`, wait);
      await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Set up on the server PC', wait);
    });
    await expect(guest.locator('main input, main button')).toHaveCount(0);
    const refused = await guest.evaluate(() =>
      fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '24681357' }),
      }).then((response) => response.status),
    );
    expect(refused).toBe(403);
    // The player view is open to it all along (specs/07-security-and-access.md §3).
    await guest.goto(`${lan}/`, wait);
    await expect(player(guest)).toHaveAttribute('data-scene', 'idle', wait);

    // On the server PC: the setup form, the PIN twice, then the DM workspace.
    const dm = await pcContext.newPage();
    await dm.goto(`${local}/dm`);
    await expect(dm.getByRole('heading', { level: 1 })).toHaveText('Set the DM PIN');
    await dm.getByLabel('PIN, 4 to 8 digits').fill('24681357');
    await dm.getByLabel('The same PIN again').fill('24681357');
    await dm.getByRole('button', { name: 'Set PIN' }).click();
    await expect(dm.getByRole('navigation', { name: 'Scenes of this session' })).toBeVisible();
    await expect(dm.getByRole('heading', { level: 1 })).toHaveText('No scene selected');

    // The LAN browser now gets the PIN form, never setup; the right PIN opens the DM view there too.
    await guest.goto(`${lan}/dm`, wait);
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Enter the DM PIN', wait);
    await guest.getByLabel('PIN', { exact: true }).fill('24681357');
    await guest.getByRole('button', { name: 'Enter' }).click();
    // The workspace's code is its own chunk, loaded from the LAN address too.
    await expect(guest.getByRole('navigation', { name: 'Scenes of this session' })).toBeVisible(wait);
    // And a second setup is refused even from the server PC.
    const again = await dm.evaluate(() =>
      fetch('/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '11112222' }),
      }).then((response) => response.status),
    );
    expect(again).toBe(409);
  } finally {
    await lanContext.close();
    await pcContext.close();
  }
});
