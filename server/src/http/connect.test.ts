import type os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_CONNECT_PATH, ConnectInfoSchema, PUBLIC_API_ROUTES, type ConnectInfo } from '@emberglass/shared';
import { compileSchema } from '../validation.js';
import { buildTestApp, createTestData, setUpPin, type TestData } from './testing/app.js';

// GET /api/connect, what the "Connect a screen" panel shows (LIV-03, specs/08-ux-journeys.md §5,
// specs/02-architecture.md §5, D-112), against a real SQLite file and a real port.

const PIN = '73019264';
let data: TestData;
let app: FastifyInstance;
let interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>;

const ipv4 = (address: string, internal = false) =>
  ({ address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal, cidr: null }) as const;

beforeEach(async () => {
  data = createTestData('emberglass-connect-');
  interfaces = { lo: [ipv4('127.0.0.1', true)], vpn: [ipv4('100.64.3.4')], wlan: [ipv4('192.168.1.20')] };
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

  it('gives a DM the player view on every LAN address at the port it listens on, the private one first, with its QR code', async () => {
    const cookie = await setUpPin(app, PIN);
    const response = await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as ConnectInfo;
    expect(compileSchema(ConnectInfoSchema)(body)).toBe(true);
    expect(body.addresses).toEqual([
      { address: '192.168.1.20', url: `http://192.168.1.20:${port()}/`, private: true },
      { address: '100.64.3.4', url: `http://100.64.3.4:${port()}/`, private: false },
    ]);
    expect(body.qr?.size).toBe(body.qr?.rows.length);
    expect(JSON.stringify(body)).not.toContain('/dm');
  });

  it('reads the addresses at each request, so a PC that joins the Wi-Fi later is listed', async () => {
    const cookie = await setUpPin(app, PIN);
    interfaces = { lo: [ipv4('127.0.0.1', true)] };
    const before = (await (
      await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } })
    ).json()) as ConnectInfo;
    expect(before).toEqual({ addresses: [], qr: null });
    interfaces = { wlan: [ipv4('10.0.0.8')] };
    const after = (await (
      await fetch(`http://127.0.0.1:${port()}${API_CONNECT_PATH}`, { headers: { cookie } })
    ).json()) as ConnectInfo;
    expect(after.addresses.map((entry) => entry.url)).toEqual([`http://10.0.0.8:${port()}/`]);
    expect(after.qr).not.toBeNull();
  });
});
