import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandType, Room, SceneToken } from '@emberglass/shared';
import { connectLive, type CommandOutcome, type LiveConnection, type LiveStatus } from '../../live/connection.js';
import { applyDmEvent, fromDmSnapshot, type DmScene } from './dmScene.js';

export interface DmLive {
  status: LiveStatus;
  /** The room of the latest snapshot: `players` means the server no longer knows this session. */
  role: Room | undefined;
  /** The live scene: undefined until the first DM snapshot, null while nothing is live. */
  scene: DmScene | undefined;
  /** How many snapshots arrived. */
  snapshots: number;
  command: (type: CommandType, payload: object) => Promise<CommandOutcome>;
  reconnect: () => void;
  /** The live scene now, read when called: once a command is acknowledged, its events are in (D-111). */
  current: () => DmScene | undefined;
  /** The token the latest `token.added` carried: after `token.add` is acknowledged, the one it placed. */
  lastAdded: () => SceneToken | undefined;
}

// The DM workspace's live connection (LIV-01, LIV-04; specs/04-live-sync.md §2, §3, §5, §6, D-104):
// the live scene from the `dm` room's snapshots and events, which the live bar and the live canvas
// follow, so a second DM browser's changes show here as they happen (G-018); and the commands the
// live canvas, Go live and Blank TV send.
export function useDmLive(): DmLive {
  const [state, setState] = useState<Pick<DmLive, 'status' | 'role' | 'scene' | 'snapshots'>>({
    status: 'connecting',
    role: undefined,
    scene: undefined,
    snapshots: 0,
  });
  const connection = useRef<LiveConnection>(undefined);
  // Written by the connection's handlers as each message arrives, before React renders it.
  const scene = useRef<DmScene | undefined>(undefined);
  const added = useRef<SceneToken | undefined>(undefined);

  useEffect(() => {
    const live = connectLive('dm', {
      onStatus: (status) => setState((current) => ({ ...current, status })),
      onSnapshot: (snapshot) => {
        const role = snapshot.role;
        if (role === 'dm') scene.current = fromDmSnapshot(snapshot);
        setState((current) => ({
          ...current,
          role,
          scene: role === 'dm' ? scene.current : current.scene,
          snapshots: current.snapshots + 1,
        }));
      },
      onEvent: (event) => {
        if (scene.current === undefined) return;
        if (event.type === 'token.added') added.current = (event.payload as { token?: SceneToken }).token;
        scene.current = applyDmEvent(scene.current, event);
        const next = scene.current;
        setState((current) => ({ ...current, scene: next }));
      },
    });
    connection.current = live;
    return () => {
      connection.current = undefined;
      live.close();
    };
  }, []);

  const command = useCallback(
    (type: CommandType, payload: object): Promise<CommandOutcome> =>
      connection.current?.command(type, payload) ?? Promise.resolve({ ok: false, code: 'network' }),
    [],
  );
  const reconnect = useCallback(() => connection.current?.reconnect(), []);
  const current = useCallback(() => scene.current, []);
  const lastAdded = useCallback(() => added.current, []);

  return { ...state, command, reconnect, current, lastAdded };
}
