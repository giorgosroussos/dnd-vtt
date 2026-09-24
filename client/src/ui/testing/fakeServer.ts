import { act } from 'react';
import type { Campaign, DeletionSummary, Scene, Session } from '@emberglass/shared';

// Test tooling only, never bundled: a scripted stand-in for the server behind
// `fetch`, for the DM view's component tests (D-085). It keeps a small tree the
// way the SRV-03 routes do (D-078): campaigns by name, sessions and scenes in their
// order, deletion only when the confirmation equals the current count. A test
// can intercept any request first with `before`, to answer it differently or to
// hold it open. The server's real behaviour is proven by server/src/http/*.test.ts;
// the end-to-end tests run the view against it.

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
  calls: Call[] = [];
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
      grid: {
        type: 'square',
        size: null,
        offset_x: 0,
        offset_y: 0,
        visible: true,
        feet_per_square: 5,
        columns: 30,
        rows: 20,
      },
    };
    this.scenes.push(scene);
    this.tokens[scene.id] = tokens;
    return scene;
  }

  /** Replaces `fetch` until `uninstall`. */
  install(): this {
    const original = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const call = { method: init?.method ?? 'GET', path, body };
      this.calls.push(call);
      const reply = (await this.before?.(call)) ?? this.handle(call);
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...reply.headers },
      });
    };
    this.restore = () => {
      globalThis.fetch = original;
    };
    return this;
  }

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
      tokens: scenes.reduce((sum, scene) => sum + (this.tokens[scene.id] ?? 0), 0),
      live: scenes.some((scene) => scene.id === this.liveSceneId),
    };
  }

  private remove(kind: string, id: string): void {
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

  private handle({ method, path, body }: Call): Reply {
    const b = (body ?? {}) as Record<string, unknown>;
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
