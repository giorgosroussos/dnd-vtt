import { expect, type Page } from '@playwright/test';

// Signing the page's browser context in as the DM through the API, for the tests
// that are not about signing in (PRP-01, D-086). The context's request client
// shares the page's cookies; it sends no Origin, which the server accepts
// (D-076). `first-run.spec.ts` sets this PIN through the DM view before any other
// test runs.
export const E2E_PIN = '482613';

export async function signIn(page: Page): Promise<void> {
  const setup = (await (await page.request.get('/api/setup')).json()) as { pin_set: boolean };
  if (!setup.pin_set) {
    expect((await page.request.post('/api/setup', { data: { pin: E2E_PIN } })).ok()).toBe(true);
    return;
  }
  const response = await page.request.post('/api/auth', { data: { pin: E2E_PIN } });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Opens the signed-in workspace. */
export async function openWorkspace(page: Page): Promise<void> {
  await signIn(page);
  await page.goto('/dm');
  await expect(page.getByRole('navigation', { name: 'Campaigns, sessions and scenes' })).toBeVisible();
}

/** Creates a campaign with sessions through the API; answers the campaign id. */
export async function seedCampaign(page: Page, name: string, sessions: string[] = []): Promise<string> {
  const campaign = (await (await page.request.post('/api/campaigns', { data: { name } })).json()) as { id: string };
  for (const title of sessions) {
    expect((await page.request.post(`/api/campaigns/${campaign.id}/sessions`, { data: { title } })).ok()).toBe(true);
  }
  return campaign.id;
}
