import type os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  API_CONNECT_PATH,
  API_PATHS,
  API_SCREENS_PATH,
  ConnectInfoSchema,
  PLAYER_VIEW_AUTH,
  PUBLIC_API_ROUTES,
  SOCKET_PATH,
  type ConnectInfo,
  type Settings,
} from '@emberglass/shared';
import { io as connectSocket, type Socket } from 'socket.io-client';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, dmCookie, setUpPin, type TestData } from './testing/app.js';

// GET /api/connect, what the "Connect a screen" panel shows (LIV-03, PKG-01, specs/08-ux-journeys.md §5,
// specs/02-architecture.md §5, D-112, Q-110), against a real SQLite file and a real port.

const PIN = '73019264';
let data: TestData;
let app: FastifyInstance;
let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;

const ipv4 = (address: string, internal = false) =>
  ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null }) as const;

beforeEach(async () => {
  data = createTestData('emberglass-connect-');
  interfaces = {
    lo: [ipv4('127.0.0.1', true)],
    vpn: [ipv4('100.64.3.4')],
    'vEthernet (WSL)': [ipv4('172.21.112.1')],
    wlan: [ipv4('192.168.1.20')],
  };
  app = await buildTestApp(data, { networkInterfaces: () => interfaces });
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
  data.remove();
});

const port = () => (app.server.address() as { port: number }).port;

describe('GET /api/connect', () => {
  it('is not public: without a DM session it is refused and says nothing of the addresses', async () => {
    expect(PUBLIC_API_ROUTES.some((route) => (route.url as string) === API_CONNECT_PATH)).toBe(false);
    const response = await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('192.168');
  });

  it('gives a DM the player view on every LAN address at the port it listens on, ranked by adapter, with its QR code', async () => {
    const cookie = await setUpPin(app, PIN);
    const response = await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ConnectInfo;
    expect(compileSchema(ConnectInfoSchema)(body)).toBe(true);
    expect(body.addresses).toEqual([
      {
        address: '192.168.1.20',
        url: `http://192.168.1.20:${port()}/`,
        private: true,
        adapter: 'wlan',
        virtual: false,
      },
      {
        address: '172.21.112.1',
        url: `http://172.21.112.1:${port()}/`,
        private: true,
        adapter: 'vEthernet (WSL)',
        virtual: true,
      },
      { address: '100.64.3.4', url: `http://100.64.3.4:${port()}/`, private: false, adapter: 'vpn', virtual: true },
    ]);
    expect(body).toMatchObject({ chosen: null, chosen_found: false });
    expect(body.qr?.size).toBe(body.qr?.rows.length);
    expect(JSON.stringify(body)).not.toContain('/dm');
  });

  it('reads the addresses at each request, so a PC that joins the Wi-Fi later is listed', async () => {
    const cookie = await setUpPin(app, PIN);
    interfaces = { lo: [ipv4('127.0.0.1', true)] };
    const before = (await (
      await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } })
    ).json()) as ConnectInfo;
    expect(before).toEqual({ addresses: [], qr: null, chosen: null, chosen_found: false, automatic: null });
    interfaces = { wlan: [ipv4('10.0.0.8')] };
    const after = (await (
      await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } })
    ).json()) as ConnectInfo;
    expect(after.addresses.map((entry) => entry.url)).toEqual([`http://10.0.0.8:${port()}/`]);
    expect(after.qr).not.toBeNull();
  });
});

