import { Type, type Static } from 'typebox';
import { IMPORT_LIMIT_BOUNDS } from './archive.js';
import { Ipv4Schema, RULER_RULES } from './entities.js';

// The settings a DM changes from the DM view without restarting (specs/09-operations.md §7, Q-051):
// the upload limit (specs/05-assets-and-images.md §6), the display-version size (§7) and the ruler's
// diagonal rule (specs/06-grid-and-measurement.md §5, Q-037), and the TV address of the connect panel
// (specs/08-ux-journeys.md §5, specs/09-operations.md §7, Q-110), and the import limit (specs/09-operations.md §7, §9,
// Q-119). `PATCH /api/settings` takes any of
// them, each bounded, and answers the settings (`SettingsSchema`, which never carries the PIN hash).

// 1 MiB to 1 GiB: an upload is streamed to disk and never held in memory (D-044, D-080), and a
// battlemap of 10,000 px is well under the top.
export const UPLOAD_LIMIT_BOUNDS = { min: 1024 * 1024, max: 1024 * 1024 * 1024 } as const;
// A display version below 512 px is useless on a TV; above 16,383 px WebP cannot store it.
export const DISPLAY_SIZE_BOUNDS = { min: 512, max: 16_383 } as const;

export const SettingsUpdateSchema = Type.Object(
  {
    upload_limit_bytes: Type.Optional(
      Type.Integer({ minimum: UPLOAD_LIMIT_BOUNDS.min, maximum: UPLOAD_LIMIT_BOUNDS.max }),
    ),
    display_variant_size: Type.Optional(
      Type.Integer({ minimum: DISPLAY_SIZE_BOUNDS.min, maximum: DISPLAY_SIZE_BOUNDS.max }),
    ),
    ruler_rule: Type.Optional(Type.Enum(RULER_RULES)),
    // An address of this PC, or null for Automatic. The server stores any IPv4 address, so that a choice
    // made while the Wi-Fi was off is not refused; the panel offers only the detected ones.
    tv_address: Type.Optional(Type.Union([Ipv4Schema, Type.Null()])),
    import_limit_bytes: Type.Optional(
      Type.Integer({ minimum: IMPORT_LIMIT_BOUNDS.min, maximum: IMPORT_LIMIT_BOUNDS.max }),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
);

export type SettingsUpdate = Static<typeof SettingsUpdateSchema>;
