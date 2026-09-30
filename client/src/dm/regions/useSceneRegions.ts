import { useEffect, useState } from 'react';
import { API_REGION_PATHS, type Region, type RegionShape } from '@emberglass/shared';
import { errorMessage } from '../../ui/errorMessage.js';
import { errorCode, request } from '../api.js';
import type { DmLive } from '../live/useDmLive.js';

// A scene's fog regions in the DM view (TBL-03, specs/04-live-sync.md §2, §13, Q-099). In preparation they
// are read and written over REST; on the live scene they come from the `dm` room, and each change is a
// region command, undoable like any other. Either way a write answers nothing when it was taken, or why it
// was refused; a write in preparation may renumber the tokens it lets players see, so `onWritten` asks the
// caller to read them again.

export const sceneRegionsPath = (sceneId: string): string =>
  API_REGION_PATHS.sceneRegions.replace(':id', encodeURIComponent(sceneId));
export const regionPath = (id: string): string => API_REGION_PATHS.region.replace(':id', encodeURIComponent(id));

export interface SceneRegions {
  /** Undefined until they have arrived. */
  regions: Region[] | undefined;
  /** Why the regions could not be read. */
  failure: string | undefined;
  add: (name: string, shape: RegionShape) => Promise<string | undefined>;
  rename: (id: string, name: string) => Promise<string | undefined>;
  setHidden: (id: string, hidden: boolean) => Promise<string | undefined>;
  remove: (id: string) => Promise<string | undefined>;
}

export function useSceneRegions(
  sceneId: string,
  live: DmLive | undefined,
  isLive: boolean,
  onWritten?: () => void,
): SceneRegions {
  const [listed, setListed] = useState<Region[]>();
  const [failure, setFailure] = useState<string>();
  const [version, setVersion] = useState(0);
  const liveRegions = isLive && live?.scene?.scene.id === sceneId ? live.scene.regions : undefined;

  useEffect(() => {
    if (isLive) return;
    let active = true;
    request<Region[]>('GET', sceneRegionsPath(sceneId)).then(
      (list) => {
        if (active) setListed(list);
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sceneId, isLive, version]);

  /** Sends a live command, or a REST write in preparation, then reads the regions again. */
  async function write(command: () => [string, object], rest: () => Promise<unknown>): Promise<string | undefined> {
    if (isLive) {
      if (!live) return errorMessage('network');
      const [type, payload] = command();
      const outcome = await live.command(type as Parameters<DmLive['command']>[0], payload);
      return outcome.ok ? undefined : errorMessage(outcome.code);
    }
    try {
      await rest();
      return undefined;
    } catch (error) {
      return errorMessage(errorCode(error));
    } finally {
      setVersion((each) => each + 1);
      onWritten?.();
    }
  }

  return {
    regions: isLive ? liveRegions : listed,
    failure,
    add: (name, shape) =>
      write(
        () => ['region.add', { scene_id: sceneId, name, shape }],
        () => request('POST', sceneRegionsPath(sceneId), { name, shape }),
      ),
    rename: (id, name) =>
      write(
        () => ['region.rename', { region_id: id, name }],
        () => request('PATCH', regionPath(id), { name }),
      ),
    setHidden: (id, hidden) =>
      write(
        () => ['region.setHidden', { region_id: id, hidden }],
        () => request('PATCH', regionPath(id), { hidden }),
      ),
    remove: (id) =>
      write(
        () => ['region.delete', { region_id: id }],
        () => request('DELETE', regionPath(id)),
      ),
  };
}
