import os from 'node:os';
import { encode, renderUnicodeCompact } from 'uqr';
import { VIEW_PATHS, type ConnectAddress, type ConnectInfo, type QrCode } from '@emberglass/shared';

// Connecting a screen (specs/08-ux-journeys.md §5, specs/09-operations.md §2, §4, Q-026, Q-076,
// Q-110; LIV-03, PKG-01). The server lists every non-internal IPv4 address of its PC with its
// adapter's name and the player view's URL on it, the TV address first. With no step by the DM,
// addresses of adapters named as virtual (WSL, Hyper-V, VMs, Docker, VPNs) come after the others,
// a private-range address first within each group, the system's order kept otherwise; on the
// owner's PC that put vEthernet (WSL) and two VMware adapters behind the Wi-Fi (D-169). A TV
// address the DM chose in Settings, the emergency correction, comes first while the PC has it.
// The QR code encodes the first URL only; it is made here, by `uqr`
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

/** In 169.254.0.0/16, an address a system gives itself when no DHCP server answered. */
export function isLinkLocalIpv4(address: string): boolean {
  return address.startsWith('169.254.');
}

/** The player view's URL on `address`: the root of the server (specs/02-architecture.md §2). */
export function playerViewUrl(address: string, port: number): string {
  return `http://${address}${port === 80 ? '' : `:${port}`}${VIEW_PATHS.player}`;
}

// Adapter names that mark a virtual network: Hyper-V's and WSL's vEthernet, VMware, VirtualBox,
// Parallels, Docker and Linux bridges, and the VPNs that name their adapter. Matched on the name the
// system gives (on Windows the connection's name, e.g. `vEthernet (WSL)`), so an adapter renamed or
// named `Ethernet 2` by its driver is not recognised; the TV address in Settings corrects that.
const VIRTUAL_ADAPTER =
  /vethernet|hyper-?v|\bwsl\b|vmware|vmnet|virtualbox|vboxnet|host-only|parallels|docker|^br-|^veth|^virbr|^lxc|^lxd|^cni|^flannel|^podman|^utun|^tun\d|^tap\d|^wg\d|wireguard|tailscale|zerotier|^zt|hamachi|nordlynx|openvpn|\bvpn\b|^vpn|loopback|npcap/i;

/** The adapter's name marks it as virtual (specs/08-ux-journeys.md §5, Q-110). */
export function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER.test(name);
}

/**
 * Every non-internal IPv4 address, ranked (specs/08-ux-journeys.md §5, Q-110): the TV address chosen
 * in Settings first while the PC has it; then the other adapters' addresses before virtual ones', a
 * private-range address first within each group and a link-local one last, the system's order kept
 * otherwise.
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  port: number,
  chosen: string | null = null,
): ConnectAddress[] {
  const seen = new Set<string>();
  const listed: ConnectAddress[] = [];
  for (const [adapter, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      // Node gives `family` as 'IPv4', or as 4 in some versions.
      const ipv4 = entry.family === 'IPv4' || (entry.family as unknown) === 4;
      if (!ipv4 || entry.internal || seen.has(entry.address)) continue;
      seen.add(entry.address);
      listed.push({
        address: entry.address,
        url: playerViewUrl(entry.address, port),
        private: isPrivateIpv4(entry.address),
        adapter,
        virtual: isVirtualAdapter(adapter),
      });
    }
  }
  // Within each group: private-range first, then other addresses, then link-local ones (169.254/16), which a
  // TV can rarely reach.
  const kind = (entry: ConnectAddress): number => (entry.private ? 0 : isLinkLocalIpv4(entry.address) ? 2 : 1);
  const rank = (entry: ConnectAddress): number =>
    (entry.address === chosen ? 0 : 8) + (entry.virtual ? 4 : 0) + kind(entry);
  // Array.prototype.sort is stable, so equal ranks keep the system's order.
  return listed.sort((a, b) => rank(a) - rank(b));
}

/** The QR code of `text`, dark modules as `1`, without the quiet zone. */
export function qrCode(text: string): QrCode {
  const { size, data } = encode(text, { border: 0, ecc: 'M' });
  return { size, rows: data.map((row) => row.map((dark) => (dark ? '1' : '0')).join('')) };
}

export function connectInfo(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
  port: number,
  chosen: string | null = null,
): ConnectInfo {
  const addresses = lanAddresses(interfaces, port, chosen);
  return {
    addresses,
    qr: addresses[0] ? qrCode(addresses[0].url) : null,
    chosen,
    chosen_found: chosen !== null && addresses.some((entry) => entry.address === chosen),
    automatic: lanAddresses(interfaces, port)[0]?.address ?? null,
  };
}

export const systemInterfaces: NetworkInterfaces = () => os.networkInterfaces();

/**
 * What the console shows at start (specs/09-operations.md §2, §4): the player view's URL and its
 * QR code, the other addresses with their adapters, a TV address chosen in Settings that the PC no
 * longer has (specs/08-ux-journeys.md §5, Q-110), and on Windows the firewall advice (Q-076). The QR code is drawn
 * with light blocks for light modules, which reads on the dark background of a usual terminal,
 * with a quiet zone of two modules.
 */
export function connectBanner(info: ConnectInfo, platform: NodeJS.Platform): string {
  const lines: string[] = [];
  const [first, ...others] = info.addresses;
  if (!first) {
    lines.push('No network address was found. Connect this PC to the Wi-Fi the TV uses, then restart Emberglass.');
  } else {
    if (info.chosen !== null && !info.chosen_found) {
      lines.push(
        `The TV address chosen in Settings, ${info.chosen}, is not an address of this PC now: showing the automatic one.`,
      );
    }
    const source = info.chosen_found ? `${first.adapter}, chosen in Settings` : first.adapter;
    lines.push(`Connect a screen (${source}): open ${first.url} in the TV's browser, or scan this code.`);
    lines.push(renderUnicodeCompact(first.url, { border: 2, ecc: 'M' }).trimEnd());
    if (others.length > 0) {
      lines.push(`Other addresses of this PC: ${others.map((entry) => `${entry.url} (${entry.adapter})`).join('  ')}`);
    }
    // The likelier cause first: a network Windows classes as Public keeps the TV out (specs/09-operations.md §4).
    lines.push(
      platform === 'win32'
        ? 'If the TV cannot open it, check that Windows calls this network private (Settings, Network & internet), then choose the TV address in Settings.'
        : 'If the TV cannot open it, check that the firewall of this PC lets the port in (see the README), then choose the TV address in Settings.',
    );
  }
  if (platform === 'win32') {
    lines.push(
      'If Windows Firewall asks about Emberglass or Node.js, allow it on private networks only, not public ones.',
    );
  }
  return `${lines.join('\n')}\n`;
}
