import os from 'node:os';
import { encode, renderUnicodeCompact } from 'uqr';
import { VIEW_PATHS, type ConnectAddress, type ConnectInfo, type QrCode } from '@emberglass/shared';

// Connecting a screen (specs/08-ux-journeys.md §5, specs/09-operations.md §2, §4, Q-026, Q-053,
// Q-076; LIV-03). The server lists every non-internal IPv4 address of its PC, the first
// private-range one first and the others in the order the system gives them, each with the
// player view's URL on it. The QR code encodes the first URL only; it is made here, by `uqr`
// (no dependencies, bundled with the server), so nothing outside the LAN is asked to draw it
// (specs/02-architecture.md §6). Only the player view is ever encoded or listed: the DM view's
// address is never put in a QR code (Q-026). Addresses are read afresh each time, since a laptop
// may join the Wi-Fi after the server started.

export type NetworkInterfaces = () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;

const PRIVATE_RANGES: readonly [number, number][] = [
  [0x0a000000, 8], // 10.0.0.0/8
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
];

function toNumber(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

/** In one of the private ranges of RFC 1918. */
export function isPrivateIpv4(address: string): boolean {
  const value = toNumber(address);
  return PRIVATE_RANGES.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === base / 2 ** (32 - bits));
}

/** The player view's URL on `address`: the root of the server (specs/02-architecture.md §2). */
export function playerViewUrl(address: string, port: number): string {
  return `http://${address}${port === 80 ? '' : `:${port}`}${VIEW_PATHS.player}`;
}

/** Every non-internal IPv4 address, the first private-range one moved to the front (Q-053). */
export function lanAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, port: number): ConnectAddress[] {
  const seen = new Set<string>();
  const listed: ConnectAddress[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      // Node gives `family` as 'IPv4', or as 4 in some versions.
      const ipv4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      if (!ipv4 || entry.internal || seen.has(entry.address)) continue;
      seen.add(entry.address);
      listed.push({
        address: entry.address,
        url: playerViewUrl(entry.address, port),
        private: isPrivateIpv4(entry.address),
      });
    }
  }
  const first = listed.findIndex((entry) => entry.private);
  if (first > 0) listed.unshift(...listed.splice(first, 1));
  return listed;
}

/** The QR code of `text`, dark modules as `1`, without the quiet zone. */
export function qrCode(text: string): QrCode {
  const { size, data } = encode(text, { border: 0, ecc: 'M' });
  return { size, rows: data.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')) };
}

export function connectInfo(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>, port: number): ConnectInfo {
  const addresses = lanAddresses(interfaces, port);
  return { addresses, qr: addresses[0] ? qrCode(addresses[0].url) : null };
}

export const systemInterfaces: NetworkInterfaces = () => os.networkInterfaces();

/**
 * What the console shows at start (specs/09-operations.md §2, §4): the player view's URL and its
 * QR code, the other addresses, and on Windows the firewall advice (Q-076). The QR code is drawn
 * with light blocks for light modules, which reads on the dark background of a usual terminal,
 * with a quiet zone of two modules.
 */
export function connectBanner(info: ConnectInfo, platform: NodeJS.Platform): string {
  const lines: string[] = [];
  const [first, ...others] = info.addresses;
  if (!first) {
    lines.push('No network address was found. Connect this PC to the Wi-Fi the TV uses, then restart Emberglass.');
  } else {
    lines.push(`Connect a screen: open ${first.url} in the TV's browser, or scan this code.`);
    lines.push(renderUnicodeCompact(first.url, { border: 2, ecc: 'M' }).trimEnd());
    if (others.length > 0) lines.push(`Other addresses of this PC: ${others.map((entry) => entry.url).join('  ')}`);
  }
  if (platform === 'win32') {
    lines.push('If Windows Firewall asks about Node.js, allow it on private networks only, not public ones.');
  }
  return `${lines.join('\n')}\n`;
}