// The TV address chosen in Settings, the emergency correction of the ranking (specs/08-ux-journeys.md §5,
// specs/09-operations.md §7, Q-110): stored, read at each request, and dropped back to Automatic when gone.
describe('the TV address chosen in Settings', () => {
  const connect = async (cookie: string) =>
    (await (
      await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } })
    ).json()) as ConnectInfo;
  const patch = (cookie: string, body: object) =>
    fetch(`http://127.0.0.1:${port()}${API_PATHS.settings}`, {
      method: 'PATCH',
      headers: { cookie, origin: `http://127.0.0.1:${port()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('puts the chosen address first and in the QR code, kept across a restart, and back to Automatic with null', async () => {
    const cookie = await setUpPin(app, PIN);
    const saved = await patch(cookie, { tv_address: '172.21.112.1' });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Settings).tv_address).toBe('172.21.112.1');
    const chosen = await connect(cookie);
    expect(chosen.addresses.map((entry) => entry.address)).toEqual(['172.21.112.1', '192.168.1.20', '100.64.3.4']);
    expect(chosen).toMatchObject({ chosen: '172.21.112.1', chosen_found: true, automatic: '192.168.1.20' });
    // Stored in the database, not in memory: a restarted server, on the same data directory, still uses it.
    const restarted = await buildTestApp({ ...data, db: data.reopen() }, { networkInterfaces: () => interfaces });
    try {
      const signIn = await restarted.inject({ method: 'POST', url: '/api/auth', payload: { pin: PIN } });
      const again = await restarted.inject({
        method: 'GET',
        url: API_CONNECT_PATH,
        headers: { cookie: dmCookie(signIn) },
      });
      expect(again.json<ConnectInfo>()).toMatchObject({ chosen: '172.21.112.1', chosen_found: true });
      expect(again.json<ConnectInfo>().addresses[0]!.address).toBe('172.21.112.1');
    } finally {
      await restarted.close();
    }

    expect((await patch(cookie, { tv_address: null })).status).toBe(200);
    const automatic = await connect(cookie);
    expect(automatic.addresses[0]!.address).toBe('192.168.1.20');
    expect(automatic).toMatchObject({ chosen: null, chosen_found: false });
  });

  it('falls back to the automatic order when the PC no longer has the chosen address, and says so', async () => {
    const cookie = await setUpPin(app, PIN);
    expect((await patch(cookie, { tv_address: '192.168.1.20' })).status).toBe(200);
    interfaces = { 'vEthernet (WSL)': [ipv4('172.21.112.1')], wlan: [ipv4('192.168.1.77')] };
    const info = await connect(cookie);
    expect(info.addresses[0]!.address).toBe('192.168.1.77');
    expect(info).toMatchObject({ chosen: '192.168.1.20', chosen_found: false });
  });

  it('refuses what is not an IPv4 address, and a browser without a DM session, changing nothing', async () => {
    const cookie = await setUpPin(app, PIN);
    for (const tv_address of ['192.168.1.256', 'emberglass.local', 'http://192.168.1.20:3000/', '', 7]) {
      expect((await patch(cookie, { tv_address })).status, String(tv_address)).toBe(400);
    }
    const anonymous = await fetch(`http://127.0.0.1:${port()}${API_PATHS.settings}`, {
      method: 'PATCH',
      headers: { origin: `http://127.0.0.1:${port()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tv_address: '100.64.3.4' }),
    });
    expect(anonymous.status).toBe(401);
    expect((await connect(cookie)).chosen).toBeNull();
  });
  // That the players room hears nothing of it, with a scene live, is server/src/ws/settings.test.ts.
});

describe('GET /api/screens (UIX-01, specs/08-ux-journeys.md §11)', () => {
  const screens = async (cookie: string) =>
    (
      (await (await fetch(`http://127.0.0.1:${port()}${API_SCREENS_PATH}`, { headers: { cookie } })).json()) as {
        count: number;
      }
    ).count;
  const open = (auth?: object, cookie?: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = connectSocket(`http://127.0.0.1:${port()}`, {
        path: SOCKET_PATH,
        transports: ['websocket'],
        extraHeaders: { origin: `http://127.0.0.1:${port()}`, ...(cookie ? { cookie } : {}) },
        ...(auth ? { auth } : {}),
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  const until = async (cookie: string, count: number) => {
    for (let tries = 0; tries < 50 && (await screens(cookie)) !== count; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return screens(cookie);
  };

  it('is not public: without a DM session it is refused', async () => {
    expect(PUBLIC_API_ROUTES.some((route) => (route.url as string) === API_SCREENS_PATH)).toBe(false);
    expect((await fetch(`http://127.0.0.1:${port()}${API_SCREENS_PATH}`)).status).toBe(401);
  });

  it('counts the connected player views, a DM view not among them, and follows them as they go', async () => {
    const cookie = await setUpPin(app, PIN);
    expect(await screens(cookie)).toBe(0);
    const dm = await open(undefined, cookie);
    const tv = await open();
    const laptopTv = await open({ ...PLAYER_VIEW_AUTH }, cookie);
    expect(await until(cookie, 2)).toBe(2);
    tv.disconnect();
    expect(await until(cookie, 1)).toBe(1);
    laptopTv.disconnect();
    dm.disconnect();
    expect(await until(cookie, 0)).toBe(0);
  });
});
