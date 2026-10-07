import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { API_MAP_NOTE_PATHS, type MapNote, type MapNoteDeleteQuery } from '@emberglass/shared';
import type { Point } from '../../canvas/tokens.js';
import { errorMessage } from '../../ui/errorMessage.js';
import { errorCode, request } from '../api.js';
import { mapNoteTarget } from './MapNotes.js';
import { forgetDraft } from './NotesEditor.js';

// The map notes of the scene the DM view shows (UXR-08, specs/04-live-sync.md §16, specs/08-ux-journeys.md §14): on a
// prepared scene read over REST when it is selected, on the live scene the `dm` room's, kept current by
// `mapNotes.updated`. Either way every change goes over REST, and what the server answers is shown at once, so a move
// does not wait for the event; a move is shown before it is sent, and a refusal reads the notes again and says why.
// A note that leaves the list, deleted here or elsewhere, takes any unsaved text of it along (`forgetDraft`).

export const sceneMapNotesPath = (sceneId: string): string =>
  API_MAP_NOTE_PATHS.sceneMapNotes.replace(':id', encodeURIComponent(sceneId));
export const mapNotePath = (id: string): string => API_MAP_NOTE_PATHS.mapNote.replace(':id', encodeURIComponent(id));
const IF_EMPTY: MapNoteDeleteQuery = { if_empty: 'true' };

export interface MapNotes {
  /** Undefined until a prepared scene's notes have arrived. */
  notes: MapNote[] | undefined;
  /** Why the last change was refused. */
  failure: string | undefined;
  /** Why a prepared scene's notes could not be read; `retry` reads them again. */
  loadFailure: string | undefined;
  retry: () => void;
  create: (at: Point) => Promise<MapNote | undefined>;
  move: (id: string, at: Point) => void;
  /** Stores a note's whole text; rejects when the server did not, so the editor keeps it and says why. */
  saveText: (id: string, text: string) => Promise<void>;
  /** Deletes a note whatever it holds: the deletion the DM confirmed. */
  remove: (id: string) => Promise<boolean>;
  /**
   * Deletes a note closed empty, only if the server holds it empty too (`if_empty`): one written into in another
   * window since is kept, and the notes are read again.
   */
  removeIfEmpty: (id: string) => Promise<void>;
}

export function useMapNotes(sceneId: string, live: MapNote[] | undefined): MapNotes {
  const [notes, setNotes] = useState<MapNote[] | undefined>(live);
  const [failure, setFailure] = useState<string>();
  const [loadFailure, setLoadFailure] = useState<string>();
  const [version, setVersion] = useState(0);
  // The live scene's notes replace what is shown whenever the `dm` room sends them.
  const [heard, setHeard] = useState(live);
  if (live !== heard) {
    setHeard(live);
    if (live !== undefined) setNotes(live);
  }
  const isLive = live !== undefined;
  // The `dm` room's last word, for an answer that arrives after a later event.
  const heardLatest = useRef(live);
  useLayoutEffect(() => {
    heardLatest.current = live;
  });

  // A note gone from the list, by a deletion here or in another window, leaves no unsaved text behind.
  const shown = useRef(notes);
  useEffect(() => {
    const before = shown.current;
    shown.current = notes;
    if (before === undefined || notes === undefined) return;
    for (const note of before) if (!notes.some((each) => each.id === note.id)) forgetDraft(mapNoteTarget(note.id));
  }, [notes]);

  useEffect(() => {
    if (isLive) return;
    let active = true;
    request<MapNote[]>('GET', sceneMapNotesPath(sceneId)).then(
      (list) => {
        if (!active) return;
        setNotes(list);
        setLoadFailure(undefined);
      },
      (error: unknown) => {
        if (active) setLoadFailure(errorMessage(errorCode(error)));
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
  // What the server holds: read again on a prepared scene, the `dm` room's last word on the live one.
  const reread = () => {
    if (isLive) setNotes(heardLatest.current);
    else setVersion((each) => each + 1);
  };
  const refused = (error: unknown) => {
    setFailure(errorMessage(errorCode(error)));
    reread();
  };

  return {
    notes,
    failure,
    loadFailure,
    retry: () => setVersion((each) => each + 1),
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
        forgetDraft(mapNoteTarget(id));
        return true;
      } catch (error) {
        refused(error);
        return false;
      }
    },
    removeIfEmpty: async (id) => {
      try {
        await request<void>('DELETE', `${mapNotePath(id)}?${new URLSearchParams(IF_EMPTY).toString()}`);
        setNotes((now) => now?.filter((each) => each.id !== id));
        forgetDraft(mapNoteTarget(id));
      } catch (error) {
        // Written into elsewhere since this view last heard: kept, as the server holds it.
        if (errorCode(error) === 'map_note_not_empty') reread();
        else refused(error);
      }
    },
  };
}
