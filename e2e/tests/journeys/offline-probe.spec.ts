import { expect, test } from '@playwright/test';
import { attempts, probeUrl } from '../../offline/log.js';
import { player } from './support.js';

// Part of the offline run (specs/10-testing-acceptance.md §6, D-127, review H2): in every browser of
// the matrix, a view's request beyond the local host fails and is recorded, with that browser's user
// agent, by the proxy the browser is launched with. Without it an empty log in offline.spec.ts could
// mean a browser went round the proxy, not that nothing was sent.

test('@gate:offline-e2e a view’s request beyond the local host is refused and recorded in this browser', async ({
  page,
}, info) => {
  const url = probeUrl(info.project.name);
  await page.goto('/');
  await expect(player(page)).toHaveAttribute('data-scene', /idle|live/);
  const outcome = await page.evaluate(
    (src) =>
      new Promise<string>((resolve) => {
        const image = new Image();
        image.onload = () => resolve('loaded');
        image.onerror = () => resolve('failed');
        image.src = src;
      }),
    url,
  );
  expect(outcome).toBe('failed');
  const agent = await page.evaluate(() => navigator.userAgent);
  await expect
    .poll(() => attempts().filter((each) => each.from === 'browser' && each.target === `GET ${url}`))
    .toEqual([expect.objectContaining({ kind: 'request', agent })]);
});
