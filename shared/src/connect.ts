import { Type, type Static } from 'typebox';
import { Ipv4Schema } from './entities.js';

// Connecting a screen (specs/08-ux-journeys.md §5, Q-026, Q-110; LIV-03, PKG-01). The server lists
// every non-internal IPv4 address of its PC with its adapter's name and the player view's URL on it,
// the TV address first: the one the DM chose in Settings while the PC has it, else the first
// private-range address of an adapter not named as virtual. The DM view's address is never among
// them. The QR code is the first URL's,
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
    /** The network adapter's name as the system gives it, e.g. `Wi-Fi` or `vEthernet (WSL)`. */
    adapter: Type.String({ maxLength: 256 }),
    /** The adapter's name marks it as virtual (WSL, Hyper-V, a VM, Docker, a VPN), so it is ranked last. */
    virtual: Type.Boolean(),
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
    // The TV address chosen in Settings, or null for Automatic, and whether this PC has it now; when it
    // does not, the addresses are in the automatic order and the panel says so.
    chosen: Type.Union([Ipv4Schema, Type.Null()]),
    chosen_found: Type.Boolean(),
    // The address Automatic picks, the first with no choice; null when there is no address. Settings names it.
    automatic: Type.Union([Ipv4Schema, Type.Null()]),
  },
  strict,
);

export type ConnectAddress = Static<typeof ConnectAddressSchema>;
export type QrCode = Static<typeof QrCodeSchema>;
export type ConnectInfo = Static<typeof ConnectInfoSchema>;

// GET /api/screens (UIX-01, specs/08-ux-journeys.md §11): how many player views are connected now, the
// header's screens counter. DM only, like every /api route; players never learn it.
export const API_SCREENS_PATH = '/api/screens';
export const ScreenCountSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
export type ScreenCount = Static<typeof ScreenCountSchema>;
