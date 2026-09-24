// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { Library, SEARCH_DELAY_MS } from './Library.js';

// The library panel (PRP-01 part 2, specs/05-assets-and-images.md §1, §4, §5, §6,
// specs/03-domain-model.md §7, D-083, D-088), against a scripted server behind fetch.

const MiB = 1024 * 1024;
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

async function open(uploadLimit = 50 * MiB): Promise<HTMLElement> {
  rendered = render(createElement(Library, { uploadLimit }));
  await settle();
  return rendered.container;
}

const names = (view: ParentNode) => [...view.querySelectorAll('.eg-library__name')].map((each) => each.textContent);
const lastQuery = () =>
  server.calls.filter((call) => call.method === 'GET' && call.path.startsWith('/api/assets')).at(-1)!.path;
const field = (root: ParentNode, label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
  const element = [...root.querySelectorAll('label')].find((each) => each.textContent === label);
  if (!element) throw new Error(`no field ${label}`);
  return document.getElementById(element.htmlFor) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
const dialog = (view: ParentNode) => view.querySelector('dialog');

async function pause(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await settle();
}

async function select(element: Element, value: string) {
  act(() => {
    Reflect.set(HTMLSelectElement.prototype, 'value', value, element);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function chooseFile(input: Element, file: File) {
  act(() => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

const png = (bytes = 100) => new File([new Uint8Array(bytes)], 'goblin.png', { type: 'image/png' });

function library() {
  server.addAsset({ name: 'Goblin', category: 'monster', size: 'small', tags: ['cave', 'goblinoid'] });
  server.addAsset({ name: 'goblin archer', category: 'monster', size: 'small', tags: ['cave', 'ranged'] });
  server.addAsset({ name: 'Innkeeper', category: 'npc', default_hidden: false, tags: ['town'] });
  server.addAsset({ name: 'Chest', category: 'object', default_hidden: false });
}

describe('listing, search and filters (specs/05-assets-and-images.md §1, D-022)', () => {
  it('lists by name as the server gives, with the thumbnail, the kind and the hidden marker', async () => {
    library();
    const view = await open();
    expect(names(view)).toEqual(['Chest', 'Goblin', 'goblin archer', 'Innkeeper']);
    const goblin = server.assets.find((asset) => asset.name === 'Goblin')!;
    const item = view.querySelector(`[data-asset="${goblin.id}"]`)!;
    expect(item.querySelector('img')!.getAttribute('src')).toBe(`/images/${goblin.image_id}/thumbnail`);
    expect(item.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(item.textContent).toContain(
      t('library.meta', { category: t('asset.category.monster'), size: t('asset.size.small') }),
    );
    expect(item.textContent).toContain(t('library.hidden'));
    const inn = server.assets.find((asset) => asset.name === 'Innkeeper')!;
    expect(view.querySelector(`[data-asset="${inn.id}"]`)!.textContent).not.toContain(t('library.hidden'));
  });

  it('says the library is empty, and that nothing matches a search', async () => {
    const view = await open();
    expect(view.textContent).toContain(t('library.empty'));
    await type(field(view, t('library.search')), 'dragon');
    await pause(SEARCH_DELAY_MS + 50);
    expect(view.textContent).toContain(t('library.noMatch'));
  });

  it('sends the search once typing pauses, and drops an answer that a newer query overtook', async () => {
    library();
    const view = await open();
    let release: (reply: Reply | undefined) => void = () => undefined;
    server.before = (call) =>
      call.path === '/api/assets?q=gob' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    await type(field(view, t('library.search')), 'gob');
    await pause(SEARCH_DELAY_MS + 50);
    await type(field(view, t('library.search')), 'inn');
    await pause(SEARCH_DELAY_MS / 2);
    // Still typing: nothing sent for the second search yet.
    expect(server.calls.some((call) => call.path === '/api/assets?q=inn')).toBe(false);
    await pause(SEARCH_DELAY_MS);
    expect(names(view)).toEqual(['Innkeeper']);
    release(undefined);
    await settle();
    expect(names(view)).toEqual(['Innkeeper']);
  });

  it('narrows by category and by every selected tag, offering the tags of the whole library', async () => {
    library();
    const view = await open();
    const tagButtons = [...view.querySelectorAll('[role="group"] button')].map((each) => each.textContent);
    expect(tagButtons).toEqual(['cave', 'goblinoid', 'ranged', 'town']);

    await select(field(view, t('library.category')), 'npc');
    expect(lastQuery()).toBe('/api/assets?category=npc');
    expect(names(view)).toEqual(['Innkeeper']);
    await select(field(view, t('library.category')), '');

    const cave = button(view, t('library.tagOf', { tag: 'cave' }))!;
    await click(cave);
    expect(cave.getAttribute('aria-pressed')).toBe('true');
    expect(names(view)).toEqual(['Goblin', 'goblin archer']);
    await click(button(view, t('library.tagOf', { tag: 'ranged' })));
    expect(lastQuery()).toBe('/api/assets?tag=cave&tag=ranged');
    expect(names(view)).toEqual(['goblin archer']);
    await click(cave);
    expect(cave.getAttribute('aria-pressed')).toBe('false');
    expect(names(view)).toEqual(['goblin archer']);
  });
});

describe('failures', () => {
  it('keeps saying the tags could not be read when the results could (review L-2)', async () => {
    library();
    // The tag list fails at once; the results answer later, as they did when their
    // success cleared the tag list's message.
    let seen = 0;
    server.before = (call) => {
      if (call.path !== '/api/assets') return undefined;
      seen += 1;
      if (seen === 1) return { status: 500, body: { error: { code: 'internal_error', message: 'x' } } };
      return new Promise<Reply | undefined>((resolve) => setTimeout(() => resolve(undefined), 30));
    };
    rendered = render(createElement(Library, { uploadLimit: 50 * MiB }));
    await pause(60);
    const view = rendered.container;
    expect(names(view)).toEqual(['Chest', 'Goblin', 'goblin archer', 'Innkeeper']);
    expect(view.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.internal_error'));
  });
});

describe('creating and editing (specs/05-assets-and-images.md §4, §5, §6)', () => {
  it('uploads the image and then creates the asset, leaving default visibility to the category (D-020)', async () => {
    const view = await open();
    await click(button(view, t('library.new')));
    const form = dialog(view)!;
    expect((field(form, t('assetForm.hidden')) as HTMLInputElement).checked).toBe(true);
    await select(field(form, t('assetForm.category')), 'npc');
    expect((field(form, t('assetForm.hidden')) as HTMLInputElement).checked).toBe(false);
    await select(field(form, t('assetForm.category')), 'monster');
    const file = png();
    await chooseFile(field(form, t('assetForm.image')), file);
    await type(field(form, t('assetForm.name')), 'Goblin');
    await select(field(form, t('assetForm.size')), 'small');
    await type(field(form, t('assetForm.tags')), ' Cave, goblinoid ,, ');
    await submit(form.querySelector('form'));

    expect(server.writes()).toEqual(['POST /api/images', 'POST /api/assets']);
    expect(server.uploads).toEqual([file]);
    const created = server.calls.find((call) => call.method === 'POST' && call.path === '/api/assets')!.body;
    expect(created).toEqual({
      name: 'Goblin',
      category: 'monster',
      size: 'small',
      tags: ['Cave', 'goblinoid'],
      notes: '',
      image_id: server.images[0]!.id,
    });
    expect(dialog(view)).toBeNull();
    expect(names(view)).toEqual(['Goblin']);
    expect(view.querySelector('[role="group"]')!.textContent).toBe('cavegoblinoid');
  });

  it('sends default_hidden when the DM sets it', async () => {
    const view = await open();
    await click(button(view, t('library.new')));
    const form = dialog(view)!;
    await chooseFile(field(form, t('assetForm.image')), png());
    await type(field(form, t('assetForm.name')), 'Mimic');
    await click(field(form, t('assetForm.hidden')));
    await submit(form.querySelector('form'));
    const created = server.calls.find((call) => call.path === '/api/assets' && call.method === 'POST')!.body;
    expect(created).toMatchObject({ category: 'monster', default_hidden: false });
  });

  it('refuses a file over the upload limit before sending anything, naming its size and the limit (G-017)', async () => {
    const view = await open(1 * MiB);
    await click(button(view, t('library.new')));
    const form = dialog(view)!;
    await chooseFile(field(form, t('assetForm.image')), png(1.5 * MiB));
    const message = t('assetForm.tooLarge', { size: '1.5', limit: '1' });
    expect(form.textContent).toContain(message);
    await type(field(form, t('assetForm.name')), 'Map');
    await submit(form.querySelector('form'));
    expect(form.textContent).toContain(message);
    expect(server.writes()).toEqual([]);
  });

  it('asks for an image and a name before sending', async () => {
    const view = await open();
    await click(button(view, t('library.new')));
    await submit(dialog(view)!.querySelector('form'));
    expect(dialog(view)!.textContent).toContain(t('assetForm.imageRequired'));
    expect(dialog(view)!.textContent).toContain(t('assetForm.nameRequired'));
    expect(server.writes()).toEqual([]);
  });

  it('shows an upload refused by the server by its message, creating nothing, and allows another try', async () => {
    server.before = (call) =>
      call.path === '/api/images'
        ? { status: 415, body: { error: { code: 'unsupported_media_type', message: 'x' } } }
        : undefined;
    const view = await open();
    await click(button(view, t('library.new')));
    const form = dialog(view)!;
    await chooseFile(field(form, t('assetForm.image')), png());
    await type(field(form, t('assetForm.name')), 'Goblin');
    await submit(form.querySelector('form'));
    expect(form.querySelector('[role="alert"]')!.textContent).toBe(t('error.code.unsupported_media_type'));
    expect(server.writes()).toEqual(['POST /api/images']);
    expect(button(form, t('assetForm.save'))!.disabled).toBe(false);
  });

  it('keeps Save disabled while the request runs', async () => {
    let release: (reply: Reply | undefined) => void = () => undefined;
    server.before = (call) =>
      call.path === '/api/images' ? new Promise<Reply | undefined>((resolve) => (release = resolve)) : undefined;
    const view = await open();
    await click(button(view, t('library.new')));
    const form = dialog(view)!;
    await chooseFile(field(form, t('assetForm.image')), png());
    await type(field(form, t('assetForm.name')), 'Goblin');
    await submit(form.querySelector('form'));
    expect(button(form, t('assetForm.save'))!.disabled).toBe(true);
    await submit(form.querySelector('form'));
    expect(server.writes()).toEqual(['POST /api/images']);
    server.before = undefined;
    release(undefined);
    await settle();
    expect(server.assets).toHaveLength(1);
  });

  it('edits an asset, keeping its image without a new file and changing it with one (05 §5)', async () => {
    library();
    const view = await open();
    const goblin = server.assets.find((asset) => asset.name === 'Goblin')!;
    const oldImage = goblin.image_id;
    await click(button(view, t('library.editOf', { name: 'Goblin' })));
    let form = dialog(view)!;
    expect((field(form, t('assetForm.name')) as HTMLInputElement).value).toBe('Goblin');
    expect((field(form, t('assetForm.tags')) as HTMLInputElement).value).toBe('cave, goblinoid');
    await type(field(form, t('assetForm.name')), 'Goblin boss');
    // An existing asset's flag does not follow its category (D-083).
    await select(field(form, t('assetForm.category')), 'npc');
    expect((field(form, t('assetForm.hidden')) as HTMLInputElement).checked).toBe(true);
    await submit(form.querySelector('form'));
    expect(server.calls.at(-3)).toMatchObject({
      method: 'PATCH',
      body: { name: 'Goblin boss', category: 'npc', default_hidden: true, tags: ['cave', 'goblinoid'] },
    });
    expect(goblin.image_id).toBe(oldImage);
    expect(names(view)).toContain('Goblin boss');

    await click(button(view, t('library.editOf', { name: 'Goblin boss' })));
    form = dialog(view)!;
    await chooseFile(field(form, t('assetForm.replaceImage')), png());
    await submit(form.querySelector('form'));
    expect(server.writes().slice(-2)).toEqual(['POST /api/images', `PATCH /api/assets/${goblin.id}`]);
    expect(goblin.image_id).toBe(server.images.at(-1)!.id);
    expect(goblin.image_id).not.toBe(oldImage);
  });
});

describe('deleting (specs/03-domain-model.md §7, D-083)', () => {
  it('deletes an unused asset after the confirmation', async () => {
    library();
    const view = await open();
    await click(button(view, t('library.deleteOf', { name: 'Chest' })));
    expect(dialog(view)!.textContent).toContain(t('assetDelete.intro'));
    await click(button(dialog(view)!, t('assetDelete.confirm')));
    expect(dialog(view)).toBeNull();
    expect(names(view)).toEqual(['Goblin', 'goblin archer', 'Innkeeper']);
  });

  it('moves focus to New asset once the asset it was on is deleted (review L-1)', async () => {
    library();
    const view = await open();
    await click(button(view, t('library.deleteOf', { name: 'Chest' })));
    await click(button(dialog(view)!, t('assetDelete.confirm')));
    expect(document.activeElement).toBe(button(view, t('library.new')));
  });

  it('lists every scene that uses an asset in use, deletes nothing and offers only Close', async () => {
    library();
    const goblin = server.assets.find((asset) => asset.name === 'Goblin')!;
    const usage = (scene: string, session: string, campaign: string, tokens: number) => ({
      scene_id: `00000000-0000-4000-8000-0000000${String(tokens).padStart(5, '0')}`,
      scene_name: scene,
      session_id: '00000000-0000-4000-8000-00000000aaaa',
      session_title: session,
      campaign_id: '00000000-0000-4000-8000-00000000bbbb',
      campaign_name: campaign,
      tokens,
    });
    server.usages[goblin.id] = [usage('Cave', 'One', 'Lost Mine', 3), usage('Tower', 'Two', 'Zeta', 1)];
    const view = await open();
    await click(button(view, t('library.deleteOf', { name: 'Goblin' })));
    const box = dialog(view)!;
    await click(button(box, t('assetDelete.confirm')));
    expect(box.textContent).toContain(t('assetDelete.inUse', { name: 'Goblin' }));
    const lines = [...box.querySelectorAll('li')].map((each) => each.textContent);
    expect(lines).toEqual([
      t('assetDelete.usage', { campaign: 'Lost Mine', session: 'One', scene: 'Cave', tokens: 3 }),
      t('assetDelete.usage', { campaign: 'Zeta', session: 'Two', scene: 'Tower', tokens: 1 }),
    ]);
    expect(button(box, t('assetDelete.confirm'))).toBeUndefined();
    expect(server.assets).toHaveLength(4);
    await click(button(box, t('assetDelete.close')));
    expect(dialog(view)).toBeNull();
    expect(names(view)).toContain('Goblin');
  });
});
