import { useEffect, useRef, useState } from 'react';
import { API_TOKEN_PATHS, type SceneToken, type TokenChange, type TokenUpdateBody } from '@emberglass/shared';
import type { CanvasToken } from '../../canvas/tokens.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { errorCode, request } from '../api.js';

// The tokens of the selected scene in the DM view (PRP-04, D-100), read from the server when the
// scene is selected and changed over REST. A move is shown at once and sent. The writes of one
// token (changes and its deletion) are sent one after another, each once the previous one has been
// answered, so the server stores them in the order they were made; while several are queued (a
// drag, then arrow keys), only the answer to the latest is applied, and only its refusal is shown,
// so an earlier answer cannot move the token back on screen. A refusal shows why and reads the
// scene's tokens again, so the view shows what the server stored; a change made from a dialog may
// take its refusal to show beside its field instead.
//
// While the scene is live its tokens come from the `dm` room and change only by live commands
// (LIV-04, specs/04-live-sync.md §2), so nothing is read here; they are read again when the scene
// returns to prep mode, since live play changed them.

export const sceneTokensPath = (sceneId: string): string =>
  API_TOKEN_PATHS.sceneTokens.replace(':id', encodeURIComponent(sceneId));
export const tokenPath = (id: string): string => API_TOKEN_PATHS.token.replace(':id', encodeURIComponent(id));

export const toCanvasToken = (token: SceneToken): CanvasToken => ({
  id: token.id,
  label: token.label,
  x: token.x,
  y: token.y,
  hidden: token.hidden,
  z_order: token.z_order,
  size: token.asset.size,
  image_id: token.asset.image_id,
});

export type ChangeResult =
  { ok: true; token: SceneToken } | { ok: false; message: string } | { ok: false; stale: true };

export interface SceneTokens {
  /** Undefined until the scene's tokens have arrived. */
  tokens: SceneToken[] | undefined;
  /** Why the scene's tokens could not be read; `retry` reads them again. */
  loadFailure: string | undefined;
  retry: () => void;
  /** Why the last change was refused. */
  failure: string | undefined;
  place: (assetId: string, at: { x: number; y: number }) => Promise<SceneToken | undefined>;
  /** `inline`: the caller shows a refusal itself, and the page does not. */
  change: (id: string, body: TokenUpdateBody, options?: { inline?: boolean }) => Promise<ChangeResult>;
  remove: (id: string) => Promise<boolean>;
}

export function useSceneTokens(sceneId: string, live = false): SceneTokens {
  const [tokens, setTokens] = useState<SceneToken[]>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [version, setVersion] = useState(0);
  // The latest write per token: an answer to an older one is not applied.
  const latest = useRef(new Map<string, number>());
  const sequence = useRef(0);
  // The last write sent or queued per token, which the next one waits for.
  const queue = useRef(new Map<string, Promise<unknown>>());

  useEffect(() => {
    if (live) return;
    let active = true;
    request<SceneToken[]>('GET', sceneTokensPath(sceneId)).then(
      (list) => {
        if (!active) return;
        setTokens(list);
        setLoadFailure(undefined);
      },
      (error: unknown) => {
        if (active) setLoadFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sceneId, version, live]);

  const reload = () => setVersion((each) => each + 1);
  const refused = (error: unknown) => {
    setFailure(errorMessage(errorCode(error)));
    reload();
  };

  const replace = (list: SceneToken[] | undefined, updated: readonly SceneToken[]): SceneToken[] | undefined =>
    list?.map((token) => updated.find((each) => each.id === token.id) ?? token);

  /** Sends a write of token `id` once its earlier writes have been answered. */
  function queued<T>(id: string, send: () => Promise<T>): { mine: number; sent: Promise<T> } {
    const mine = ++sequence.current;
    latest.current.set(id, mine);
    const previous = queue.current.get(id) ?? Promise.resolve();
    const sent = previous.catch(() => undefined).then(send);
    queue.current.set(id, sent);
    return { mine, sent };
  }

  async function place(assetId: string, at: { x: number; y: number }): Promise<SceneToken | undefined> {
    setFailure(undefined);
    try {
      const created = await request<TokenChange>('POST', sceneTokensPath(sceneId), { asset_id: assetId, ...at });
      setTokens((list) => [...(replace(list, created.relabelled) ?? []), created.token]);
      return created.token;
    } catch (error) {
      refused(error);
      return undefined;
    }
  }

  async function change(id: string, body: TokenUpdateBody, options: { inline?: boolean } = {}): Promise<ChangeResult> {
    setFailure(undefined);
    // A move, a visibility or a label change shows at once; the stacking order waits for the
    // server's, and a change from a dialog waits for its answer, which the dialog shows.
    if (!options.inline) {
      const shown = Object.fromEntries(
        Object.entries({ x: body.x, y: body.y, hidden: body.hidden, label: body.label }).filter(
          ([, value]) => value !== undefined,
        ),
      );
      setTokens((list) => list?.map((token) => (token.id === id ? { ...token, ...shown } : token)));
    }
    const { mine, sent } = queued(id, () => request<TokenChange>('PATCH', tokenPath(id), body));
    try {
      const updated = await sent;
      if (latest.current.get(id) !== mine) return { ok: false, stale: true };
      // A reveal may number the token and rename the lone one beside it (Q-092).
      setTokens((list) => replace(list, [updated.token, ...updated.relabelled]));
      return { ok: true, token: updated.token };
    } catch (error) {
      if (latest.current.get(id) !== mine) return { ok: false, stale: true };
      const message = errorMessage(errorCode(error));
      if (options.inline) reload();
      else refused(error);
      return { ok: false, message };
    }
  }

  async function remove(id: string): Promise<boolean> {
    setFailure(undefined);
    // After the token's queued changes, which the deletion supersedes.
    const { sent } = queued(id, () => request<undefined>('DELETE', tokenPath(id)));
    try {
      await sent;
      latest.current.delete(id);
      queue.current.delete(id);
      setTokens((list) => list?.filter((token) => token.id !== id));
      return true;
    } catch (error) {
      refused(error);
      return false;
    }
  }

  return { tokens, loadFailure, retry: reload, failure, place, change, remove };
}
