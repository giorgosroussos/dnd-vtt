// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { t } from '../ui/messages.js';
import { button, click, FakeServer, installDialog, settle, submit, type } from '../ui/testing/fakeServer.js';
import { render, type Rendered } from '../ui/testing/render.js';
import { Workspace } from './Workspace.js';

// The live bar (PRP-01 part 2, specs/08-ux-journeys.md §1, specs/03-domain-model.md §7,
// D-088), inside the workspace that feeds it, against a scripted server.

let server: FakeServer;
let rendered: Rendered | undefined;

beforeEach(() => {
  installDialog();
  server = new FakeServer().install();
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
});

async function open(): Promise<HTMLElement> {
  rendered = render(createElement(Workspace, { mainId: 'main' }));
  await settle();
  return rendered.container;
}

const bar = (view: HTMLElement) =>
  view.querySelector(`section[aria-label="${t('liveBar.label')}"] [role="status"]`)!.textContent;

describe('the live bar', () => {
  it('says nothing is live', async () => {
    const view = await open();
    expect(bar(view)).toBe(t('liveBar.none'));
  });

  it('names the live scene', async () => {
    const session = server.addSession(server.addCampaign('Lost Mine').id, 'One');
    server.liveSceneId = server.addScene(session.id, 'Cave').id;
    const view = await open();
    expect(bar(view)).toBe(t('liveBar.live', { name: 'Cave' }));
  });

  it('says nothing is live once the live scene is deleted from the tree (03 §7)', async () => {
    const campaign = server.addCampaign('Lost Mine');
    const session = server.addSession(campaign.id, 'One');
    const cave = server.addScene(session.id, 'Cave');
    server.liveSceneId = cave.id;
    const view = await open();
    await click(view.querySelector(`[data-item="${campaign.id}"] [data-action="name"]`));
    await click(view.querySelector(`[data-item="${session.id}"] [data-action="name"]`));
    await click(view.querySelector(`[data-item="${cave.id}"] [data-action="delete"]`));
    expect(view.querySelector('dialog')!.textContent).toContain(t('delete.live'));
    await click(button(view.querySelector('dialog')!, t('delete.confirm')));
    expect(bar(view)).toBe(t('liveBar.none'));
  });

  it('names the live scene again after it is renamed', async () => {
    const campaign = server.addCampaign('Lost Mine');
    const session = server.addSession(campaign.id, 'One');
    const cave = server.addScene(session.id, 'Cave');
    server.liveSceneId = cave.id;
    const view = await open();
    await click(view.querySelector(`[data-item="${campaign.id}"] [data-action="name"]`));
    await click(view.querySelector(`[data-item="${session.id}"] [data-action="name"]`));
    await click(view.querySelector(`[data-item="${cave.id}"] [data-action="rename"]`));
    await type(view.querySelector(`[data-item="${cave.id}"] input`), 'Dark cave');
    await submit(view.querySelector(`[data-item="${cave.id}"] form`));
    await settle();
    expect(bar(view)).toBe(t('liveBar.live', { name: 'Dark cave' }));
  });
});
