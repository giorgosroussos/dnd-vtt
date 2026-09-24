// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '@emberglass/shared';
import { t } from '../../ui/messages.js';
import {
  button,
  click,
  FakeServer,
  installDialog,
  settle,
  submit,
  type,
  type Reply,
} from '../../ui/testing/fakeServer.js';
import { render, type Rendered } from '../../ui/testing/render.js';
import { SceneTree } from './SceneTree.js';

// The sidebar tree (PRP-01, specs/08-ux-journeys.md §1, specs/03-domain-model.md §7,
// Q-089, Q-090, D-078, D-079, D-085), against a scripted server behind fetch.

let server: FakeServer;
let rendered: Rendered | undefined;
let selected: Scene | undefined;
const removed: string[][] = [];

beforeEach(() => {
  installDialog();
  server = new FakeServer().install();
  selected = undefined;
  removed.length = 0;
});

afterEach(() => {
  rendered?.unmount();
  rendered = undefined;
  server.uninstall();
  vi.restoreAllMocks();
});

async function open(): Promise<HTMLElement> {
  rendered = render(
    createElement(SceneTree, {
      selectedSceneId: undefined,
      onSelectScene: (scene: Scene) => (selected = scene),
      onScenesRemoved: (ids: string[]) => removed.push(ids),
      onSceneRenamed: () => undefined,
    }),
  );
  await settle();
  return rendered.container;
}

const names = (container: ParentNode, level: string) =>
  [...container.querySelectorAll(`.eg-tree__item--${level} > .eg-tree__row [data-action="name"]`)].map(
    (each) => each.textContent,
  );
const item = (container: ParentNode, id: string) => container.querySelector(`[data-item="${id}"]`)!;
const nameButton = (container: ParentNode, id: string) =>
  item(container, id).querySelector<HTMLButtonElement>('[data-action="name"]')!;
const dialog = (container: ParentNode) => container.querySelector('dialog');

function tree() {
  const mine = server.addCampaign('Lost Mine');
  const one = server.addSession(mine.id, 'One');
  const two = server.addSession(mine.id, 'Two');
  const cave = server.addScene(one.id, 'Cave', 3);
  const hall = server.addScene(one.id, 'Hall');
  const bridge = server.addScene(one.id, 'Bridge', 1);
  return { mine, one, two, cave, hall, bridge };
}

async function expandAll(view: HTMLElement, ids: string[]) {
  for (const id of ids) await click(nameButton(view, id));
}

describe('listing (Q-090, D-079)', () => {
  it('lists campaigns in the order the server gives, by name, and opens each level on demand', async () => {
    server.addCampaign('Tomb');
    const { mine, one } = tree();
    server.addCampaign('curse');
    const view = await open();
    expect(names(view, 'campaign')).toEqual(['curse', 'Lost Mine', 'Tomb']);
    expect(nameButton(view, mine.id).getAttribute('aria-expanded')).toBe('false');
    expect(server.calls.map((call) => call.path)).toEqual(['/api/campaigns']);

    await click(nameButton(view, mine.id));
    expect(nameButton(view, mine.id).getAttribute('aria-expanded')).toBe('true');
    expect(names(view, 'session')).toEqual(['One', 'Two']);
    await click(nameButton(view, one.id));
    expect(names(view, 'scene')).toEqual(['Cave', 'Hall', 'Bridge']);
    await click(nameButton(view, mine.id));
    expect(names(view, 'session')).toEqual([]);
  });

  it('says when there is nothing yet', async () => {
    const view = await open();
    expect(view.textContent).toContain(t('tree.empty'));
  });

  it('selects a scene when its name is chosen', async () => {
    const { mine, one, hall } = tree();
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    await click(nameButton(view, hall.id));
    expect(selected?.id).toBe(hall.id);
  });
});

