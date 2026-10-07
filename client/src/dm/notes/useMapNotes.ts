import { useEffect, useState } from 'react';
import { API_MAP_NOTE_PATHS, type MapNote } from '@emberglass/shared';
import type { Point } from '../../canvas/tokens.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { errorCode, request } from '../api.js';

// The map notes of the scene the DM view shows (UXR-08, specs/04-live-sync.md §16, specs/08-ux-journeys.md §14): on a
// prepared scene read over REST when it is selected, on the live scene the `dm` room's, kept current by
// `mapNotes.updated`. Either way every change goes over REST, and what the server answers is shown at once, so a move
// does not wait for the event; a move is shown before it is sent, and a refusal reads the notes again and says why.

export const sceneMapNotesPath = (sceneId: string): string =>
  API_MAP_NOTE_PATHS.sceneMapNotes.replace(':id', encodeURIComponent(sceneId));
export const mapNotePath = (id: string): string => API_MAP_NOTE_PATHS.mapNote.replace(':id', encodeURIComponent(id));

export interface MapNotes {
  /** Undefined until a prepared scene's notes have arrived. */
  notes: MapNote[] | undefined;
  /** Why the last change was refused, or why the notes could not be read. */
  failure: string | undefined;
  create: (at: Point) => Promise<MapNote | undefined>;
  move: (id: string, at: Point) => void;
  /** Stores a note's whole text; rejects when the server did not, so the editor keeps it and says why. */
  saveText: (id: string, text: string) => Promise<void>;
  remove: (id: string) => Promise<boolean>;
}

export function useMapNotes(sceneId: string, live: MapNote[] | undefined): MapNotes {
  const [notes, setNotes] = useState<MapNote[] | undefined>(live);
  const [failure, setFailure] = useState<string>();
  const [version, setVersion] = useState(0);
  // The live scene's notes replace what is shown whenever the `dm` room sends them.
  const [heard, setHeard] = useState(live);
  if (live !== heard) {
    setHeard(live);
    if (live !== undefined) setNotes(live);
  }
  const isLive = live !== undefined;

  useEffect(() => {
    if (isLive) return;
    let active = true;
    request<MapNote[]>('GET', sceneMapNotesPath(sceneId)).then(
      (list) => {
        if (active) setNotes(list);
      },
      (error: unknown) => {
        if (active) setFailure(errorMessage(errorCode(error)));
      },
    );
    return () => {
      active = false;
    };
  }, [sceneId, version, isLive]);

  const stored = (note: MapNote) =>
    setNotes((now) => {
      if (now === undefined || note.scene_id !== sceneId) return now;
      return now.some((each) => each.id === note.id)
        ? now.map((each) => (each.id === note.id ? note : each))
        : [...now, note];
    });
  const refused = (error: unknown) => {
    setFailure(errorMessage(errorCode(error)));
    // What the server holds: read again on a prepared scene, the `dm` room's last word on the live one.
    if (isLive) setNotes(live);
    else setVersion((each) => each + 1);
  };

  return {
    notes,
    failure,
    create: async (at) => {
      try {
        const note = await request<MapNote>('POST', sceneMapNotesPath(sceneId), { x: at.x, y: at.y });
        setFailure(undefined);
        stored(note);
        return note;
      } catch (error) {
        refused(error);
        return undefined;
      }
    },
    move: (id, at) => {
      setNotes((now) => now?.map((each) => (each.id === id ? { ...each, x: at.x, y: at.y } : each)));
      request<MapNote>('PATCH', mapNotePath(id), { x: at.x, y: at.y }).then((note) => {
        setFailure(undefined);
        stored(note);
      }, refused);
    },
    saveText: async (id, text) => {
      stored(await request<MapNote>('PATCH', mapNotePath(id), { notes: text }));
    },
    remove: async (id) => {
      try {
        await request<void>('DELETE', mapNotePath(id));
        setFailure(undefined);
        setNotes((now) => now?.filter((each) => each.id !== id));
        return true;
      } catch (error) {
        refused(error);
        return false;
      }
    },
  };
}
