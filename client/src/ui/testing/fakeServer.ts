import { act } from 'react';
import { Value } from 'typebox/value';
import {
  FEET_PER_SQUARE_BOUNDS,
  FIT_CAMERA,
  LIVE_COMMAND_PAYLOAD_SCHEMAS,
  PinChangeBodySchema,
  SettingsUpdateSchema,
  rulerFeet,
  TokenCreateBodySchema,
  applyStroke,
  fillFog,
  fogExtent,
  FogWriteBodySchema,
  sameFog,
  changeOf,
  turnView,
  withoutEntry,
  type Encounter,
  type EncounterChange,
  type FogMask,
  type FogStroke,
  type FogWriteBody,
  normaliseMarkers,
  applyHp,
  hpChanged,
  markersForHp,
  sameStats,
  statsFromAsset,
  statsOf,
  withStats,
  type TokenMarker,
  type TokenStats,
  TokenUpdateBodySchema,
  NotesBodySchema,
  type CommandAck,
  type CommandEnvelope,
  type DmSnapshot,
  type ErrorCode,
  type EventEnvelope,
  nextLabel,
  normalizeTag,
  numberingPeers,
  type AssetUsage,
  type ConnectInfo,
  type Campaign,
  type DeletionSummary,
  type Image,
  type LibraryAsset,
  type Scene,
  type SceneToken,
  type PlayerCamera,
  type RulerRule,
  type RulerSquare,
  type Screen,
  type Session,
} from '@emberglass/shared';
import { t } from '../messages.js';
import { installFakeSockets, type FakeSocket } from './fakeSocket.js';

// Test tooling only, never bundled: a scripted stand-in for the server behind
// `fetch`, for the DM view's component tests (D-085). It keeps a small tree the
// way the SRV-03 routes do (D-078): campaigns by name, sessions and scenes in their
// order, deletion only when the confirmation equals the current count. A test
// can intercept any request first with `before`, to answer it differently or to
// hold it open. The server's real behaviour is proven by server/src/http/*.test.ts;
// the end-to-end tests run the view against it.
//
// The live side (LIV-04) follows the server's rules for the `dm` room: `openSockets` connects every
// socket a view opened with the snapshot of its room; a DM socket's commands are applied as the
// live commands are (D-109) and their events delivered to every open DM socket before the
// acknowledgement (D-111); and a REST write that changes the DM's live scene delivers a fresh
// snapshot, or `scene.cleared` when it cleared it, as `server/src/ws/live.ts` `refresh` does.

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Interceptor = (call: Call) => Reply | Promise<Reply | undefined> | undefined;

const json = (status: number, body?: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  body,
  headers,
});
const failure = (status: number, code: string, headers: Record<string, string> = {}): Reply =>
  json(status, { error: { code, message: 'test' } }, headers);

const DEFAULT_GRID: Scene['grid'] = {
  type: 'square',
  size: null,
  offset_x: 0,
  offset_y: 0,
  visible: true,
  feet_per_square: 5,
  columns: 30,
  rows: 20,
};

const CALIBRATION_KEYS = ['size', 'offset_x', 'offset_y', 'columns', 'rows'] as const;

let counter = 0;
/** What the history holds: a command, a deleted token put back, or the fog as it was (LIV-05, TBL-04). */
type Undoable =
  | CommandEnvelope
  | { type: 'restore'; token: SceneToken; encounter?: Encounter }
  | { type: 'restoreFog'; sceneId: string; fog: FogMask }
  | { type: 'restoreEncounter'; sceneId: string; encounter: Encounter | null }
  // Hit points, armour class and the markers they set, put back together (DMT-01), as the server's inverse.
  | { type: 'restoreStats'; tokenId: string; stats: TokenStats; markers: TokenMarker[] };

