import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAYER_VIEW_AUTH,
  type EventEnvelope,
  type LibraryAsset,
  type SceneToken,
  type TokenChange,
} from '@emberglass/shared';
import { applyPlayerEvent, startLive, type LiveHarness, type PlayerState } from './testing/harness.js';

// The recorded-traffic test of specs/10-testing-acceptance.md §3 (Q-067, D-042), as far as LIV-02
// reaches: everything a player socket receives, every message and every image response, across a
// scripted session of adding hidden tokens, revealing, hiding, moving, deleting, activating another
// scene and reconnecting. It asserts that no hidden token's id, asset, image or name appears, and
// that the count of hidden tokens cannot be learnt either: the whole recording is identical, byte
// for byte once identifiers are numbered by first appearance, to the recording of the same session
// without any of the hidden-only steps. Undo joins the script with LIV-05, which then marks it as that gate
// (the hidden-information gate of the tripwires; specs/04-live-sync.md §4, specs/07-security-and-access.md §5).

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

let h: LiveHarness | undefined;

afterEach(async () => {
  await h?.close();
  h = undefined;
});

interface Recording {
  /** What the player socket and its image requests received, one entry per step. */
  steps: { step: string; received: unknown[] }[];
  /** What must never reach a player: ids, names and images of tokens never shown. */
  secrets: string[];
  /** Tokens shown only from a given step on, with the step. */
  shownFrom: { id: string; step: string }[];
}

/** Runs the scripted session; `hidden` adds the steps that concern hidden tokens only. */
async function record(hidden: boolean): Promise<Recording> {
  h = await startLive();
  const live = h;
  const secrets: string[] = [];
  const mapA = await live.image('traffic map A', 96);
  const mapB = await live.image('traffic map B', 80);
  const sceneA = await live.scene('The crypt of whispers', mapA.id);
  const sceneB = await live.scene('The bridge', mapB.id);
  const goblin = await live.asset('Goblin');
  const kobold = await live.asset('Kobold', { category: 'monster', default_hidden: true });
  let lurker: LibraryAsset | undefined;
  if (hidden) {
    lurker = await live.asset('Lurker', { category: 'monster', default_hidden: true, notes: 'Waits in the dark' });
    secrets.push(lurker.id, lurker.image_id, 'Lurker', 'Waits in the dark');
  }
  secrets.push(goblin.id, kobold.id, sceneA.id, sceneB.id, sceneA.session_id, 'The crypt', 'The bridge');

  // Preparation over REST; hidden tokens interleaved with the visible ones in the stacking order.
  const secret = async (sceneId: string, assetId: string, x: number, y: number): Promise<SceneToken | undefined> => {
    if (!hidden) return undefined;
    const token = await live.place(sceneId, assetId, x, y);
    expect(token.hidden).toBe(true);
    secrets.push(token.id);
    return token;
  };
  const firstGoblin = await live.place(sceneA.id, goblin.id, 1, 1);
  await secret(sceneA.id, lurker?.id ?? '', 2, 2);
  const revealed = await live.place(sceneA.id, kobold.id, 3, 3);
  const extraKobold = await secret(sceneA.id, kobold.id, 4, 4);
  await secret(sceneB.id, lurker?.id ?? '', 0, 0);
  await live.place(sceneB.id, goblin.id, 1, 1);
  // A hidden kobold the DM relabelled, and one that will outlive its asset's rename: neither may
  // change a label players see (Q-094).
  const boss = await secret(sceneA.id, kobold.id, 5, 5);
  if (boss) {
    const relabelled = await live.inject({
      method: 'PATCH',
      url: `/api/tokens/${boss.id}`,
      payload: { label: 'Boss' },
    });
    expect(relabelled.statusCode, relabelled.body).toBe(200);
  }
  await secret(sceneB.id, kobold.id, 2, 2);

  const dm = await live.connect({ cookie: live.cookie });
  let tv = await live.connect();
  let state: PlayerState = applyPlayerEvent({ version: 0, scene: null }, tv.first);
  const steps: Recording['steps'] = [{ step: 'connect', received: [tv.first] }];
  const shownFrom: Recording['shownFrom'] = [];

  const send = async (type: string, payload: unknown): Promise<EventEnvelope[]> => {
    const before = dm.events.length;
    expect(await live.command(dm, type, payload), `${type} ${JSON.stringify(payload)}`).toEqual({ ok: true });
    await dm.settle();
    return dm.events.slice(before);
  };
  // Every image the player view would draw after the step, fetched as it would: without a session.
  const images = async (): Promise<unknown[]> => {
    const ids = state.scene
      ? [
          ...((state.scene.map as { id: string } | null) ? [(state.scene.map as { id: string }).id] : []),
          ...state.scene.tokens.map((token) => token.image_id as string),
        ]
      : [];
    const responses = [];
    for (const id of [...new Set(ids)]) {
      const response = await live.app.inject({ method: 'GET', url: `/images/${id}/display` });
      const headers: Record<string, unknown> = { ...response.headers };
      delete headers.date;
      responses.push({
        image: id,
        status: response.statusCode,
        headers,
        body: createHash('sha256').update(response.rawPayload).digest('hex'),
      });
    }
    return responses;
  };
  // A hidden-only step of the session without hidden tokens does nothing, but is still recorded:
  // what players receive at that point must be the same either way.
  const step = async (name: string, action: () => Promise<unknown>, hiddenOnly = false): Promise<void> => {
    if (hidden || !hiddenOnly) await action();
    const events = await tv.settle();
    for (const event of events) state = applyPlayerEvent(state, event);
    // The snapshot settle asked for is traffic too: it must agree with the copy the events built.
    const fresh = tv.events.at(-1)!;
    expect(state.scene, name).toEqual((fresh.payload as { scene: unknown }).scene);
    steps.push({ step: name, received: [...events, fresh, ...(await images())] });
  };
  const tokenOf = (events: EventEnvelope[]) => (events[0]!.payload as TokenChange).token;

  await step('activate A', () => send('scene.activate', { scene_id: sceneA.id }));
  await step(
    'add a hidden lurker',
    async () =>
      secrets.push(tokenOf(await send('token.add', { scene_id: sceneA.id, asset_id: lurker!.id, x: 6, y: 6 })).id),
    true,
  );
  let secondGoblin = '';
  await step('add a visible goblin', async () => {
    secondGoblin = tokenOf(await send('token.add', { scene_id: sceneA.id, asset_id: goblin.id, x: 7, y: 1 })).id;
  });
  await step('move the hidden lurker', () => send('token.move', { token_id: secrets.at(-1)!, x: 2, y: 9 }), true);
  await step('reveal the kobold', async () => {
    shownFrom.push({ id: revealed.id, step: 'reveal the kobold' });
    await send('token.setVisibility', { token_id: revealed.id, hidden: false });
  });
  await step(
    'add a hidden kobold',
    async () =>
      secrets.push(tokenOf(await send('token.add', { scene_id: sceneA.id, asset_id: kobold.id, x: 8, y: 8 })).id),
    true,
  );
  await step('move a visible goblin', () => send('token.move', { token_id: firstGoblin.id, x: 1.5, y: 2 }));
  await step('hide a goblin', () => send('token.setVisibility', { token_id: firstGoblin.id, hidden: true }));
  await step('delete a hidden kobold', () => send('token.delete', { token_id: extraKobold!.id }), true);
  await step('delete a visible goblin', () => send('token.delete', { token_id: secondGoblin }));
  await step('reveal the goblin again', () => send('token.setVisibility', { token_id: firstGoblin.id, hidden: false }));
  await step('activate B', () => send('scene.activate', { scene_id: sceneB.id }));
  await step('rename the kobold asset, now visible by default', async () => {
    const response = await live.inject({
      method: 'PATCH',
      url: `/api/assets/${kobold.id}`,
      payload: { name: 'Wight', default_hidden: false },
    });
    expect(response.statusCode, response.body).toBe(200);
  });
  await step('add a visible wight', () => send('token.add', { scene_id: sceneB.id, asset_id: kobold.id, x: 4, y: 1 }));
  await step(
    'add and delete a hidden lurker on B',
    async () => {
      const id = tokenOf(await send('token.add', { scene_id: sceneB.id, asset_id: lurker!.id, x: 3, y: 3 })).id;
      secrets.push(id);
      await send('token.delete', { token_id: id });
    },
    true,
  );
  await step('reconnect', async () => {
    tv.socket.disconnect();
    // Back as the player view of the DM's own laptop: the DM cookie with the player view's hint
    // (D-105), which must receive exactly what a screen without a session does.
    tv = await live.connect({ cookie: live.cookie }, { ...PLAYER_VIEW_AUTH });
    state = applyPlayerEvent(state, tv.first);
    steps.push({ step: 'reconnected', received: [tv.first] });
  });
  await step('deactivate', () => send('scene.deactivate', {}));
  await step('activate A again', () => send('scene.activate', { scene_id: sceneA.id }));
  // Anything sent late, after the last step, arrives before this.
  await step('nothing more', () => Promise.resolve());
  return { steps, secrets, shownFrom };
}

