import { Type, type Static } from 'typebox';

// Connecting a screen (specs/08-ux-journeys.md §5, Q-026, Q-053; LIV-03). The server lists every
// non-internal IPv4 address of its PC, the first private-range one first, each with the player
// view's URL on it; the DM view's address is never among them. The QR code is the first URL's,
// encoded on the server so that nothing is fetched to draw it (specs/02-architecture.md §6), and
// sent as rows of modules, dark as `1`, without the quiet zone, which the drawing adds.
// GET /api/connect needs a DM session like every /api route (specs/02-architecture.md §5).

export const API_CONNECT_PATH = '/api/connect';

const strict = { additionalProperties: false } as const;

export const ConnectAddressSchema = Type.Object(
  {
    address: Type.String({ pattern: '^[0-9]{1,3}(\\.[0-9]{1,3}){3}$' }),
    /** The player view on that address, e.g. `http://192.168.1.20:3000/`. */
    url: Type.String({ pattern: '^http://[0-9.]+(:[0-9]+)?/$' }),
    /** In 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16. */
    private: Type.Boolean(),
  },
  strict,
);

export const QrCodeSchema = Type.Object(
  {
    size: Type.Integer({ minimum: 21, maximum: 177 }),
    rows: Type.Array(Type.String({ pattern: '^[01]+$' })),
  },
  strict,
);

export const ConnectInfoSchema = Type.Object(
  {
    // Empty when the PC has no network address; otherwise the first is the one to show prominently.
    addresses: Type.Array(ConnectAddressSchema),
    // The first address's URL as a QR code; null when there is no address.
    qr: Type.Union([QrCodeSchema, Type.Null()]),
  },
  strict,
);

export type ConnectAddress = Static<typeof ConnectAddressSchema>;
export type QrCode = Static<typeof QrCodeSchema>;
export type ConnectInfo = Static<typeof ConnectInfoSchema>;