describe('creating and renaming', () => {
  it('creates a campaign, a session and a scene, each read back from the server and focused', async () => {
    const view = await open();
    await click(button(view, t('tree.newCampaign')));
    await type(view.querySelector('input'), 'Lost Mine');
    await submit(view.querySelector('form'));
    expect(names(view, 'campaign')).toEqual(['Lost Mine']);
    const campaign = server.campaigns[0]!;
    expect(document.activeElement).toBe(nameButton(view, campaign.id));

    await click(nameButton(view, campaign.id));
    await click(button(view, t('tree.newSession')));
    await type(view.querySelector('input'), 'One');
    await submit(view.querySelector('form'));
    const session = server.sessions[0]!;
    expect(names(view, 'session')).toEqual(['One']);

    await click(nameButton(view, session.id));
    await click(button(view, t('tree.newScene')));
    await type(view.querySelector('input'), 'Cave');
    await submit(view.querySelector('form'));
    expect(names(view, 'scene')).toEqual(['Cave']);
    expect(server.writes()).toEqual([
      'POST /api/campaigns',
      `POST /api/campaigns/${campaign.id}/sessions`,
      `POST /api/sessions/${session.id}/scenes`,
    ]);
    expect(
      server.calls.find((call) => call.path === `/api/campaigns/${campaign.id}/sessions` && call.method === 'POST')
        ?.body,
    ).toEqual({ title: 'One' });
  });

  it('keeps Create disabled while its request runs, so a double click makes one entity (G-014)', async () => {
    let answer: (reply: Reply | undefined) => void = () => undefined;
    server.before = (call) =>
      call.method === 'POST' ? new Promise<Reply | undefined>((resolve) => (answer = resolve)) : undefined;
    const view = await open();
    await click(button(view, t('tree.newCampaign')));
    await type(view.querySelector('input'), 'Lost Mine');
    await submit(view.querySelector('form'));
    const create = button(view, t('tree.create'))!;
    expect(create.disabled).toBe(true);
    await click(create);
    await submit(view.querySelector('form'));
    expect(server.writes()).toEqual(['POST /api/campaigns']);
    server.before = undefined;
    answer(undefined);
    await settle();
    expect(names(view, 'campaign')).toEqual(['Lost Mine']);
    expect(server.campaigns).toHaveLength(1);
  });

  it('refuses an empty name without sending it, and Escape cancels', async () => {
    const view = await open();
    await click(button(view, t('tree.newCampaign')));
    await submit(view.querySelector('form'));
    expect(view.textContent).toContain(t('tree.nameRequired'));
    const input = view.querySelector('input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(view.querySelector('form')).toBeNull();
    expect(server.writes()).toEqual([]);
  });

  it('renames a campaign, a session and a scene, keeping focus on Rename', async () => {
    const { mine, one, cave } = tree();
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    for (const [id, name] of [
      [cave.id, 'Dark cave'],
      [one.id, 'Uno'],
      [mine.id, 'Lost Mines'],
    ] as const) {
      await click(item(view, id).querySelector('[data-action="rename"]'));
      await type(item(view, id).querySelector('input'), name);
      await submit(item(view, id).querySelector('form'));
      expect(nameButton(view, id).textContent).toBe(name);
      expect(document.activeElement).toBe(item(view, id).querySelector('[data-action="rename"]'));
    }
    expect(
      server.calls.find((call) => call.method === 'PATCH' && call.path === `/api/sessions/${one.id}`)?.body,
    ).toEqual({
      title: 'Uno',
    });
  });
});

describe('reordering (Q-089)', () => {
  it('moves a scene down and a session up by keyboard, sending the whole order, with focus kept', async () => {
    const { mine, one, two, cave, hall, bridge } = tree();
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    const down = item(view, cave.id).querySelector<HTMLButtonElement>('[data-action="down"]')!;
    expect(item(view, cave.id).querySelector<HTMLButtonElement>('[data-action="up"]')!.disabled).toBe(true);
    await click(down);
    expect(names(view, 'scene')).toEqual(['Hall', 'Cave', 'Bridge']);
    expect(server.calls.at(-1)).toEqual({
      method: 'PUT',
      path: `/api/sessions/${one.id}/scenes/order`,
      body: { ids: [hall.id, cave.id, bridge.id] },
    });
    expect(document.activeElement).toBe(item(view, cave.id).querySelector('[data-action="down"]'));

    await click(item(view, two.id).querySelector('[data-action="up"]'));
    expect(names(view, 'session')).toEqual(['Two', 'One']);
    expect(server.calls.at(-1)?.body).toEqual({ ids: [two.id, one.id] });
    // At the top Move up is off, so focus falls back to the session's name.
    expect(document.activeElement).toBe(nameButton(view, two.id));
  });

  it('moves a scene by dragging it onto a sibling', async () => {
    const { mine, one, cave, hall, bridge } = tree();
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    const row = (id: string) => item(view, id).querySelector('.eg-tree__row')!;
    expect(row(bridge.id).getAttribute('draggable')).toBe('true');
    const data = { effectAllowed: '', dropEffect: '', setData: () => undefined };
    const drag = (target: Element, name: string) => {
      const event = new Event(name, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: data });
      target.dispatchEvent(event);
      return event;
    };
    const { act } = await import('react');
    act(() => {
      drag(row(bridge.id), 'dragstart');
    });
    // A campaign row is no drop target for a scene.
    expect(drag(row(mine.id), 'dragover').defaultPrevented).toBe(false);
    expect(drag(row(cave.id), 'dragover').defaultPrevented).toBe(true);
    act(() => {
      drag(row(cave.id), 'drop');
    });
    await settle();
    expect(names(view, 'scene')).toEqual(['Bridge', 'Cave', 'Hall']);
    expect(server.calls.at(-1)?.body).toEqual({ ids: [bridge.id, cave.id, hall.id] });
  });

  it('shows the server order and a message when another browser changed the list meanwhile', async () => {
    const { mine, one, cave } = tree();
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    server.addScene(one.id, 'Added elsewhere');
    await click(item(view, cave.id).querySelector('[data-action="down"]'));
    expect(view.querySelector('[role="alert"]')?.textContent).toBe(t('error.code.order_mismatch'));
    expect(names(view, 'scene')).toEqual(['Cave', 'Hall', 'Bridge', 'Added elsewhere']);
  });

  it('offers no reordering for campaigns, which stay by name', async () => {
    const { mine } = tree();
    const view = await open();
    expect(item(view, mine.id).querySelector('[data-action="up"], [data-action="down"]')).toBeNull();
    expect(item(view, mine.id).querySelector('.eg-tree__row')!.getAttribute('draggable')).toBe('false');
  });
});

