import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import {
  API_PATHS,
  SettingsSchema,
  SettingsUpdateSchema,
  type Settings,
  type SettingsUpdate,
} from '@emberglass/shared';
import { readSettings, updateSettings } from '../db/settings.js';
import type { DisplayRegenerator } from '../images/regenerator.js';
import type { Logger } from '../log/logger.js';
import type { LiveSocket } from '../ws/live.js';
import { clientAddress } from './auth.js';

// PATCH /api/settings (REL-01, specs/09-operations.md §7, Q-051): the DM changes the upload limit,
// the display-version size and the ruler's diagonal rule without restarting. The session guard and
// the Origin check of auth.ts come first, like every /api write; the body is strict and bounded
// (SettingsUpdateSchema), so a refused one changes nothing. Each setting takes effect where it is
// read: the upload limit on the next upload (images.ts reads it for each one), the rule at the next
// distance the server counts, and the display size through the regenerator in the background. The
// write runs through the live socket's refresh, so a measurement shown on the TV is counted again by
// the new rule and sent to both rooms in a fresh snapshot, and nobody hears of anything else.
// The answer is serialised through SettingsSchema, which has no PIN hash (G-008).

export interface SettingsRoutesOptions {
  db: Database.Database;
  logger: Logger;
  live: Pick<LiveSocket, 'refresh'>;
  regenerator: Pick<DisplayRegenerator, 'kick'>;
}

export function registerSettings(app: FastifyInstance, { db, logger, live, regenerator }: SettingsRoutesOptions): void {
  app.patch<{ Body: SettingsUpdate }>(
    API_PATHS.settings,
    { schema: { body: SettingsUpdateSchema, response: { 200: SettingsSchema } } },
    (request, reply) => {
      const before = readSettings(db);
      const after = live.refresh(() => updateSettings(db, request.body));
      const changed = (['upload_limit_bytes', 'display_variant_size', 'ruler_rule'] as const).filter(
        (key) => before[key] !== after[key],
      );
      if (changed.length > 0) {
        logger.info('settings.changed', `Settings changed: ${changed.join(', ')}.`, {
          address: clientAddress(request),
          ...Object.fromEntries(changed.map((key) => [key, after[key]])),
        });
      }
      // Saved again unchanged, it still finishes a regeneration a restart interrupted.
      if (request.body.display_variant_size !== undefined) regenerator.kick();
      return reply.send(after satisfies Settings);
    },
  );
}
