import http from 'node:http';
import https from 'node:https';
import type os from 'node:os';
import jsqr from 'jsqr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectInfoSchema, VIEW_PATHS, type QrCode } from '@emberglass/shared';
import {
  connectBanner,
  connectInfo,
  isPrivateIpv4,
  isVirtualAdapter,
  lanAddresses,
  playerViewUrl,
  qrCode,
} from './connect.js';
import { compileSchema } from './validation.js';

// Connecting a screen (LIV-03, PKG-01, specs/08-ux-journeys.md §5, specs/09-operations.md §2, §4, Q-026,
// Q-076, Q-110).

type Entry = os.NetworkInterfaceInfo;
const entry = (address: string, { internal = false } = {}): Entry => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});
const v6 = (address: string, { internal = false } = {}): Entry => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/64`,
  scopeid: 0,
});

// A laptop with loopback, a VPN, a link-local adapter, the Wi-Fi and a virtual switch, in the order the system gives them.
const INTERFACES: NodeJS.Dict<Entry[]> = {
  lo: [entry('127.0.0.1', { internal: true }), v6('::1', { internal: true })],
  vpn0: [entry('100.64.12.7')],
  eth1: [entry('169.254.10.3')],
  wlan0: [v6('fe80::1'), entry('192.168.1.20')],
  vEthernet: [entry('172.20.0.1')],
};

/** Reads a QR code the way a phone does: from pixels, with a quiet zone. */
function decode(qr: QrCode): string | undefined {
  const scale = 4;
  const quiet = 4;
  const side = (qr.size + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  qr.rows.forEach((row, y) =>
    [...row].forEach((module, x) => {
      if (module !== '1') return;
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const at = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
          pixels.fill(0, at, at + 3);
        }
    }),
  );
  return jsQR(pixels, side, side)?.data;
}

/** Reads the console's QR code back: each character is two modules, light ones drawn (upper half, lower half). */
function decodeBlock(lines: readonly string[]): string | undefined {
  const rows: string[] = [];
  for (const line of lines) {
    rows.push([...line].map((char) => ('█▀'.includes(char) ? '0' : '1')).join(''));
    rows.push([...line].map((char) => ('█▄'.includes(char) ? '0' : '1')).join(''));
  }
  const width = rows[0]!.length;
  return decode({ size: width, rows: rows.slice(0, width) });
}

// jsqr is CommonJS with a default export: Node's interop and TypeScript's disagree on where it lands.
type Decode = typeof jsqr.default;
const jsqrModule: unknown = jsqr;
const jsQR = ((jsqrModule as { default?: Decode }).default ?? jsqrModule) as Decode;

afterEach(() => vi.restoreAllMocks());

// The owner's Windows PC with WSL and VMware, in the order Windows gave its adapters on 2026-10-02: the
// panel highlighted vEthernet (WSL) and the phone could not open it (Q-110).
const OWNERS_PC: NodeJS.Dict<Entry[]> = {
  'vEthernet (WSL)': [v6('fe80::a'), entry('172.21.112.1')],
  'vEthernet (Default Switch)': [entry('172.20.48.1')],
  'VMware Network Adapter VMnet1': [entry('192.168.186.1')],
  'VMware Network Adapter VMnet8': [entry('192.168.36.1')],
  'Wi-Fi': [v6('fe80::3a96:8ce3:3810:880c'), entry('192.168.1.133')],
  'Loopback Pseudo-Interface 1': [entry('127.0.0.1', { internal: true })],
};

describe('LAN addresses (Q-110)', () => {
  it('lists every non-internal IPv4 address once with its adapter, other adapters before virtual ones, private first', () => {
    const listed = lanAddresses({ ...INTERFACES, dup: [entry('192.168.1.20')] }, 3000);
    expect(listed.map((each) => each.address)).toEqual(['192.168.1.20', '169.254.10.3', '172.20.0.1', '100.64.12.7']);
    expect(listed.map((each) => each.adapter)).toEqual(['wlan0', 'eth1', 'vEthernet', 'vpn0']);
    expect(listed.map((each) => each.virtual)).toEqual([false, false, true, true]);
    expect(listed.map((each) => each.private)).toEqual([true, false, true, false]);
    expect(listed[0]!.url).toBe('http://192.168.1.20:3000/');
  });

  it("puts the Wi-Fi first on the owner's PC, before WSL's and VMware's adapters, and its QR code opens it", () => {
    const info = connectInfo(OWNERS_PC, 3000);
    expect(info.addresses.map((each) => `${each.address} ${each.adapter}`)).toEqual([
      '192.168.1.133 Wi-Fi',
      '172.21.112.1 vEthernet (WSL)',
      '172.20.48.1 vEthernet (Default Switch)',
      '192.168.186.1 VMware Network Adapter VMnet1',
      '192.168.36.1 VMware Network Adapter VMnet8',
    ]);
    expect(decode(info.qr!)).toBe('http://192.168.1.133:3000/');
    expect(info).toMatchObject({ chosen: null, chosen_found: false, automatic: '192.168.1.133' });
  });

  it('knows the virtual adapters of Windows, Linux and macOS by name, and not the real ones', () => {
    for (const name of [
      'vEthernet (WSL)',
      'vEthernet (WSL (Hyper-V firewall))',
      'vEthernet (Default Switch)',
      'Hyper-V Virtual Ethernet Adapter',
      'VMware Network Adapter VMnet8',
      'VirtualBox Host-Only Network',
      'vboxnet0',
      'docker0',
      'br-3f2a1c9d0e11',
      'veth1a2b3c',
      'virbr0',
      'lxcbr0',
      'utun3',
      'tun0',
      'tap0',
      'wg0',
      'Tailscale',
      'tailscale0',
      'ZeroTier One [8056c2e21c000001]',
      'ztks5abc12',
      'Hamachi',
      'NordLynx',
      'OpenVPN Data Channel Offload',
      'vpn0',
      'Npcap Loopback Adapter',
    ])
      expect(isVirtualAdapter(name), name).toBe(true);
    for (const name of ['Wi-Fi', 'Ethernet', 'Ethernet 2', 'WLAN', 'wlan0', 'wlp2s0', 'eth0', 'enp3s0', 'en0', 'en1'])
      expect(isVirtualAdapter(name), name).toBe(false);
  });

  it('uses the TV address chosen in Settings first while the PC has it, the rest in the automatic order', () => {
    const info = connectInfo(OWNERS_PC, 3000, '192.168.36.1');
    expect(info.addresses.map((each) => each.address)).toEqual([
      '192.168.36.1',
      '192.168.1.133',
      '172.21.112.1',
      '172.20.48.1',
      '192.168.186.1',
    ]);
    expect(decode(info.qr!)).toBe('http://192.168.36.1:3000/');
    expect(info).toMatchObject({ chosen: '192.168.36.1', chosen_found: true, automatic: '192.168.1.133' });
    expect(compileSchema(ConnectInfoSchema)(info)).toBe(true);
  });

  it('falls back to the automatic order when the PC no longer has the chosen address, and says so', () => {
    const info = connectInfo(OWNERS_PC, 3000, '10.0.0.40');
    expect(info.addresses[0]!.address).toBe('192.168.1.133');
    expect(decode(info.qr!)).toBe('http://192.168.1.133:3000/');
    expect(info).toMatchObject({ chosen: '10.0.0.40', chosen_found: false });
    const banner = connectBanner(info, 'win32');
    expect(banner).toContain('The TV address chosen in Settings, 10.0.0.40, is not an address of this PC now');
    expect(banner).toContain('open http://192.168.1.133:3000/ in the TV');
    expect(connectBanner(connectInfo(OWNERS_PC, 3000, '192.168.1.133'), 'win32')).not.toContain('not an address');
  });

  it('keeps the system order among equals, and lists public ones when none is private', () => {
    expect(lanAddresses({ a: [entry('10.0.0.5')], b: [entry('192.168.0.9')] }, 3000).map((e) => e.address)).toEqual([
      '10.0.0.5',
      '192.168.0.9',
    ]);
    expect(lanAddresses({ a: [entry('100.64.1.1')], b: [entry('8.8.4.4')] }, 3000).map((e) => e.address)).toEqual([
      '100.64.1.1',
      '8.8.4.4',
    ]);
    expect(lanAddresses({ lo: [entry('127.0.0.1', { internal: true })] }, 3000)).toEqual([]);
  });

  it('accepts the family given as a number, as some Node versions give it, and still leaves IPv6 out', () => {
    const listed = lanAddresses(
      {
        a: [{ ...entry('192.168.1.5'), family: 4 as never }],
        b: [{ ...v6('fe80::2'), family: 6 as never }],
      },
      3000,
    );
    expect(listed.map((each) => each.address)).toEqual(['192.168.1.5']);
  });

  it('knows the private ranges of RFC 1918 and their edges', () => {
    for (const address of [
      '10.0.0.0',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '192.168.255.255',
    ])
      expect(isPrivateIpv4(address), address).toBe(true);
    for (const address of [
      '9.255.255.255',
      '11.0.0.0',
      '172.15.255.255',
      '172.32.0.0',
      '192.167.1.1',
      '192.169.0.1',
      '169.254.1.1',
      '100.64.0.1',
    ])
      expect(isPrivateIpv4(address), address).toBe(false);
  });

  it('puts the player view in every URL, never the DM view, and leaves out port 80', () => {
    expect(playerViewUrl('192.168.1.20', 80)).toBe('http://192.168.1.20/');
    expect(playerViewUrl('192.168.1.20', 8080)).toBe('http://192.168.1.20:8080/');
    for (const each of lanAddresses(INTERFACES, 3000)) {
      expect(new URL(each.url).pathname).toBe(VIEW_PATHS.player);
      expect(each.url).not.toContain(VIEW_PATHS.dm);
    }
  });
});

describe('the QR code (Q-026)', () => {
  it('encodes the first address’s player-view URL, as a phone reads it', () => {
    const info = connectInfo(INTERFACES, 3000);
    expect(compileSchema(ConnectInfoSchema)(info)).toBe(true);
    expect(info.qr).not.toBeNull();
    expect(info.qr!.rows).toHaveLength(info.qr!.size);
    expect(info.qr!.rows.every((row) => row.length === info.qr!.size)).toBe(true);
    expect(decode(info.qr!)).toBe('http://192.168.1.20:3000/');
  });

  it('has no QR code when there is no address', () => {
    expect(connectInfo({}, 3000)).toEqual({
      addresses: [],
      qr: null,
      chosen: null,
      chosen_found: false,
      automatic: null,
    });
    expect(connectInfo({}, 3000, '192.168.1.133')).toMatchObject({ qr: null, chosen_found: false });
  });

  it('is made in the process, without any request leaving it (specs/02-architecture.md §6)', () => {
    const refuse = () => {
      throw new Error('a request was made');
    };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(refuse);
    const httpRequest = vi.spyOn(http, 'request').mockImplementation(refuse);
    const httpsRequest = vi.spyOn(https, 'request').mockImplementation(refuse);
    expect(decode(qrCode('http://10.0.0.5:3000/'))).toBe('http://10.0.0.5:3000/');
    expect(connectBanner(connectInfo(INTERFACES, 3000), 'linux')).toContain('http://192.168.1.20:3000/');
    for (const spy of [fetch, httpRequest, httpsRequest]) expect(spy).not.toHaveBeenCalled();
  });
});

describe('the console at start (specs/09-operations.md §2, §4)', () => {
  it('names the player view’s URL, draws its QR code and lists the other addresses, never the DM view', () => {
    const banner = connectBanner(connectInfo(INTERFACES, 3000), 'linux');
    expect(banner).toContain('open http://192.168.1.20:3000/ in the TV');
    expect(banner).toContain("open http://192.168.1.20:3000/ in the TV's browser, or scan this code (wlan0).");
    expect(banner).toContain(
      'Other addresses of this PC: http://169.254.10.3:3000/ (eth1)  http://172.20.0.1:3000/ (vEthernet)  http://100.64.12.7:3000/ (vpn0)',
    );
    expect(banner).toContain('choose the right one as the TV address in Settings');
    expect(banner).not.toContain('/dm');
    // The QR code block: every line of it drawn with block characters only.
    const block = banner.split('\n').filter((line) => /^[█▀▄ ]+$/.test(line) && line.includes('█'));
    expect(block.length).toBeGreaterThan(10);
    expect(decodeBlock(block)).toBe('http://192.168.1.20:3000/');
    expect(banner).not.toContain('Firewall');
  });

  it('tells the DM on Windows to allow private networks only (Q-076)', () => {
    const banner = connectBanner(connectInfo(INTERFACES, 3000), 'win32');
    expect(banner).toContain('If Windows Firewall asks about Emberglass or Node.js, allow it on private networks only');
  });

  it('says so when the PC has no network address', () => {
    const banner = connectBanner(connectInfo({}, 3000), 'linux');
    expect(banner).toContain('No network address was found');
    expect(banner).not.toContain('http://');
  });
});
