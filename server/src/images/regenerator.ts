import type Database from 'better-sqlite3';
import { listImageIds } from '../db/images.js';
import { readSettings } from '../db/settings.js';
import type { Logger } from '../log/logger.js';
import { regenerateDisplayVersion, type Commit } from './store.js';

// Display versions follow the display-size setting in the background (specs/05-assets-and-images.md
// §7, specs/09-operations.md §7, G-015, REL-01). One worker brings every image to the setting, one
// image at a time, skipping those already at it, and reads the setting again before each image, so a
// change during a run starts a new pass at the new size instead of finishing at the old one. It is
// asked again (kick) when the setting is saved and when an upload stored a display version of a size
// that is no longer the setting's, which is how an upload received while a run was going, or started
// before the change, is regenerated too.

export interface DisplayRegenerator {
  /** Asks for a pass at the current setting; the work runs in the background. */
  kick(): void;
  /** Settles once no pass runs or is asked for: for the tests. */
  idle(): Promise<void>;
  /** Stops after the image in hand; nothing starts afterwards. */
  stop(): Promise<void>;
}

export interface DisplayRegeneratorOptions {
  db: Database.Database;
  imagesDir: string;
  logger: Logger;
  /** Stores each new display version; the live socket's refresh, so the TV hears of a new size. */
  commit?: Commit | undefined;
}

export function createDisplayRegenerator({
  db,
  imagesDir,
  logger,
  commit,
}: DisplayRegeneratorOptions): DisplayRegenerator {
  let asked = false;
  let stopped = false;
  let running: Promise<void> | undefined;

  const pass = async (): Promise<void> => {
    const size = readSettings(db).display_variant_size;
    let regenerated = 0;
    const failed: string[] = [];
    for (const id of listImageIds(db)) {
      if (stopped) return;
      // Changed again: this pass is over, and the next one runs at the new size.
      if (readSettings(db).display_variant_size !== size) {
        asked = true;
        break;
      }
      const outcome = await regenerateDisplayVersion(db, imagesDir, id, size, commit);
      if (outcome === 'regenerated') regenerated++;
      else if (outcome === 'failed') failed.push(id);
    }
    if (regenerated > 0) {
      logger.info('images.regenerated', `Regenerated ${regenerated} display versions at ${size} px.`, {
        regenerated,
        size,
      });
    }
    if (failed.length > 0) {
      logger.warn('images.regenerate_failed', 'Some display versions could not be regenerated.', { ids: failed });
    }
  };

  const run = async (): Promise<void> => {
    while (asked && !stopped) {
      asked = false;
      try {
        await pass();
      } catch (error) {
        logger.error('images.regenerate_error', 'Regenerating display versions stopped.', { error });
      }
    }
  };

  // A kick that lands after the last pass looked for one, but before the run ended, starts another.
  const start = (): void => {
    running = run().finally(() => {
      running = undefined;
      if (asked && !stopped) start();
    });
  };

  return {
    kick() {
      asked = true;
      if (!running && !stopped) start();
    },
    async idle() {
      while (running) await running;
    },
    async stop() {
      stopped = true;
      await running;
    },
  };
}
