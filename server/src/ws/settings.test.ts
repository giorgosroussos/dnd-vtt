import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerSnapshotSchema, type DmSnapshot, type PlayerSnapshot, type Settings } from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { ok, startLive, type LiveHarness } from './testing/harness.js';

// REL-01 over a real port and real Socket.io clients, against a real SQLite file (specs/09-operations.md
// §7, specs/06-grid-and-measurement.md §5, specs/05-assets-and-images.md §7, G-015, G-036): a settings
// change reaches the live scene's rooms without a restart, as a fresh snapshot to each room whose view
// it changed, and to nobody otherwise.

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let h: LiveHarness;

afterEach(async () => {
  await h.close();
});

const isPlayerSnapshot = compileSchema(PlayerSnapshotSchema);
const patch = (payload: object) => h.inject({ method: 'PATCH', url: '/api/settings', payload });
const types = (events: { type: string }[]) => events.map((event) => event.type);

describe('a new ruler rule (specs/06-grid-and-measurement.md §5, G-036)', () => {
  it('counts the measurement shown on the TV again, in one fresh snapshot to each room', async () => {
    h = await startLive();
    const scene = await h.scene('The long hall', (await h.image('settings map', 96)).id);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    // Six across and two down: 30 ft by the PHB rule, 35 ft by the DMG rule (two diagonals, the second 10 ft).
    const path = { from: { column: 1, row: 1 }, to: { column: 7, row: 3 } };
    expect(await h.command(dm, 'ruler.update', { scene_id: scene.id, ...path })).toEqual({ ok: true });
    await dm.settle();
    await tv.settle();

    ok<Settings>(await patch({ ruler_rule: 'dmg' }));
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(types(dmEvents)).toEqual(['scene.snapshot']);
    expect(types(tvEvents)).toEqual(['scene.snapshot']);
    expect((dmEvents[0]!.payload as DmSnapshot).scene?.ruler).toEqual({ ...path, feet: 35 });
    const players = tvEvents[0]!.payload as PlayerSnapshot;
    expect(isPlayerSnapshot(players)).toBe(true);
    expect(players.scene?.ruler).toEqual({ ...path, feet: 35 });
    // A new measurement is counted by the new rule too.
    expect(await h.command(dm, 'ruler.update', { scene_id: scene.id, ...path, to: { column: 3, row: 3 } })).toEqual({
      ok: true,
    });
    expect((await tv.settle()).map((event) => event.payload)).toEqual([
      { ruler: { ...path, to: { column: 3, row: 3 }, feet: 15 } },
    ]);
  });

  it('tells nobody when no measurement is shown, and nobody of the other settings', async () => {
    h = await startLive();
    const scene = await h.scene('The vault', (await h.image('settings map B', 96)).id);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    await dm.settle();
    await tv.settle();
    const versions = [h.versions.dm.current(), h.versions.players.current()];
    ok<Settings>(await patch({ ruler_rule: 'dmg', upload_limit_bytes: 2 * 1024 * 1024 }));
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);
    expect([h.versions.dm.current(), h.versions.players.current()]).toEqual(versions);
  });
});

// The TV address of the connect panel is the DM's alone (specs/08-ux-journeys.md §5, specs/04-live-sync.md §4,
// Q-110): a change reaches no room, and a snapshot a settings change does send carries none of it (PKG-01
// review T-M1).
describe('a new TV address (Q-110)', () => {
  it('reaches neither room alone, and is in no snapshot that another setting sends', async () => {
    h = await startLive();
    const scene = await h.scene('The gatehouse', (await h.image('settings map C', 96)).id);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    const path = { from: { column: 1, row: 1 }, to: { column: 7, row: 3 } };
    expect(await h.command(dm, 'ruler.update', { scene_id: scene.id, ...path })).toEqual({ ok: true });
    await dm.settle();
    // The players room is live and hears the scene: its snapshot and the measurement have arrived.
    expect(types(await tv.settle())).toEqual(['scene.snapshot', 'ruler.shown']);
    const leak = /tv_address|192\.168\.77\.5|10\.9\.8\.7|adapter/;

    // Alone, a TV address changes no room's view: nobody hears of it.
    ok<Settings>(await patch({ tv_address: '192.168.77.5' }));
    expect(await dm.settle()).toEqual([]);
    expect(await tv.settle()).toEqual([]);

    // With a new rule, the players room is sent a fresh snapshot, which holds no address.
    ok<Settings>(await patch({ tv_address: '10.9.8.7', ruler_rule: 'dmg' }));
    const tvEvents = await tv.settle();
    expect(types(tvEvents)).toEqual(['scene.snapshot']);
    expect((tvEvents[0]!.payload as PlayerSnapshot).scene?.ruler).toEqual({ ...path, feet: 35 });
    // Nothing the TV received since it connected names the address, the setting or an adapter.
    expect(JSON.stringify(tv.events)).not.toMatch(leak);
    ok<Settings>(await patch({ tv_address: null }));
    expect(await tv.settle()).toEqual([]);
    expect(JSON.stringify(tv.events)).not.toMatch(leak);
  });
});

describe('a new display size (specs/05-assets-and-images.md §7, G-015)', () => {
  it('sends both rooms the live map at the size of its regenerated display version', async () => {
    h = await startLive();
    const map = await h.image('settings wide map', 1200);
    expect(map.variants.display).toEqual({ width: 1200, height: 48 });
    const scene = await h.scene('The wide hall', map.id);
    const dm = await h.connect({ cookie: h.cookie });
    const tv = await h.connect();
    expect(await h.command(dm, 'scene.activate', { scene_id: scene.id })).toEqual({ ok: true });
    await dm.settle();
    await tv.settle();

    ok<Settings>(await patch({ display_variant_size: 600 }));
    await h.app.regenerator.idle();
    const [dmEvents, tvEvents] = [await dm.settle(), await tv.settle()];
    expect(types(dmEvents)).toEqual(['scene.snapshot']);
    expect(types(tvEvents)).toEqual(['scene.snapshot']);
    expect((dmEvents[0]!.payload as DmSnapshot).scene?.map?.variants.display).toEqual({ width: 600, height: 24 });
    expect((tvEvents[0]!.payload as PlayerSnapshot).scene?.map?.variants.display).toEqual({ width: 600, height: 24 });
  });
});
