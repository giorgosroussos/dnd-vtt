import { act } from 'react';
import { Value } from 'typebox/value';
import {
  TokenCreateBodySchema,
  TokenUpdateBodySchema,
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
  type Session,
} from '@emberglass/shared';
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
const uuid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export class FakeServer {
  pinSet = true;
  local = true;
  signedIn = true;
  pin = '4826';
  lockedFor: number | undefined;
  campaigns: Campaign[] = [];
  sessions: Session[] = [];
  scenes: Scene[] = [];
  tokens: Record<string, number> = {};
  liveSceneId: string | null = null;
  uploadLimit = 50 * 1024 * 1024;
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
  /** The highest number issued per scene and asset, as `scene.token_numbers` (Q-091). */
  private issued: Record<string, number> = {};
  /** What GET /api/connect answers (LIV-03): two addresses and a code of the first. */
  connect: ConnectInfo = {
    addresses: [
      { address: '192.168.1.20', url: 'http://192.168.1.20:3000/', private: true },
      { address: '100.64.3.4', url: 'http://100.64.3.4:3000/', private: false },
    ],
    qr: {
      size: 21,
      rows: Array.from({ length: 21 }, (_, y) => (y % 2 ? '10'.repeat(10) + '1' : '01'.repeat(10) + '0')),
    },
  };
  calls: Call[] = [];
  /** Answers a live command before the fake applies it, to refuse it or hold it; undefined applies it. */
  beforeCommand: ((command: CommandEnvelope) => CommandAck | Promise<CommandAck> | undefined) | undefined;
  /** The `dm` room's version counter (D-108). */
  private dmVersion = 1;
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
      character_id: null,
      asset: { name: asset.name, image_id: asset.image_id, size: asset.size },
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
    const revealed =
      token.hidden && fields.hidden === false && fields.label === undefined && token.label === token.asset.name;
    Object.assign(token, fields, typeof fields.label === 'string' ? { label: fields.label.trim() } : {});
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
    const original = globalThis.fetch;
    const fakeSockets = installFakeSockets((socket) => {
      socket.onCommand = (command, ack) => {
        void Promise.resolve(this.beforeCommand?.(command)).then((answer) => ack(answer ?? this.command(command)));
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
    if (call.method === 'GET') return this.handle(call);
    const before = this.dmSnapshot();
    const reply = this.handle(call);
    const after = this.dmSnapshot();
    if (before.scene !== null && after.scene === null) this.deliver('scene.cleared', {});
    else if (JSON.stringify(before) !== JSON.stringify(after)) this.deliver('scene.snapshot', after);
    return reply;
  }

  // --- the live side (LIV-04) ---

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
      },
    };
  }

  private withAsset(token: SceneToken): SceneToken {
    const asset = this.assets.find((each) => each.id === token.asset_id);
    return structuredClone(
      asset ? { ...token, asset: { name: asset.name, image_id: asset.image_id, size: asset.size } } : token,
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

  private command({ type, payload }: CommandEnvelope): CommandAck {
    const refuse = (code: ErrorCode): CommandAck => ({ error: { code, message: 'test' } });
    if (!this.signedIn) return refuse('forbidden');
    const p = payload;
    const liveToken = () => {
      const token = this.sceneTokens.find((each) => each.id === p.token_id);
      return token ? (token.scene_id === this.liveSceneId ? token : 'not_live') : undefined;
    };
    switch (type) {
      case 'scene.activate': {
        if (!this.scenes.some((each) => each.id === p.scene_id)) return refuse('not_found');
        this.liveSceneId = String(p.scene_id);
        this.deliver('scene.snapshot', this.dmSnapshot());
        return { ok: true };
      }
      case 'scene.deactivate': {
        if (this.liveSceneId === null) return { ok: true };
        this.liveSceneId = null;
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
      case 'token.delete': {
        const token = liveToken();
        if (token === undefined) return refuse('not_found');
        if (token === 'not_live') return refuse('scene_not_live');
        this.sceneTokens = this.sceneTokens.filter((each) => each !== token);
        this.deliver('token.removed', { id: token.id });
        return { ok: true };
      }
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
      if (this.lockedFor !== undefined) return failure(429, 'locked_out', { 'retry-after': String(this.lockedFor) });
      if (b.pin !== this.pin) return failure(401, 'pin_incorrect');
      this.signedIn = true;
      return json(200, { dm: true });
    }
    if (!this.signedIn) return failure(401, 'unauthorized');
    if (path === '/api/connect' && method === 'GET') return json(200, this.connect);
    if (path === '/api/settings') {
      return json(200, {
        id: '00000000-0000-4000-8000-00000000ffff',
        live_scene_id: this.liveSceneId,
        ruler_rule: 'phb',
        upload_limit_bytes: this.uploadLimit,
        display_variant_size: 4096,
      });
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
    const sceneTokens = /^\/api\/scenes\/([^/]+)\/tokens$/.exec(path);
    if (sceneTokens) return this.handleTokens(method, sceneTokens[1], undefined, b);
    const token = /^\/api\/tokens\/([^/]+)$/.exec(path);
    if (token) return this.handleTokens(method, undefined, token[1], b);

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
  if (!(input instanceof HTMLInputElement)) throw new Error('not an input');
  act(() => {
    // Through the prototype's setter, which React does not intercept.
    Reflect.set(HTMLInputElement.prototype, 'value', value, input);
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
 * with the `close` event. The browser's focus trap and Escape are the e2e tests'.
 */
export function installDialog(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal?: () => void };
  if (typeof proto.showModal === 'function') return;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
