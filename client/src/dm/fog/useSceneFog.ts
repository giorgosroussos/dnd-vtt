import { useEffect, useState } from 'react';
import { API_FOG_PATHS, type FogMask, type FogStroke } from '@emberglass/shared';
import { errorMessage } from '../../ui/errorMessage.js';
import { errorCode, request } from '../api.js';
import type { DmLive } from '../live/useDmLive.js';

// A scene's painted fog in the DM view (TBL-04, specs/04-live-sync.md §2, §13, Q-101). In preparation it is
// read and written over REST, and has no undo, as no preparation edit has; on the live scene it comes from
// the `dm` room, and each stroke is a `fog.paint` command, each fill or clear a `fog.fill`, undoable like any
// other. Either way a write answers nothing when it was taken, or why it was refused; a write in preparation
// may renumber the tokens it lets players see, so `onWritten` asks the caller to read them again.

export const sceneFogPath = (sceneId: string): string =>
  API_FOG_PATHS.sceneFog.replace(':id', encodeURIComponent(sceneId));

export interface SceneFog {
  /** Undefined until it has arrived. */
  fog: FogMask | undefined;
  /** Why the fog could not be read. */
  failure: string | undefined;
  paint: (stroke: FogStroke) => Promise<string | undefined>;
  fill: (fogged: boolean) => Promise<string | undefined>;
}

export function useSceneFog(
  sceneId: string,
  live: DmLive | undefined,
  isLive: boolean,
  onWritten?: () => void,
): SceneFog {
  const [read, setRead] = useState<{ sceneId: string; fog: FogMask }>();
  const [failure, setFailure] = useState<string>();
  const liveFog = isLive && live?.scene?.scene.id === sceneId ? live.scene.fog : undefined;

  useEffect(() => {
    if (isLive) return;
    let active = true;
    request<FogMask>('GET', sceneFogPath(sceneId)).then(
      (fog) => {
        if (active) setRead({ sceneId, fog });
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sceneId, isLive]);

  /** Sends a live command, or a REST write in preparation, whose answer is the fog after it. */
  async function write(command: () => [string, object], body: object): Promise<string | undefined> {
    if (isLive) {
      if (!live) return errorMessage('network');
      const [type, payload] = command();
      const outcome = await live.command(type as Parameters<DmLive['command']>[0], payload);
      return outcome.ok ? undefined : errorMessage(outcome.code);
    }
    try {
      const fog = await request<FogMask>('POST', sceneFogPath(sceneId), body);
      setRead({ sceneId, fog });
      return undefined;
    } catch (error) {
      return errorMessage(errorCode(error));
    } finally {
      onWritten?.();
    }
  }

  return {
    fog: isLive ? liveFog : read?.sceneId === sceneId ? read.fog : undefined,
    failure,
    paint: (stroke) => write(() => ['fog.paint', { scene_id: sceneId, stroke }], { stroke }),
    fill: (fogged) => write(() => ['fog.fill', { scene_id: sceneId, fogged }], { fill: fogged }),
  };
}