const uuid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export class FakeServer {
  pinSet = true;
  local = true;
  signedIn = true;
  pin = '4826';
  lockedFor: number | undefined;
  /** Seconds left of a server-wide PIN pause, answered as `pin_paused` (G-042). */
  pausedFor: number | undefined;
  campaigns: Campaign[] = [];
  sessions: Session[] = [];
  scenes: Scene[] = [];
  tokens: Record<string, number> = {};
  liveSceneId: string | null = null;
  uploadLimit = 50 * 1024 * 1024;
  /** The TV address chosen in Settings, null for Automatic (Q-110). */
  tvAddress: string | null = null;
  displaySize = 4096;
  assets: LibraryAsset[] = [];
  images: Image[] = [];
  /** Scenes whose tokens use an asset, which refuse its deletion (D-083). */
  usages: Record<string, AssetUsage[]> = {};
  /** What each upload sent as its body. */
  uploads: unknown[] = [];
  /** Fields of the image the next uploads store. */
  uploadedImage: Partial<Image> = {};
  /** Tokens with their state, served by the token routes (PRP-04, D-100). */
  sceneTokens: SceneToken[] = [];
  /** The painted fog of each scene that has any (TBL-04). */
  fogs: Record<string, FogMask> = {};
  /** The encounter of each scene that had one (TBL-06). */
  encounters: Record<string, Encounter> = {};
  /** The highest number issued per scene and asset, as `scene.token_numbers` (Q-091). */
  private issued: Record<string, number> = {};
  /**
   * What GET /api/connect answers (LIV-03), in the automatic order: two addresses with their adapters and a
   * code of the first. The TV address chosen in Settings (Q-110) is moved first when it is among them.
   */
  connect: Omit<ConnectInfo, 'chosen' | 'chosen_found' | 'automatic'> = {
    addresses: [
      { address: '192.168.1.20', url: 'http://192.168.1.20:3000/', private: true, adapter: 'Wi-Fi', virtual: false },
      {
        address: '100.64.3.4',
        url: 'http://100.64.3.4:3000/',
        private: false,
        adapter: 'vEthernet (WSL)',
        virtual: true,
      },
    ],
    qr: {
      size: 21,
      rows: Array.from({ length: 21 }, (_, y) => (y % 2 ? '10'.repeat(10) + '1' : '01'.repeat(10) + '0')),
    },
  };
  calls: Call[] = [];
  /** Answers a live command before the fake applies it, to refuse it or hold it; undefined applies it. */
  beforeCommand: ((command: CommandEnvelope) => CommandAck | Promise<CommandAck | undefined> | undefined) | undefined;
  /**
   * The player camera of the live scene and the screen the TV frame follows (LIV-06, D-119): reset on
   * every activation and deactivation, and when a REST change gives the live scene another map.
   */
  playerCamera: PlayerCamera = FIT_CAMERA;
  screen: Screen | null = null;
  /**
   * The measurement shown on the TV (LIV-07, D-121): cleared by `ruler.clear`, every activation and
   * deactivation, and a new map; its feet counted by `rulerRule`, the setting GET /api/settings answers.
   */
  ruler: { from: RulerSquare; to: RulerSquare } | null = null;
  rulerRule: RulerRule = 'phb';
  /** The socket that last measured, whose going clears the measurement. */
  private rulerOwner: FakeSocket | undefined;
  /** The `dm` room's version counter (D-108). */
  private dmVersion = 1;
  /**
   * The undo history of the live scene, newest last, as the server keeps it (LIV-05, D-117): the
   * inverse of each token command that changed something, emptied when the live scene changes.
   */
  private undoHistory: Undoable[] = [];
  /** The live scene the undo history belongs to; a history used with another scene live is emptied. */
  private undoScene: string | null = null;
  /** What redoes each undo, newest last, emptied by any new undoable command (UIX-01). */
  private redoHistory: Undoable[] = [];

  before: Interceptor | undefined;
  private restore: (() => void) | undefined;

  addCampaign(name: string): Campaign {
    const campaign: Campaign = { id: uuid(), name, description: '', rules_version: '5e-2014' };
    this.campaigns.push(campaign);
    return campaign;
  }

  addSession(campaignId: string, title: string): Session {
    const order = this.sessions.filter((s) => s.campaign_id === campaignId).length;
    const session: Session = { id: uuid(), campaign_id: campaignId, title, order, date: null };
    this.sessions.push(session);
    return session;
  }

  addScene(sessionId: string, name: string, tokens = 0): Scene {
    const order = this.scenes.filter((s) => s.session_id === sessionId).length;
    const scene: Scene = {
      id: uuid(),
      session_id: sessionId,
      name,
      order,
      map_image_id: null,
      grid: { ...DEFAULT_GRID },
      notes: '',
    };
    this.scenes.push(scene);
    this.tokens[scene.id] = tokens;
    return scene;
  }

  addAsset(fields: Partial<LibraryAsset> & { name: string }): LibraryAsset {
    const asset: LibraryAsset = {
      id: uuid(),
      category: 'monster',
      image_id: this.addImage().id,
      size: 'medium',
      default_hidden: fields.category === undefined || fields.category === 'monster',
      notes: '',
      hp_max: null,
      ac: null,
      tags: [],
      ...fields,
    };
    this.assets.push(asset);
    return asset;
  }

  /** A token of `asset` on `scene`, as a placement makes it, numbered and visible as the server would. */
  addToken(sceneId: string, asset: LibraryAsset, fields: Partial<SceneToken> = {}): SceneToken {
    const top = Math.max(
      -1,
      ...this.sceneTokens.filter((each) => each.scene_id === sceneId).map((each) => each.z_order),
    );
    const token: SceneToken = {
      id: uuid(),
      scene_id: sceneId,
      asset_id: asset.id,
      label: asset.name,
      x: 0,
      y: 0,
      hidden: asset.default_hidden,
      z_order: top + 1,
      markers: [],
      character_id: null,
      // The asset's defaults, at full hit points, as the server copies them (DMT-01).
      ...statsFromAsset(asset),
      notes: '',
      asset: {
        name: asset.name,
        image_id: asset.image_id,
        size: asset.size,
        category: asset.category,
        notes: asset.notes,
      },
      ...fields,
    };
    this.sceneTokens.push(token);
    // A hidden token keeps the bare name until it is shown (Q-092).
    if (!token.hidden && fields.label === undefined) this.numberAs(token);
    return token;
  }

  /** Numbers `token` as the server does (D-019, Q-091, Q-092), with its shared rule; answers the token it renamed. */
  private numberAs(token: SceneToken): SceneToken | undefined {
    const others = this.sceneTokens.filter(
      (each) => each.scene_id === token.scene_id && each.asset_id === token.asset_id && each !== token,
    );
    const key = `${token.scene_id}:${token.asset_id}`;
    const numbering = nextLabel(token.asset.name, numberingPeers(token.asset.name, others), this.issued[key] ?? 0);
    token.label = numbering.label;
    this.issued[key] = numbering.issued;
    const renamed = numbering.relabel && others.find((each) => each.id === numbering.relabel!.id);
    if (renamed) renamed.label = numbering.relabel!.label;
    return renamed;
  }

  private tokensOf(sceneId: string): SceneToken[] {
    return this.sceneTokens
      .filter((each) => each.scene_id === sceneId)
      .sort((a, b) => a.z_order - b.z_order || a.id.localeCompare(b.id));
  }

  /** The scene's fog. */
  fogOf(sceneId: string): FogMask {
    return this.fogs[sceneId] ?? [];
  }

  /** The scene's fog after a stroke, a fill or a clear, within its map, as the server computes it (TBL-04). */
  fogAfter(sceneId: string, change: FogWriteBody): FogMask {
    const scene = this.scenes.find((each) => each.id === sceneId)!;
    const image = this.images.find((each) => each.id === scene.map_image_id);
    const extent = fogExtent(scene.grid, image ? { width: image.width, height: image.height } : null);
    if ('stroke' in change) return applyStroke(this.fogOf(sceneId), change.stroke, extent);
    return change.fill ? fillFog(extent) : [];
  }

  // As the server does: the live scene's fog is refused over REST (TBL-04).
  private handleFog(method: string, sceneId: string, b: Record<string, unknown>): Reply {
    if (!this.scenes.some((each) => each.id === sceneId)) return failure(404, 'not_found');
    if (method === 'GET') return json(200, structuredClone(this.fogOf(sceneId)));
    if (!Value.Check(FogWriteBodySchema, b)) return failure(400, 'validation_failed');
    if (sceneId === this.liveSceneId) return failure(409, 'scene_live');
    this.fogs[sceneId] = this.fogAfter(sceneId, b);
    return json(200, structuredClone(this.fogOf(sceneId)));
  }

  // As D-100 does: the live scene's tokens are refused; positions and labels as sent.
  private handleTokens(
    method: string,
    sceneId: string | undefined,
    tokenId: string | undefined,
    b: Record<string, unknown>,
  ): Reply {
    if (sceneId !== undefined) {
      if (!this.scenes.some((each) => each.id === sceneId)) return failure(404, 'not_found');
      if (method === 'GET') return json(200, this.tokensOf(sceneId));
      // The contract's own schema, as the server validates it before anything else (D-100).
      if (!Value.Check(TokenCreateBodySchema, b)) return failure(400, 'validation_failed');
      if (sceneId === this.liveSceneId) return failure(409, 'scene_live');
      const asset = this.assets.find((each) => each.id === b.asset_id);
      if (!asset) return failure(400, 'reference_not_found');
      const before = this.tokensOf(sceneId).map((each) => ({ ...each }));
      const token = this.addToken(sceneId, asset, { x: Number(b.x), y: Number(b.y) });
      const relabelled = this.tokensOf(sceneId).filter((each) =>
        before.some((old) => old.id === each.id && old.label !== each.label),
      );
      return json(201, { token, relabelled });
    }
    if (method === 'PATCH' && !Value.Check(TokenUpdateBodySchema, b)) return failure(400, 'validation_failed');
    const token = this.sceneTokens.find((each) => each.id === tokenId);
    if (!token) return failure(404, 'not_found');
    if (token.scene_id === this.liveSceneId) return failure(409, 'scene_live');
    if (method === 'DELETE') {
      this.sceneTokens = this.sceneTokens.filter((each) => each !== token);
      return json(204);
    }
    const { stack, ...fields } = b as Partial<SceneToken> & { stack?: 'front' | 'back' };
    const statsBefore = statsOf(token);
    const revealed =
      token.hidden && fields.hidden === false && fields.label === undefined && token.label === token.asset.name;
    Object.assign(token, fields, typeof fields.label === 'string' ? { label: fields.label.trim() } : {});
    // Each condition once, in the order sent, as the server stores them (TBL-05).
    if (fields.markers) token.markers = normaliseMarkers(fields.markers);
    // Hit points as the server keeps them, setting the markers they drive unless the body gives them (DMT-01).
    Object.assign(token, withStats(statsBefore, statsOf(token)));
    if (!fields.markers && hpChanged(statsBefore, token)) {
      token.markers = markersForHp(token.asset.category, token, token.markers);
    }
    const renamed = revealed ? this.numberAs(token) : undefined;
    if (stack) {
      const others = this.tokensOf(token.scene_id)
        .filter((each) => each !== token)
        .map((each) => each.z_order);
      // As the server does: unless it already is there.
      if (stack === 'front' && others.length > 0 && token.z_order <= Math.max(...others)) {
        token.z_order = Math.max(...others) + 1;
      }
      if (stack === 'back' && others.length > 0 && token.z_order >= Math.min(...others)) {
        token.z_order = Math.min(...others) - 1;
      }
    }
    return json(200, { token: { ...token }, relabelled: renamed ? [{ ...renamed }] : [] });
  }

  // DM notes (DMT-04), as the server keeps them: on any scene, the live one included, the whole text; the live
  // scene's reach every DM socket as `notes.updated`.
  private handleNotes(method: string, kind: 'scene' | 'token', id: string, b: Record<string, unknown>): Reply {
    if (method !== 'PUT') return failure(404, 'not_found');
    if (!Value.Check(NotesBodySchema, b)) return failure(400, 'validation_failed');
    const notes = b.notes;
    if (kind === 'scene') {
      const scene = this.scenes.find((each) => each.id === id);
      if (!scene) return failure(404, 'not_found');
      scene.notes = notes;
      if (scene.id === this.liveSceneId) this.deliver('notes.updated', { scene_id: id, token_id: null, notes });
      return json(200, { ...scene });
    }
    const token = this.sceneTokens.find((each) => each.id === id);
    if (!token) return failure(404, 'not_found');
    token.notes = notes;
    if (token.scene_id === this.liveSceneId) {
      this.deliver('notes.updated', { scene_id: token.scene_id, token_id: id, notes });
    }
    return json(200, this.withAsset(token));
  }

  addImage(fields: Partial<Image> = {}): Image {
    const image: Image = {
      id: (++counter).toString(16).padStart(64, '0'),
      mime: 'image/png',
      width: 64,
      height: 64,
      variants: { display: { width: 64, height: 64 }, thumbnail: { width: 64, height: 64 } },
      grid_preset: null,
      ...fields,
    };
    this.images.push(image);
    return image;
  }

  /** The live sockets the views opened since `install`; none connects until a test opens it (LIV-01). */
  sockets: FakeSocket[] = [];

  /** Replaces `fetch`, `XMLHttpRequest` (uploads, D-090) and the live socket (LIV-01) until `uninstall`. */
  install(): this {
    // What the workspace remembers between visits (UIX-01) never carries from one test to the next.
    try {
      window.localStorage?.clear();
    } catch {
      // No storage: nothing to clear.
    }
    const original = globalThis.fetch;
    const fakeSockets = installFakeSockets((socket) => {
      socket.onCommand = (command, ack) => {
        void Promise.resolve(this.beforeCommand?.(command)).then((answer) =>
          ack(answer ?? this.command(command, socket)),
        );
      };
      // The DM socket that drew the measurement going takes it off the TV, as the server's release does (D-121).
      socket.onGone = () => {
        if (socket.view === 'dm' && this.ruler && this.rulerOwner === socket) {
          this.rulerOwner = undefined;
          this.measureElsewhere(null);
        }
      };
    });
    this.sockets = fakeSockets.sockets;
    const originalXhr = globalThis.XMLHttpRequest;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      const reply = await this.reply({ method: init?.method ?? 'GET', path, body });
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...reply.headers },
      });
    };
    globalThis.XMLHttpRequest = fakeXhr(this) as unknown as typeof XMLHttpRequest;
    this.restore = () => {
      fakeSockets.restore();
      globalThis.fetch = original;
      globalThis.XMLHttpRequest = originalXhr;
    };
    return this;
  }

  /** Records the call and answers it, through `before` first; a write tells the DM room what it changed live. */
  async reply(call: Call): Promise<Reply> {
    this.calls.push(call);
    const intercepted = await this.before?.(call);
    if (intercepted) return intercepted;
    // Notes tell the DM room by `notes.updated` alone, never by a snapshot (DMT-04).
    if (call.method === 'GET' || /\/notes$/.test(call.path)) return this.handle(call);
    const before = this.dmSnapshot();
    const reply = this.handle(call);
    if (before.scene !== null && before.scene.scene.map_image_id !== this.liveMap()) {
      this.playerCamera = FIT_CAMERA;
      this.ruler = null;
    }
    const after = this.dmSnapshot();
    if (before.scene !== null && after.scene === null) this.deliver('scene.cleared', {});
    else if (JSON.stringify(before) !== JSON.stringify(after)) this.deliver('scene.snapshot', after);
    return reply;
  }

  // --- the live side (LIV-04) ---

  private liveMap(): string | null | undefined {
    return this.scenes.find((each) => each.id === this.liveSceneId)?.map_image_id;
  }

  /** The TV camera or the screen changed elsewhere: another DM browser steered, or a TV reported. */
  steerElsewhere(camera: PlayerCamera = this.playerCamera, screen: Screen | null = this.screen): void {
    this.playerCamera = { ...camera };
    this.screen = screen && { ...screen };
    this.deliver('camera.player', { camera: { ...this.playerCamera }, screen: this.screen });
  }

  /** The DM room's snapshot of the live scene, tokens drawn from their asset's current fields. */
  dmSnapshot(): DmSnapshot {
    const scene = this.scenes.find((each) => each.id === this.liveSceneId);
    if (!scene) return { role: 'dm', scene: null };
    return {
      role: 'dm',
      scene: {
        scene: structuredClone(scene),
        map: structuredClone(this.images.find((each) => each.id === scene.map_image_id) ?? null),
        tokens: this.tokensOf(scene.id).map((token) => this.withAsset(token)),
        camera: { ...this.playerCamera },
        screen: this.screen && { ...this.screen },
        ruler: this.measurement(scene),
        history: this.historyState(),
        fog: structuredClone(this.fogOf(scene.id)),
        encounter: structuredClone(this.encounters[scene.id] ?? null),
      },
    };
  }

  /** Writes the scene's encounter and tells the DM room, as the server does (TBL-06). */
  private storeEncounter(sceneId: string, encounter: Encounter | null): void {
    if (encounter === null) delete this.encounters[sceneId];
    else this.encounters[sceneId] = structuredClone(encounter);
    this.deliver('encounter.updated', { encounter: structuredClone(encounter) });
  }

  /** Another DM browser changed the live scene's encounter. */
  encounterElsewhere(encounter: Encounter | null): void {
    if (this.liveSceneId === null) throw new Error('Nothing is live.');
    this.storeEncounter(this.liveSceneId, encounter);
  }

  /** Whether undo and redo would find anything on the live scene (UIX-01). */
  historyState(): { can_undo: boolean; can_redo: boolean } {
    const mine = this.liveSceneId !== null && this.undoScene === this.liveSceneId;
    return { can_undo: mine && this.undoHistory.length > 0, can_redo: mine && this.redoHistory.length > 0 };
  }

  /** Tells the DM room of a new undo state, as the server does after a command, the same scene live (UIX-01). */
  private tellHistory(before: string, live: string | null): void {
    if (this.liveSceneId === null || this.liveSceneId !== live) return;
    const state = this.historyState();
    if (JSON.stringify(state) !== before) this.deliver('history.changed', state);
  }

  private measurement(scene: Scene) {
    if (!this.ruler) return null;
    const { from, to } = this.ruler;
    return { from: { ...from }, to: { ...to }, feet: rulerFeet(from, to, this.rulerRule, scene.grid.feet_per_square) };
  }

  /** Another DM browser measured on the live scene, or took its measurement off. */
  measureElsewhere(path: { from: RulerSquare; to: RulerSquare } | null): void {
    const scene = this.scenes.find((each) => each.id === this.liveSceneId);
    if (!scene) throw new Error('Nothing is live to measure on.');
    this.ruler = path && structuredClone(path);
    this.rulerOwner = undefined;
    if (path) this.deliver('ruler.shown', { ruler: this.measurement(scene) });
    else this.deliver('ruler.cleared', {});
  }

  private withAsset(token: SceneToken): SceneToken {
    const asset = this.assets.find((each) => each.id === token.asset_id);
    return structuredClone(
      asset
        ? {
            ...token,
            asset: {
              name: asset.name,
              image_id: asset.image_id,
              size: asset.size,
              category: asset.category,
              notes: asset.notes,
            },
          }
        : token,
    );
  }

  /**
   * Connects every socket the views opened and not yet connected, each with the snapshot of its room:
   * the DM's live scene, or for a player view or a browser without a session the idle players' one.
   */
  async openSockets(): Promise<void> {
    await act(async () => {
      for (const socket of this.sockets) {
        if (socket.connected) continue;
        socket.open(
          socket.view === 'dm' && this.signedIn ? this.dmSnapshot() : { role: 'players', scene: null },
          this.dmVersion,
        );
      }
      await Promise.resolve();
    });
  }

  /** An event to every open DM socket, taking the room's next version. */
  deliver(type: EventEnvelope['type'], payload: object): void {
    const event = { type, version: ++this.dmVersion, payload } as EventEnvelope;
    for (const socket of this.sockets) if (socket.connected && socket.view === 'dm') socket.deliver(event);
  }

  private command(envelope: CommandEnvelope, sender?: FakeSocket): CommandAck {
    const live = this.liveSceneId;
    const before = new Map(this.sceneTokens.map((token) => [token.id, structuredClone(token)]));
    const fogBefore = live === null ? undefined : this.fogOf(live);
    const encounterBefore = live === null ? null : structuredClone(this.encounters[live] ?? null);
    const version = this.dmVersion;
    const undoBefore = JSON.stringify(this.historyState());
    const ack = this.apply(envelope);
    // As the server does: whoever measured last owns the line, even when it was already shown.
    if ('ok' in ack && envelope.type === 'ruler.update') this.rulerOwner = sender;
    if (this.liveSceneId !== live) {
      this.undoHistory = [];
      this.redoHistory = [];
    } else if ('ok' in ack && this.dmVersion !== version && envelope.type !== 'undo' && envelope.type !== 'redo') {
      const p = envelope.payload;
      const was = before.get(String(p.token_id));
      const added = this.sceneTokens.find((token) => !before.has(token.id));
      const now = this.sceneTokens.find((token) => token.id === was?.id);
      const moved = was !== undefined && now !== undefined && (now.x !== was.x || now.y !== was.y);
      const fogInverse: Undoable | undefined =
        (envelope.type === 'fog.paint' || envelope.type === 'fog.fill') && live !== null && fogBefore
          ? { type: 'restoreFog', sceneId: live, fog: fogBefore }
          : undefined;
      const encounterInverse: Undoable | undefined =
        envelope.type.startsWith('encounter.') && live !== null
          ? { type: 'restoreEncounter', sceneId: live, encounter: encounterBefore }
          : undefined;
      const inverse =
        encounterInverse ??
        (envelope.type === 'token.add' && added
          ? { type: 'token.delete' as const, payload: { token_id: added.id } }
          : envelope.type === 'token.move' && was && moved
            ? { type: 'token.move' as const, payload: { token_id: was.id, x: was.x, y: was.y } }
            : envelope.type === 'token.setVisibility' && was
              ? { type: 'token.setVisibility' as const, payload: { token_id: was.id, hidden: was.hidden } }
              : envelope.type === 'token.setMarkers' && was
                ? { type: 'token.setMarkers' as const, payload: { token_id: was.id, markers: [...was.markers] } }
                : (envelope.type === 'token.setStats' || envelope.type === 'token.applyHp') && was
                  ? { type: 'restoreStats' as const, tokenId: was.id, stats: statsOf(was), markers: [...was.markers] }
                  : envelope.type === 'token.delete' && was
                    ? {
                        type: 'restore' as const,
                        token: was,
                        ...(encounterBefore ? { encounter: encounterBefore } : {}),
                      }
                    : fogInverse);
      if (inverse && live !== null) {
        if (this.undoScene !== live) this.undoHistory = [];
        this.undoScene = live;
        this.undoHistory.push(inverse);
        if (this.undoHistory.length > 100) this.undoHistory.shift();
        this.redoHistory = [];
      }
    }
    this.tellHistory(undoBefore, live);
    return ack;
  }

  /** What undoes an inverse about to be applied, from the state before it (UIX-01). */
  private inverseOfInverse(inverse: Undoable): Undoable | undefined {
    if (inverse.type === 'restore') return { type: 'token.delete', payload: { token_id: inverse.token.id } };
    if (inverse.type === 'restoreFog')
      return { type: 'restoreFog', sceneId: inverse.sceneId, fog: this.fogOf(inverse.sceneId) };
    if (inverse.type === 'restoreStats') {
      const token = this.sceneTokens.find((each) => each.id === inverse.tokenId);
      return token && { type: 'restoreStats', tokenId: token.id, stats: statsOf(token), markers: [...token.markers] };
    }
    if (inverse.type === 'restoreEncounter') {
      return {
        type: 'restoreEncounter',
        sceneId: inverse.sceneId,
        encounter: structuredClone(this.encounters[inverse.sceneId] ?? null),
      };
    }
    const token = this.sceneTokens.find((each) => each.id === inverse.payload.token_id);
    if (!token) return undefined;
    if (inverse.type === 'token.delete') return { type: 'restore', token: structuredClone(token) };
    if (inverse.type === 'token.move')
      return { type: 'token.move', payload: { token_id: token.id, x: token.x, y: token.y } };
    if (inverse.type === 'token.setVisibility') {
      return { type: 'token.setVisibility', payload: { token_id: token.id, hidden: token.hidden } };
    }
    if (inverse.type === 'token.setMarkers') {
      return { type: 'token.setMarkers', payload: { token_id: token.id, markers: [...token.markers] } };
    }
    return undefined;
  }

  /** Applies again the most recently undone command, its inverse back in the history (UIX-01). */
  private redo(): CommandAck {
    if (this.undoScene !== this.liveSceneId) this.redoHistory = [];
    const redo = this.redoHistory.pop();
    if (!redo) return { ok: true };
    const inverse = this.inverseOfInverse(redo);
    const ack = this.applyInverse(redo);
    if ('ok' in ack && inverse) this.undoHistory.push(inverse);
    return ack;
  }

  /** Applies the most recent inverse as the command it is; a reveal keeps the label (D-117). */
  private undo(): CommandAck {
    // As the server's history: it belongs to one live scene, and the live scene deleted or replaced
    // since leaves nothing to undo (D-117).
    if (this.undoScene !== this.liveSceneId) this.undoHistory = [];
    const inverse = this.undoHistory.pop();
    if (!inverse) return { ok: true };
    const redo = this.inverseOfInverse(inverse);
    const ack = this.applyInverse(inverse);
    if ('ok' in ack && redo) this.redoHistory.push(redo);
    return ack;
  }

  private applyInverse(inverse: Undoable): CommandAck {
    if (inverse.type === 'restoreStats') {
      const token = this.sceneTokens.find((each) => each.id === inverse.tokenId);
      if (!token) return { error: { code: 'not_found', message: 'test' } };
      if (token.scene_id !== this.liveSceneId) return { error: { code: 'scene_not_live', message: 'test' } };
      Object.assign(token, statsOf(inverse.stats), { markers: [...inverse.markers] });
      this.deliver('token.updated', { token: this.withAsset(token), relabelled: [] });
      return { ok: true };
    }
    if (inverse.type === 'restoreEncounter') {
      if (inverse.sceneId !== this.liveSceneId) return { error: { code: 'scene_not_live', message: 'test' } };
      this.storeEncounter(inverse.sceneId, inverse.encounter);
      return { ok: true };
    }
    if (inverse.type === 'restoreFog') {
      if (inverse.sceneId !== this.liveSceneId) return { error: { code: 'scene_not_live', message: 'test' } };
      this.fogs[inverse.sceneId] = structuredClone(inverse.fog);
      this.deliver('fog.updated', { fog: structuredClone(inverse.fog) });
      return { ok: true };
    }
    if (inverse.type === 'restore') {
      const asset = this.assets.find((each) => each.id === inverse.token.asset_id);
      if (!asset) return { error: { code: 'reference_not_found', message: 'test' } };
      const label = inverse.token.label === inverse.token.asset.name ? asset.name : inverse.token.label;
      const token = { ...structuredClone(inverse.token), label };
      this.sceneTokens.push(token);
      this.deliver('token.added', { token: this.withAsset(token), relabelled: [] });
      if (inverse.encounter) this.storeEncounter(token.scene_id, inverse.encounter);
      return { ok: true };
    }
    const token = this.sceneTokens.find((each) => each.id === inverse.payload.token_id);
    if (inverse.type === 'token.setVisibility' && inverse.payload.hidden === false && token) {
      if (!token.hidden) return { ok: true };
      token.hidden = false;
      this.deliver('token.updated', { token: this.withAsset(token), relabelled: [] });
      return { ok: true };
    }
    return this.apply(inverse);
  }

  private apply({ type, payload }: CommandEnvelope): CommandAck {
    const refuse = (code: ErrorCode): CommandAck => ({ error: { code, message: 'test' } });
    if (!this.signedIn) return refuse('forbidden');
    // The contract's own payload schemas, as the server validates a command before applying it (D-109).
    if (!(type in LIVE_COMMAND_PAYLOAD_SCHEMAS)) return refuse('command_unsupported');
    const schema = LIVE_COMMAND_PAYLOAD_SCHEMAS[type];
    const body: unknown = payload;
    if (!Value.Check(schema, body)) return refuse('validation_failed');
    const p = payload;
    const liveToken = () => {
      const token = this.sceneTokens.find((each) => each.id === p.token_id);
      return token ? (token.scene_id === this.liveSceneId ? token : 'not_live') : undefined;
    };
    switch (type) {
      case 'scene.activate': {
        if (!this.scenes.some((each) => each.id === p.scene_id)) return refuse('not_found');
        this.liveSceneId = String(p.scene_id);
        this.playerCamera = FIT_CAMERA;
        this.ruler = null;
        this.deliver('scene.snapshot', this.dmSnapshot());
        return { ok: true };
      }
      case 'scene.deactivate': {
        if (this.liveSceneId === null) return { ok: true };
        this.liveSceneId = null;
        this.playerCamera = FIT_CAMERA;
        this.ruler = null;
        this.deliver('scene.cleared', {});
        return { ok: true };
      }
      case 'token.add': {
        const sceneId = this.liveSceneId;
        if (sceneId === null || p.scene_id !== sceneId) return refuse('scene_not_live');
        const asset = this.assets.find((each) => each.id === p.asset_id);
        if (!asset) return refuse('reference_not_found');
        const before = this.tokensOf(sceneId).map((each) => ({ ...each }));
        const token = this.addToken(sceneId, asset, { x: Number(p.x), y: Number(p.y) });
        const relabelled = this.tokensOf(sceneId).filter((each) =>
          before.some((old) => old.id === each.id && old.label !== each.label),
        );
        this.deliver('token.added', {
          token: this.withAsset(token),
          relabelled: relabelled.map((each) => this.withAsset(each)),
        });
        return { ok: true };
      }
      case 'token.move':
      case 'token.setVisibility': {
        const token = liveToken();
        if (token === undefined) return refuse('not_found');
        if (token === 'not_live') return refuse('scene_not_live');
        let renamed: SceneToken | undefined;
        if (type === 'token.move') Object.assign(token, { x: Number(p.x), y: Number(p.y) });
        else {
          if (token.hidden === p.hidden) return { ok: true };
          const revealing = token.hidden && token.label === token.asset.name;
          token.hidden = Boolean(p.hidden);
          if (revealing) renamed = this.numberAs(token);
        }
        this.deliver('token.updated', {
          token: this.withAsset(token),
          relabelled: renamed ? [this.withAsset(renamed)] : [],
        });
        return { ok: true };
      }
      case 'token.setMarkers': {
        const token = liveToken();
        if (token === undefined) return refuse('not_found');
        if (token === 'not_live') return refuse('scene_not_live');
        const markers = normaliseMarkers(p.markers as unknown[]);
        if (JSON.stringify(markers) === JSON.stringify(token.markers)) return { ok: true };
        token.markers = markers;
        this.deliver('token.updated', { token: this.withAsset(token), relabelled: [] });
        return { ok: true };
      }
      case 'token.setStats':
      case 'token.applyHp': {
        // DMT-01, as the server applies them: the markers the hit points drive set in the same step.
        const token = liveToken();
        if (token === undefined) return refuse('not_found');
        if (token === 'not_live') return refuse('scene_not_live');
        const before = statsOf(token);
        const { token_id: _id, delta, ...patch } = p as Partial<TokenStats> & { token_id: string; delta?: number };
        void _id;
        const next = type === 'token.applyHp' ? (delta ? applyHp(before, delta) : before) : withStats(before, patch);
        if (next === undefined) return refuse('bad_request');
        const markers = hpChanged(before, next)
          ? markersForHp(token.asset.category, next, token.markers)
          : token.markers;
        if (sameStats(before, next) && JSON.stringify(markers) === JSON.stringify(token.markers)) return { ok: true };
        Object.assign(token, statsOf(next), { markers });
        this.deliver('token.updated', { token: this.withAsset(token), relabelled: [] });
        return { ok: true };
      }
      case 'fog.paint':
      case 'fog.fill': {
        if (this.liveSceneId === null || p.scene_id !== this.liveSceneId) return refuse('scene_not_live');
        const change: FogWriteBody =
          type === 'fog.paint' ? { stroke: p.stroke as FogStroke } : { fill: Boolean(p.fogged) };
        const fog = this.fogAfter(this.liveSceneId, change);
        // A stroke that changes nothing tells nobody, as the server's does.
        if (sameFog(fog, this.fogOf(this.liveSceneId))) return { ok: true };
        this.fogs[this.liveSceneId] = fog;
        this.deliver('fog.updated', { fog: structuredClone(fog) });
        return { ok: true };
      }
      case 'token.delete': {
        const token = liveToken();
        if (token === undefined) return refuse('not_found');
        if (token === 'not_live') return refuse('scene_not_live');
        this.sceneTokens = this.sceneTokens.filter((each) => each !== token);
        this.deliver('token.removed', { id: token.id });
        // Its initiative entry goes with it (TBL-06).
        const encounter = this.encounters[token.scene_id];
        const at = encounter?.entries.findIndex((entry) => entry.token_id === token.id) ?? -1;
        if (encounter && at !== -1)
          this.storeEncounter(
            token.scene_id,
            withoutEntry(
              encounter,
              at,
              turnView(
                this.tokensOf(token.scene_id).map((each) => this.withAsset(each)),
                this.fogOf(token.scene_id),
              ),
            ),
          );
        return { ok: true };
      }
      case 'camera.setPlayer': {
        if (this.liveSceneId === null || p.scene_id !== this.liveSceneId) return refuse('scene_not_live');
        const camera = p.camera as PlayerCamera;
        if (JSON.stringify(camera) === JSON.stringify(this.playerCamera)) return { ok: true };
        this.playerCamera = { ...camera };
        this.deliver('camera.player', { camera: { ...camera }, screen: this.screen });
        return { ok: true };
      }
      case 'ruler.update': {
        if (this.liveSceneId === null || p.scene_id !== this.liveSceneId) return refuse('scene_not_live');
        const path = { from: p.from as RulerSquare, to: p.to as RulerSquare };
        const same = (a: RulerSquare, b: RulerSquare) => a.column === b.column && a.row === b.row;
        if (this.ruler && same(path.from, this.ruler.from) && same(path.to, this.ruler.to)) return { ok: true };
        this.measureElsewhere(path);
        return { ok: true };
      }
      case 'ruler.clear': {
        if (this.liveSceneId === null || p.scene_id !== this.liveSceneId) return refuse('scene_not_live');
        if (this.ruler === null) return { ok: true };
        this.measureElsewhere(null);
        return { ok: true };
      }
      case 'ping': {
        if (this.liveSceneId === null || p.scene_id !== this.liveSceneId) return refuse('scene_not_live');
        this.deliver('ping', { x: Number(p.x), y: Number(p.y) });
        return { ok: true };
      }
      case 'encounter.start':
      case 'encounter.end':
      case 'encounter.reorder':
      case 'encounter.setInitiative':
      case 'encounter.next':
      case 'encounter.previous':
      case 'encounter.addEntry':
      case 'encounter.removeEntry': {
        // The rules the server applies (shared/src/encounter.ts), on the live scene only.
        const sceneId = this.liveSceneId;
        if (sceneId === null || p.scene_id !== sceneId) return refuse('scene_not_live');
        const name = type.slice('encounter.'.length) as EncounterChange['type'];
        const change = { ...p, type: name } as unknown as EncounterChange;
        const decision = changeOf(this.encounters[sceneId] ?? null, change, {
          sceneId,
          tokens: this.tokensOf(sceneId).map((token) => this.withAsset(token)),
          fog: this.fogOf(sceneId),
          newId: uuid,
        });
        if (decision === undefined) return { ok: true };
        if ('refused' in decision) return refuse(decision.refused.code);
        this.storeEncounter(sceneId, decision.encounter);
        return { ok: true };
      }
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      default:
        return refuse('command_unsupported');
    }
  }

  /** The fractions an upload reports as sent before its answer, as a browser's progress events do. */
  uploadProgress: number[] = [];

  uninstall(): void {
    this.restore?.();
  }

  /** The requests that changed something, as `METHOD path`. */
  writes(): string[] {
    return this.calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.path}`);
  }

  private sortedCampaigns(): Campaign[] {
    return [...this.campaigns].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  private sessionsOf(campaignId: string): Session[] {
    return this.sessions.filter((s) => s.campaign_id === campaignId).sort((a, b) => a.order - b.order);
  }

  private scenesOf(sessionId: string): Scene[] {
    return this.scenes.filter((s) => s.session_id === sessionId).sort((a, b) => a.order - b.order);
  }

  summary(kind: string, id: string): DeletionSummary {
    const sessions =
      kind === 'campaign' ? this.sessionsOf(id) : kind === 'session' ? this.sessions.filter((s) => s.id === id) : [];
    const scenes =
      kind === 'scene' ? this.scenes.filter((s) => s.id === id) : sessions.flatMap((s) => this.scenesOf(s.id));
    return {
      sessions: sessions.length,
      scenes: scenes.length,
      tokens: scenes.reduce((sum, scene) => sum + (this.tokens[scene.id] ?? 0) + this.tokensOf(scene.id).length, 0),
      live: scenes.some((scene) => scene.id === this.liveSceneId),
    };
  }

  // As migration 0001's foreign keys do, deleting the live scene or an ancestor
  // clears the live scene (specs/03-domain-model.md §7).
  private remove(kind: string, id: string): void {
    if (this.summary(kind, id).live) this.liveSceneId = null;
    const summaryScenes = (sessionIds: string[]) => this.scenes.filter((s) => sessionIds.includes(s.session_id));
    if (kind === 'campaign') {
      const ids = this.sessionsOf(id).map((s) => s.id);
      const gone = summaryScenes(ids).map((s) => s.id);
      this.scenes = this.scenes.filter((s) => !gone.includes(s.id));
      this.sessions = this.sessions.filter((s) => s.campaign_id !== id);
      this.campaigns = this.campaigns.filter((c) => c.id !== id);
    } else if (kind === 'session') {
      this.scenes = this.scenes.filter((s) => s.session_id !== id);
      const parent = this.sessions.find((s) => s.id === id)!.campaign_id;
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.sessionsOf(parent).forEach((s, index) => (s.order = index));
    } else {
      const parent = this.scenes.find((s) => s.id === id)!.session_id;
      this.scenes = this.scenes.filter((s) => s.id !== id);
      this.scenesOf(parent).forEach((s, index) => (s.order = index));
    }
  }

  // As D-078, D-090 and D-094 do: a different map starts from its image's preset or the
  // defaults, then the grid fields apply.
  private updateScene(id: string, b: Record<string, unknown>): Reply {
    const scene = this.scenes.find((s) => s.id === id);
    if (!scene) return failure(404, 'not_found');
    const map = b.map_image_id as string | undefined;
    // As the schema and D-094 refuse, before anything is changed: a calibration value of the
    // wrong kind is a validation failure, and any calibration of a scene without a map is refused.
    const grid = b.grid as Record<string, unknown> | undefined;
    const calibrating = grid !== undefined && CALIBRATION_KEYS.some((field) => field in grid);
    if (grid) {
      for (const field of CALIBRATION_KEYS) {
        if (!(field in grid)) continue;
        const value = grid[field];
        const whole = field === 'columns' || field === 'rows';
        const valid =
          typeof value === 'number' &&
          Number.isFinite(value) &&
          (field === 'size' ? value > 0 : true) &&
          (whole ? Number.isInteger(value) && value >= 1 : true);
        if (!valid) return failure(400, 'validation_failed');
      }
      const feet = grid.feet_per_square;
      if (
        feet !== undefined &&
        !(typeof feet === 'number' && feet >= FEET_PER_SQUARE_BOUNDS.min && feet <= FEET_PER_SQUARE_BOUNDS.max)
      ) {
        return failure(400, 'validation_failed');
      }
    }
    if (calibrating && (map ?? scene.map_image_id) === null) return failure(409, 'calibration_needs_map');
    if (map !== undefined && map !== scene.map_image_id) {
      const image = this.images.find((each) => each.id === map);
      if (!image) return failure(400, 'reference_not_found');
      const previous = scene.map_image_id;
      scene.map_image_id = map;
      scene.grid = image.grid_preset ? { ...image.grid_preset } : { ...DEFAULT_GRID };
      // As the server does, the previous map goes once nothing references it (Q-002).
      const used = (imageId: string) =>
        this.scenes.some((each) => each.map_image_id === imageId) ||
        this.assets.some((each) => each.image_id === imageId);
      if (previous !== null && !used(previous)) this.images = this.images.filter((each) => each.id !== previous);
    }
    if (typeof b.name === 'string') scene.name = b.name;
    if (grid) {
      // As D-094 does: calibration merges over the grid and becomes the map's preset.
      scene.grid = { ...scene.grid, ...(grid as Partial<Scene['grid']>) };
      const image = this.images.find((each) => each.id === scene.map_image_id);
      if (calibrating && image) {
        scene.grid.size ??= image.width / scene.grid.columns;
        image.grid_preset = { ...scene.grid, size: scene.grid.size };
      } else if (typeof grid.feet_per_square === 'number' && image?.grid_preset) {
        // As D-121 does: the scale joins a preset already there.
        image.grid_preset = { ...image.grid_preset, feet_per_square: grid.feet_per_square };
      }
    }
    return json(200, { ...scene, grid: { ...scene.grid } });
  }

  private sortedAssets(): LibraryAsset[] {
    return [...this.assets].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  // The library's list, as D-083 filters it.
  private listAssets(query: URLSearchParams): LibraryAsset[] {
    const search = normalizeTag(query.get('q') ?? '');
    const category = query.get('category');
    const tags = query.getAll('tag').map(normalizeTag);
    return this.sortedAssets().filter(
      (asset) =>
        (category === null || asset.category === category) &&
        tags.every((tag) => asset.tags.includes(tag)) &&
        (search === '' || normalizeTag(asset.name).includes(search) || asset.tags.some((tag) => tag.includes(search))),
    );
  }

  private handleAssets(
    method: string,
    id: string | undefined,
    query: URLSearchParams,
    b: Record<string, unknown>,
  ): Reply {
    const tags = (list: unknown) => [...new Set(((list as string[] | undefined) ?? []).map(normalizeTag))].sort();
    if (id === undefined) {
      if (method === 'GET') return json(200, this.listAssets(query));
      if (!this.images.some((image) => image.id === b.image_id)) return failure(400, 'reference_not_found');
      const category = b.category as LibraryAsset['category'];
      const asset = this.addAsset({
        name: String(b.name),
        category,
        image_id: String(b.image_id),
        size: b.size as LibraryAsset['size'],
        default_hidden: typeof b.default_hidden === 'boolean' ? b.default_hidden : category === 'monster',
        notes: typeof b.notes === 'string' ? b.notes : '',
        hp_max: typeof b.hp_max === 'number' ? b.hp_max : null,
        ac: typeof b.ac === 'number' ? b.ac : null,
        tags: tags(b.tags),
      });
      return json(201, asset);
    }
    const asset = this.assets.find((each) => each.id === id);
    if (!asset) return failure(404, 'not_found');
    if (method === 'GET') return json(200, asset);
    if (method === 'PATCH') {
      if (b.image_id !== undefined && !this.images.some((image) => image.id === b.image_id)) {
        return failure(400, 'reference_not_found');
      }
      Object.assign(asset, { ...b, ...(b.tags === undefined ? {} : { tags: tags(b.tags) }) });
      return json(200, asset);
    }
    const usages = this.usages[id] ?? [];
    if (usages.length > 0) return json(409, { error: { code: 'asset_in_use', message: 'test', usages } });
    this.assets = this.assets.filter((each) => each.id !== id);
    return json(204);
  }

  private handle({ method, path: url, body }: Call): Reply {
    const b = (body ?? {}) as Record<string, unknown>;
    const [path = '', search = ''] = url.split('?', 2);
    const query = new URLSearchParams(search);
    if (path === '/api/setup') {
      if (method === 'GET') return json(200, { pin_set: this.pinSet, local: this.local });
      if (this.pinSet) return failure(409, 'pin_already_set');
      this.pinSet = true;
      this.pin = String(b.pin);
      this.signedIn = true;
      return json(200, { dm: true });
    }
    if (path === '/api/auth') {
      if (method === 'GET') return json(200, { dm: this.signedIn });
      if (method === 'DELETE') {
        this.signedIn = false;
        return json(204);
      }
      if (this.pausedFor !== undefined) return failure(429, 'pin_paused', { 'retry-after': String(this.pausedFor) });
      if (this.lockedFor !== undefined) return failure(429, 'locked_out', { 'retry-after': String(this.lockedFor) });
      if (b.pin !== this.pin) return failure(401, 'pin_incorrect');
      this.signedIn = true;
      return json(200, { dm: true });
    }
    if (!this.signedIn) return failure(401, 'unauthorized');
    if (path === '/api/connect' && method === 'GET') {
      const { addresses } = this.connect;
      const chosen = addresses.find((entry) => entry.address === this.tvAddress);
      return json(200, {
        ...this.connect,
        addresses: chosen ? [chosen, ...addresses.filter((entry) => entry !== chosen)] : addresses,
        chosen: this.tvAddress,
        chosen_found: chosen !== undefined,
        automatic: addresses[0]?.address ?? null,
      } satisfies ConnectInfo);
    }
    // How many player views are connected (UIX-01): the open player sockets.
    if (path === '/api/screens' && method === 'GET') {
      return json(200, { count: this.sockets.filter((each) => each.connected && each.view === 'player').length });
    }
    // Each scene's token counts, for the scene list (UIX-01).
    const summaries = /^\/api\/sessions\/([^/]+)\/scenes\/summary$/.exec(path);
    if (summaries && method === 'GET') {
      if (!this.sessions.some((each) => each.id === summaries[1])) return failure(404, 'not_found');
      return json(
        200,
        this.scenesOf(summaries[1]!).map((scene) => {
          const tokens = this.tokensOf(scene.id);
          return {
            id: scene.id,
            tokens: tokens.length + (this.tokens[scene.id] ?? 0),
            hidden: tokens.filter((each) => each.hidden).length,
          };
        }),
      );
    }
    if (path === '/api/settings') {
      // PATCH, as the server checks it (REL-01): strict and bounded, all or nothing.
      if (method === 'PATCH') {
        if (!Value.Check(SettingsUpdateSchema, b)) return failure(400, 'validation_failed');
        const update = b;
        this.uploadLimit = update.upload_limit_bytes ?? this.uploadLimit;
        this.displaySize = update.display_variant_size ?? this.displaySize;
        this.rulerRule = update.ruler_rule ?? this.rulerRule;
        if (update.tv_address !== undefined) this.tvAddress = update.tv_address;
      }
      return json(200, {
        id: '00000000-0000-4000-8000-00000000ffff',
        live_scene_id: this.liveSceneId,
        ruler_rule: this.rulerRule,
        upload_limit_bytes: this.uploadLimit,
        display_variant_size: this.displaySize,
        tv_address: this.tvAddress,
      });
    }
    if (path === '/api/settings/pin' && method === 'PUT') {
      if (!Value.Check(PinChangeBodySchema, b)) return failure(400, 'validation_failed');
      if (this.pausedFor !== undefined) return failure(429, 'pin_paused', { 'retry-after': String(this.pausedFor) });
      if (this.lockedFor !== undefined) return failure(429, 'locked_out', { 'retry-after': String(this.lockedFor) });
      if (b.current_pin !== this.pin) return failure(401, 'pin_incorrect');
      this.pin = String(b.new_pin);
      return json(204);
    }
    if (path === '/api/images' && method === 'POST') {
      this.uploads.push(body);
      return json(201, this.addImage(this.uploadedImage));
    }
    const image = /^\/api\/images\/([0-9a-f]{64})$/.exec(path);
    if (image && method === 'GET') {
      const found = this.images.find((each) => each.id === image[1]);
      return found ? json(200, found) : failure(404, 'not_found');
    }
    const asset = /^\/api\/assets(?:\/([^/]+))?$/.exec(path);
    if (asset) return this.handleAssets(method, asset[1], query, b);
    const notes = /^\/api\/(scenes|tokens)\/([^/]+)\/notes$/.exec(path);
    if (notes) return this.handleNotes(method, notes[1] === 'scenes' ? 'scene' : 'token', notes[2]!, b);
    const sceneTokens = /^\/api\/scenes\/([^/]+)\/tokens$/.exec(path);
    if (sceneTokens) return this.handleTokens(method, sceneTokens[1], undefined, b);
    const token = /^\/api\/tokens\/([^/]+)$/.exec(path);
    if (token) return this.handleTokens(method, undefined, token[1], b);
    const sceneFog = /^\/api\/scenes\/([^/]+)\/fog$/.exec(path);
    if (sceneFog) return this.handleFog(method, sceneFog[1]!, b);

    const match =
      /^\/api\/(campaigns|sessions|scenes)(?:\/([^/]+))?(?:\/(sessions|scenes|deletion|order))?(?:\/(order))?$/.exec(
        path,
      );
    if (!match) return failure(404, 'not_found');
    const [, collection, id, child, order] = match;
    const kind = collection!.slice(0, -1);

    if (collection === 'campaigns' && id === undefined) {
      if (method === 'GET') return json(200, this.sortedCampaigns());
      return json(201, this.addCampaign(String(b.name)));
    }
    const exists =
      kind === 'campaign'
        ? this.campaigns.some((c) => c.id === id)
        : kind === 'session'
          ? this.sessions.some((s) => s.id === id)
          : this.scenes.some((s) => s.id === id);
    if (!exists) return failure(404, 'not_found');

    if (child === 'deletion') return json(200, this.summary(kind, id!));
    if (child === 'sessions' || child === 'scenes') {
      const list = child === 'sessions' ? this.sessionsOf(id!) : this.scenesOf(id!);
      if (order) {
        const ids = b.ids as string[];
        if (ids.length !== list.length || !list.every((item) => ids.includes(item.id))) {
          return failure(409, 'order_mismatch');
        }
        ids.forEach((each, index) => (list.find((item) => item.id === each)!.order = index));
        return json(200, child === 'sessions' ? this.sessionsOf(id!) : this.scenesOf(id!));
      }
      if (method === 'GET') return json(200, list);
      return json(
        201,
        child === 'sessions' ? this.addSession(id!, String(b.title)) : this.addScene(id!, String(b.name)),
      );
    }
    if (method === 'GET') {
      const found =
        kind === 'campaign'
          ? this.campaigns.find((c) => c.id === id)
          : kind === 'session'
            ? this.sessions.find((s) => s.id === id)
            : this.scenes.find((s) => s.id === id);
      return json(200, found);
    }
    if (method === 'PATCH' && kind === 'scene') return this.updateScene(id!, b);
    if (method === 'PATCH') {
      const item =
        kind === 'campaign'
          ? this.campaigns.find((c) => c.id === id)!
          : kind === 'session'
            ? this.sessions.find((s) => s.id === id)!
            : this.scenes.find((s) => s.id === id)!;
      Object.assign(item, b);
      return json(200, item);
    }
    if (method === 'DELETE') {
      const confirm = b.confirm as DeletionSummary | undefined;
      if (JSON.stringify(confirm) !== JSON.stringify(this.summary(kind, id!))) {
        return failure(409, 'confirmation_mismatch');
      }
      this.remove(kind, id!);
      return json(204);
    }
    return failure(404, 'not_found');
  }
}

// The part of XMLHttpRequest that `upload` in dm/api.ts uses, answered by the fake server.
function fakeXhr(server: FakeServer) {
  return class FakeXMLHttpRequest {
    status = 0;
    responseText = '';
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private method = 'GET';
    private path = '';
    private headers: Record<string, string> = {};

    open(method: string, path: string): void {
      this.method = method;
      this.path = path;
    }

    setRequestHeader(): void {}

    getAllResponseHeaders(): string {
      return Object.entries(this.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join('\r\n');
    }

    send(body: unknown): void {
      void (async () => {
        const total = body instanceof Blob ? body.size : 1;
        for (const fraction of server.uploadProgress) {
          this.upload.onprogress?.({ lengthComputable: true, loaded: fraction * total, total } as ProgressEvent);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        let reply: Reply;
        try {
          reply = await server.reply({ method: this.method, path: this.path, body });
        } catch {
          // As fetch rejects when `before` throws: the request got no answer.
          this.onerror?.();
          return;
        }
        this.status = reply.status;
        this.responseText = reply.body === undefined ? '' : JSON.stringify(reply.body);
        this.headers = { 'content-type': 'application/json', ...reply.headers };
        this.onload?.();
      })();
    }
  };
}

// Interaction helpers for jsdom, inside React's act.

/** Lets every pending request and the renders it causes finish. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!element) throw new Error('nothing to click');
  act(() => {
    (element as HTMLElement).click();
  });
  await settle();
}

/** Types `value` into an input the way React sees a user's typing. */
export function type(input: Element | null | undefined, value: string): Promise<void> {
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) throw new Error('not an input');
  act(() => {
    // Through the prototype's setter, which React does not intercept.
    const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Reflect.set(prototype, 'value', value, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return Promise.resolve();
}

export async function submit(form: Element | null | undefined): Promise<void> {
  if (!(form instanceof HTMLFormElement)) throw new Error('not a form');
  act(() => {
    form.requestSubmit();
  });
  await settle();
}

/** A button by its visible text or its accessible name. */
export function button(container: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (each) => each.getAttribute('aria-label') === name || each.textContent === name,
  );
}

/**
 * jsdom has no modal dialog: `showModal` and `close` only open and close it here,
 * with the `close` event. As in a browser, while a modal dialog is open and in the
 * document the page behind it is inert: focusing anything outside it does nothing
 * (REL-01 review U-H1). The browser's focus trap and Escape are the e2e tests'.
 */
export function installDialog(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal === 'function') return;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
    this.dataset.fakeModal = '';
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    delete this.dataset.fakeModal;
    this.dispatchEvent(new Event('close'));
  };
  // Called with `this` bound below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function inertFocus(this: HTMLElement, options?: FocusOptions) {
    const modal = document.querySelector('dialog[data-fake-modal]');
    if (modal && !modal.contains(this)) return;
    focus.call(this, options);
  };
}

/** Opens the header's session switcher, which holds the Campaign → Session → Scene tree (UIX-01). */
export async function openSwitcher(view: HTMLElement): Promise<HTMLElement> {
  const open = view.querySelector<HTMLElement>('.eg-switcher');
  if (open) return open;
  await click(view.querySelector('.eg-header__crumbs'));
  return view.querySelector<HTMLElement>('.eg-switcher')!;
}

/** What the header's live indicator says, its LIVE or IDLE badge aside (UIX-01). */
export function liveText(view: HTMLElement): string {
  const status = view.querySelector('.eg-live [role="status"]');
  if (!status) return '';
  const copy = status.cloneNode(true) as HTMLElement;
  for (const badge of copy.querySelectorAll('.eg-live__badge')) badge.remove();
  return copy.textContent.trim();
}

/** Shows the right-hand panel's Library tab (UIX-01). */
export async function openLibrary(view: ParentNode): Promise<void> {
  const tab = [...view.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (each) => each.textContent === t('side.library'),
  );
  if (tab && tab.getAttribute('aria-selected') !== 'true') await click(tab);
}

/** Opens the selected scene's setup: its map, the players' grid, feet per square and calibration (UIX-01). */
export async function openSetup(view: ParentNode): Promise<void> {
  const toggle = [...view.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(
    (each) => each.textContent === t('sceneSetup.open'),
  );
  if (toggle && toggle.getAttribute('aria-expanded') !== 'true') await click(toggle);
}

/** Selects a scene of the current session in the left sidebar's scene list, by its name (UIX-01). */
export async function selectScene(view: ParentNode, name: string): Promise<void> {
  const row = [...view.querySelectorAll<HTMLButtonElement>('.eg-scenes__select')].find(
    (each) => each.querySelector('.eg-scenes__name')?.textContent === name,
  );
  if (!row) throw new Error(`no scene named ${name} in the scene list`);
  await click(row);
}

/** Selects a token by its label in the right panel's "In this scene" list (UIX-01). */
export async function selectTokenRow(view: ParentNode, label: string): Promise<void> {
  const row = [...view.querySelectorAll<HTMLButtonElement>('.eg-token-row__select')].find(
    (each) => each.querySelector('.eg-token-row__name')?.textContent === label,
  );
  if (!row) throw new Error(`no token labelled ${label} in the list`);
  await click(row);
}

/** The id of the token the list marks as selected, or '' when none is (UIX-01). */
export function selectedTokenId(view: ParentNode): string {
  return view.querySelector<HTMLElement>('.eg-token-row--selected')?.dataset.token ?? '';
}

/** The labels the "In this scene" list shows, in its order (UIX-01). */
export function listedTokens(view: ParentNode): string[] {
  return [...view.querySelectorAll('.eg-token-row__name')].map((each) => each.textContent ?? '');
}

/** The selected token's popover beside it on the map, if one is shown (UIX-01). */
export function popover(view: ParentNode): HTMLElement | null {
  return view.querySelector<HTMLElement>('.eg-popover');
}

/** Runs an item of the selected token's "…" menu in its popover: Duplicate, To front, To back, Delete (UIX-01). */
export async function tokenMenu(view: ParentNode, label: string, item: string): Promise<void> {
  const box = popover(view);
  if (!box) throw new Error('no token popover is shown');
  await click(button(box, t('tokens.moreOf', { label })));
  const entry = [...box.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.querySelector('span')?.textContent === item,
  );
  if (!entry) throw new Error(`no menu item ${item}`);
  await click(entry);
}