/** Numbers every UUID by first appearance, so two runs with different identifiers compare. */
function normalise(recording: Recording['steps']): string {
  const seen = new Map<string, string>();
  return JSON.stringify(recording).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (uuid) => seen.get(uuid) ?? (seen.set(uuid, `uuid-${seen.size + 1}`), `uuid-${seen.size}`),
  );
}

describe('what a player view receives across a live session (specs/10-testing-acceptance.md §3, specs/04-live-sync.md §4)', () => {
  it('records every message and image response a player socket receives and finds no hidden token, id, asset, image, name or count in it', async () => {
    const withHidden = await record(true);
    await h!.close();
    h = undefined;
    const without = await record(false);

    const text = JSON.stringify(withHidden.steps);
    for (const secret of withHidden.secrets) expect(text, secret).not.toContain(secret);
    for (const forbidden of ['"hidden"', '"notes"', '"asset', '"scene_id"', '"session_id"', 'thumbnail', 'original']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // A token placed hidden is unknown to players until the step that reveals it.
    for (const { id, step } of withHidden.shownFrom) {
      const at = withHidden.steps.findIndex((each) => each.step === step);
      expect(JSON.stringify(withHidden.steps.slice(0, at)), id).not.toContain(id);
      expect(JSON.stringify(withHidden.steps[at]), id).toContain(id);
    }
    // Every image a player drew was served; nothing else was asked for.
    for (const { received } of withHidden.steps) {
      for (const entry of received as { status?: number }[]) if ('status' in entry) expect(entry.status).toBe(200);
    }

    // The count: the same session without a single hidden-only step looks the same to players,
    // messages, versions and images alike.
    expect(withHidden.steps.map((each) => each.step)).toEqual(without.steps.map((each) => each.step));
    expect(normalise(withHidden.steps)).toBe(normalise(without.steps));
  });
});
