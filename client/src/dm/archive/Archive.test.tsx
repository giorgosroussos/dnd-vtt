// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportSummary } from '@emberglass/shared';
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
import { Library } from '../library/Library.js';
import { SettingsDialog } from '../SettingsDialog.js';
import { SceneTree } from '../tree/SceneTree.js';
import { ImportDialog, PROGRESS_POLL_MS, summaryText } from './ImportDialog.js';

// DMT-05 in the DM view (specs/08-ux-journeys.md §13, specs/09-operations.md §7, §9, Q-115, Q-119): Import with its
// progress, what it added and reused or why it was refused; Export of a campaign from the tree and of library assets,
// selected or all; the import limit in Settings. Against the scripted server behind fetch and XMLHttpRequest.

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

const dialog = () => document.querySelector('dialog');
const fileInput = () => dialog()!.querySelector<HTMLInputElement>('input[type="file"]')!;
const zip = () => new File([new Uint8Array(400)], 'Curse of the Fallen-2026-10-05.zip', { type: 'application/zip' });

async function chooseFile(input: Element, file: File) {
  act(() => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function pause(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await settle();
}

const campaignSummary: ImportSummary = {
  kind: 'campaign',
  campaign: { id: '00000000-0000-4000-8000-0000000000c1', name: 'Curse of the Fallen' },
  sessions: 3,
  scenes: 12,
  tokens: 45,
  assets: { added: 4, reused: 8 },
  images: { added: 6, reused: 20 },
};

describe('the import summary', () => {
  it('says what a campaign import added and reused, as the DM reads it', () => {
    expect(summaryText(campaignSummary)).toBe(
      'Imported Curse of the Fallen: 3 sessions, 12 scenes, 45 tokens · 4 new assets, 8 reused · 20 images reused, 6 new',
    );
    expect(
      summaryText({
        ...campaignSummary,
        sessions: 1,
        scenes: 1,
        tokens: 1,
        assets: { added: 1, reused: 0 },
        images: { added: 0, reused: 1 },
      }),
    ).toBe('Imported Curse of the Fallen: 1 session, 1 scene, 1 token · 1 new asset, 0 reused · 1 image reused, 0 new');
    expect(summaryText({ ...campaignSummary, kind: 'assets', campaign: null, sessions: 0, scenes: 0, tokens: 0 })).toBe(
      'Imported library assets: 4 new assets, 8 reused · 20 images reused, 6 new',
    );
  });
});

describe('the Import dialog', () => {
  async function openDialog(onImported: (summary: ImportSummary) => void = () => {}) {
    rendered = render(createElement(ImportDialog, { onImported, onClose: () => {} }));
    await settle();
  }

  it('asks for a file before it sends anything', async () => {
    await openDialog();
    await submit(dialog()!.querySelector('form'));
    expect(dialog()!.textContent).toContain(t('import.fileRequired'));
    expect(fileInput().getAttribute('aria-invalid')).toBe('true');
    expect(server.imports).toEqual([]);
  });

  it('shows the upload, then the stage the server is at, then what it added and reused', async () => {
    const imported: ImportSummary[] = [];
    await openDialog((summary) => imported.push(summary));
    let release: (reply: Reply) => void = () => {};
    server.uploadProgress = [0.5];
    server.before = (call) =>
      call.method === 'POST' && call.path === '/api/import'
        ? new Promise<Reply>((resolve) => (release = resolve))
        : undefined;
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    expect(dialog()!.textContent).toContain('Uploading… 50%');
    expect(button(dialog()!, t('import.cancel'))!.disabled).toBe(true);
    expect(dialog()!.querySelector('progress')!.value).toBe(0.5);
    release({ status: 200, body: campaignSummary });
    await settle();
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe(summaryText(campaignSummary));
    expect(imported).toEqual([campaignSummary]);
    expect(server.writes()).toEqual(['POST /api/import']);
    expect(document.activeElement).toBe(button(dialog()!, t('import.close')));
  });

  it('names the stages after the upload: reading, the images counted, saving', async () => {
    await openDialog();
    server.uploadProgress = [1];
    server.before = (call) =>
      call.method === 'POST' && call.path === '/api/import' ? new Promise<Reply>(() => {}) : undefined;
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    for (const [progress, text] of [
      [{ running: true, stage: 'reading', done: 0, total: 0 }, 'Reading the file…'],
      [{ running: true, stage: 'images', done: 3, total: 26 }, 'Checking images… 3 of 26'],
      [{ running: true, stage: 'saving', done: 0, total: 0 }, 'Saving…'],
    ] as const) {
      server.importProgress = progress;
      await pause(PROGRESS_POLL_MS + 50);
      expect(dialog()!.querySelector('.eg-import__progress')!.textContent).toBe(text);
    }
  });

  it('says why an import was refused, that nothing changed, and what the server found', async () => {
    await openDialog();
    server.importReply = {
      status: 422,
      body: {
        error: {
          code: 'import_newer_format',
          message: 'test',
          format_version: 3,
          details: [{ path: 'manifest.json', message: 'the archive is format 3; this server reads up to format 1' }],
        },
      },
    };
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    const alert = dialog()!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('This file was made by a newer Emberglass (format 3); update to import it.');
    expect(alert.textContent).toContain('Nothing was changed.');
    expect(alert.textContent).toContain('Details: the archive is format 3');
  });

  it.each([
    ['import_too_large', 413],
    ['import_unsafe_entry', 422],
    ['import_invalid', 422],
    ['import_image_refused', 422],
    ['import_busy', 409],
  ] as const)('explains %s in the catalogue words', async (code, status) => {
    await openDialog();
    server.importReply = { status, body: { error: { code, message: 'test' } } };
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain(t(`error.code.${code}`));
  });
});

describe('Export and Import in the library', () => {
  it('selects assets to export, or exports them all, and imports into it', async () => {
    const goblin = server.addAsset({ name: 'Goblin', category: 'monster' });
    const hero = server.addAsset({ name: 'Aria', category: 'pc' });
    server.addAsset({ name: 'Innkeeper', category: 'npc' });
    rendered = render(createElement(Library, { uploadLimit: 50 * 1024 * 1024 }));
    await settle();
    const view = rendered.container;
    expect(view.querySelector('input[type="checkbox"]')).toBeNull();
    await click(button(view, t('library.select')));
    expect(button(view, t('library.select'))!.getAttribute('aria-pressed')).toBe('true');
    const selectedLink = () => view.querySelector<HTMLAnchorElement>('a[data-action="export-selected"]');
    expect(selectedLink()).toBeNull();
    expect(view.querySelector('button[data-action="export-selected"]')!.getAttribute('aria-disabled')).toBe('true');
    const all = view.querySelector<HTMLAnchorElement>('a[data-action="export-all"]')!;
    expect(all.getAttribute('href')).toBe('/api/export/assets');
    expect(all.hasAttribute('download')).toBe(true);
    const check = (name: string) => view.querySelector<HTMLInputElement>(`input[aria-label="Select ${name}"]`)!;
    await click(check('Goblin'));
    await click(check('Aria'));
    expect(selectedLink()!.textContent).toBe('Export selected (2)');
    const ids = new URLSearchParams(selectedLink()!.getAttribute('href')!.split('?')[1]).getAll('id');
    expect(ids.sort()).toEqual([goblin.id, hero.id].sort());
    await click(check('Aria'));
    expect(selectedLink()!.textContent).toBe('Export selected (1)');
    await click(button(view, t('library.select')));
    expect(view.querySelector('input[type="checkbox"]')).toBeNull();

    const reads = () => server.calls.filter((call) => call.method === 'GET' && call.path === '/api/assets').length;
    const before = reads();
    await click(button(view, t('library.import')));
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    expect(dialog()!.textContent).toContain('Imported library assets: 1 new asset, 0 reused');
    expect(reads()).toBeGreaterThan(before);
  });
});

describe('Export and Import in the campaign tree', () => {
  it('offers each campaign as a download, and lists an imported campaign once the import ends', async () => {
    const campaign = server.addCampaign('Curse of the Fallen');
    rendered = render(
      createElement(SceneTree, {
        selectedSceneId: undefined,
        onSelectScene: () => {},
        onScenesRemoved: () => {},
        onSceneRenamed: () => {},
      }),
    );
    await settle();
    const view = rendered.container;
    const link = view.querySelector<HTMLAnchorElement>('a[aria-label="Export Curse of the Fallen"]')!;
    expect(link.getAttribute('href')).toBe(`/api/export/campaigns/${campaign.id}`);
    expect(link.hasAttribute('download')).toBe(true);
    await click(button(view, t('tree.import')));
    server.importReply = { status: 200, body: { ...campaignSummary, campaign: { id: campaign.id, name: 'Copy' } } };
    server.addCampaign('Curse of the Fallen (2)');
    await chooseFile(fileInput(), zip());
    await submit(dialog()!.querySelector('form'));
    await click(button(dialog()!, t('import.close')));
    expect(dialog()).toBeNull();
    expect([...view.querySelectorAll('.eg-tree__name')].map((each) => each.textContent)).toContain(
      'Curse of the Fallen (2)',
    );
  });
});

describe('the import limit in Settings', () => {
  it('starts at 2048 MB, saves a changed one alone, and refuses one out of bounds', async () => {
    rendered = render(createElement(SettingsDialog, { onClose: () => {}, onSaved: () => {} }));
    await settle();
    const field = [...dialog()!.querySelectorAll('label')].find(
      (each) => each.textContent === t('settings.importLimit'),
    )!;
    const input = document.getElementById(field.htmlFor) as HTMLInputElement;
    expect(input.value).toBe('2048');
    await type(input, '0');
    await submit(dialog()!.querySelector('form'));
    expect(dialog()!.textContent).toContain('Enter a whole number of MB from 1 to 65,536.');
    expect(server.writes()).toEqual([]);
    await type(input, '500');
    await submit(dialog()!.querySelector('form'));
    const patch = server.calls.find((call) => call.method === 'PATCH');
    expect(patch?.body).toEqual({ import_limit_bytes: 500 * 1024 * 1024 });
    expect(server.importLimit).toBe(500 * 1024 * 1024);
  });
});