describe('deletion with its confirmation (specs/03-domain-model.md §7, D-078)', () => {
  it('states what a session deletion removes, warns that the live scene is among it, and deletes on confirm', async () => {
    const { mine, one, two, cave, hall, bridge } = tree();
    const scenes = [cave, hall, bridge];
    server.liveSceneId = cave.id;
    const view = await open();
    await expandAll(view, [mine.id, one.id]);
    await click(item(view, one.id).querySelector('[data-action="delete"]'));
    const box = dialog(view)!;
    expect(box.open).toBe(true);
    expect(box.textContent).toContain(t('delete.heading', { name: 'One' }));
    expect(box.textContent).toContain(t('delete.scenes', { count: 3 }));
    expect(box.textContent).toContain(t('delete.tokens', { count: 4 }));
    expect(box.textContent).toContain(t('delete.live'));
    await click(button(box, t('delete.confirm')));
    expect(server.calls.find((call) => call.method === 'DELETE')).toEqual({
      method: 'DELETE',
      path: `/api/sessions/${one.id}`,
      body: { confirm: { sessions: 1, scenes: 3, tokens: 4, live: true } },
    });
    expect(dialog(view)).toBeNull();
    expect(names(view, 'session')).toEqual(['Two']);
    // The workspace is told which scenes went, so it can drop a selection among them.
    expect(removed.at(-1)).toEqual(scenes.map((scene) => scene.id));
    expect(item(view, two.id)).not.toBeNull();
  });

  it('shows the new counts and deletes nothing when the tree changed after the dialog opened', async () => {
    const { mine } = tree();
    const view = await open();
    await click(item(view, mine.id).querySelector('[data-action="delete"]'));
    const box = dialog(view)!;
    expect(box.textContent).toContain(t('delete.sessions', { count: 2 }));
    expect(box.textContent).not.toContain(t('delete.live'));
    server.addSession(mine.id, 'Three');
    await click(button(box, t('delete.confirm')));
    expect(server.campaigns).toHaveLength(1);
    expect(box.textContent).toContain(t('delete.changed'));
    expect(box.textContent).toContain(t('delete.sessions', { count: 3 }));
    await click(button(box, t('delete.confirm')));
    expect(server.campaigns).toHaveLength(0);
    expect(view.textContent).toContain(t('tree.empty'));
  });

  it('cancels without deleting and returns focus to the item', async () => {
    const { mine } = tree();
    const view = await open();
    await click(item(view, mine.id).querySelector('[data-action="delete"]'));
    await click(button(dialog(view)!, t('delete.cancel')));
    expect(dialog(view)).toBeNull();
    expect(server.writes()).toEqual([]);
    expect(document.activeElement).toBe(nameButton(view, mine.id));
  });
});

describe('errors', () => {
  it('shows a failure by its catalogue message, never by its code', async () => {
    tree();
    server.before = (call) =>
      call.method === 'POST' ? { status: 500, body: { error: { code: 'internal_error', message: 'x' } } } : undefined;
    const view = await open();
    await click(button(view, t('tree.newCampaign')));
    await type(view.querySelector('input'), 'Tomb');
    await submit(view.querySelector('form'));
    const alert = view.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe(t('error.code.internal_error'));
    expect(view.textContent).not.toContain('internal_error');
    // The form stays, with its Create button usable again.
    expect(button(view, t('tree.create'))!.disabled).toBe(false);
  });
});
