import { Type, type Static } from 'typebox';

// The PIN, the DM session and the routes that grant them
// (specs/07-security-and-access.md §1, §2, §6, specs/02-architecture.md §5, D-027, D-048).

// Numeric, 4 to 8 ASCII digits (specs/07-security-and-access.md §6).
export const PIN_PATTERN = '^[0-9]{4,8}$';
export const PinSchema = Type.String({ pattern: PIN_PATTERN });

const strict = { additionalProperties: false } as const;

// First-run setup (POST /api/setup) and PIN entry (POST /api/auth).
export const PinBodySchema = Type.Object({ pin: PinSchema }, strict);

// PIN change from the DM view (PUT /api/settings/pin), with the current PIN.
export const PinChangeBodySchema = Type.Object({ current_pin: PinSchema, new_pin: PinSchema }, strict);

// GET /api/auth: whether the calling browser itself holds a DM session, and
// nothing about any other session (Q-085).
export const AuthStateSchema = Type.Object({ dm: Type.Boolean() }, strict);

// GET /api/setup: whether a PIN is set, and whether this browser is on the
// server machine and so may set it (specs/07-security-and-access.md §1).
export const SetupStateSchema = Type.Object({ pin_set: Type.Boolean(), local: Type.Boolean() }, strict);

// The routes a browser without a DM session may reach; every other /api route
// and every unknown /api path is refused without one (specs/02-architecture.md §5).
export const API_PATHS = {
  auth: '/api/auth',
  setup: '/api/setup',
  settings: '/api/settings',
  pin: '/api/settings/pin',
} as const;

export const PUBLIC_API_ROUTES = [
  { method: 'GET', url: API_PATHS.auth },
  { method: 'POST', url: API_PATHS.auth },
  { method: 'DELETE', url: API_PATHS.auth },
  { method: 'GET', url: API_PATHS.setup },
  { method: 'POST', url: API_PATHS.setup },
] as const;

export type PinBody = Static<typeof PinBodySchema>;
export type PinChangeBody = Static<typeof PinChangeBodySchema>;
export type AuthState = Static<typeof AuthStateSchema>;
export type SetupState = Static<typeof SetupStateSchema>;
