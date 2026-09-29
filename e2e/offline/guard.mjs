// The server half of the offline end-to-end run (specs/10-testing-acceptance.md §6,
// specs/02-architecture.md §6, Q-020, @gate:offline-e2e). Loaded with `node --import` into the
// server under test, it blocks every connection beyond this machine and every name lookup
// but `localhost`, and records each attempt, one JSON line, in EMBERGLASS_E2E_OUTBOUND_LOG. A
// blocked connection fails as a refused one would on a PC with no internet; the gate test fails
// on any recorded line. The browsers' half is the proxy of `blackhole.ts`.
import dgram from 'node:dgram';
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';

const LOG = process.env.EMBERGLASS_E2E_OUTBOUND_LOG;

/** This machine's own addresses: loopback and every interface's, the "local host" of `10` §6. */
function ownAddresses() {
  const own = new Set(['::1']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const entry of list ?? []) own.add(entry.address.toLowerCase().split('%', 1)[0]);
  }
  return own;
}
const OWN = ownAddresses();

export function isLocalHost(host) {
  if (host === undefined || host === null || host === '') return true;
  const name = String(host)
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  const bare = name.startsWith('::ffff:') && name.includes('.') ? name.slice(7) : name;
  if (net.isIPv4(bare)) return bare.startsWith('127.') || OWN.has(bare);
  if (net.isIPv6(bare)) return OWN.has(bare);
  return false;
}

function record(kind, target) {
  const line = JSON.stringify({ from: 'server', kind, target, pid: process.pid, at: new Date().toISOString() });
  if (LOG) appendFileSync(LOG, `${line}\n`);
  else process.stderr.write(`offline guard: ${line}\n`);
}

// This process runs under the guard: the gate counts these lines, so a server started without it is
// missing from the log, not silently unwatched (review H2).
record('armed', process.argv.slice(1).join(' '));

function blocked(target) {
  return Object.assign(new Error(`connect ECONNREFUSED ${target} (blocked: the offline end-to-end run)`), {
    code: 'ECONNREFUSED',
  });
}

// Every TCP and TLS connection goes through here: http, https, fetch (undici), WebSocket clients.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host;
  let port;
  let path;
  if (first !== null && typeof first === 'object') ({ host, port, path } = first);
  else if (typeof first === 'string' && !/^\d+$/.test(first)) path = first;
  else [port, host] = [first, typeof args[1] === 'string' ? args[1] : undefined];
  // A pipe or Unix socket is this machine; no host means localhost to Node.
  if (path === undefined && !isLocalHost(host)) {
    const target = `${host}:${port}`;
    record('connect', target);
    process.nextTick(() => this.destroy(blocked(target)));
    return this;
  }
  return connect.apply(this, args);
};

// A name lookup would ask the network's DNS server, which is beyond the local host.
function refuseName(kind, name) {
  record(kind, String(name));
  return Object.assign(new Error(`getaddrinfo ENOTFOUND ${name} (blocked: the offline end-to-end run)`), {
    code: 'ENOTFOUND',
    hostname: name,
  });
}
const lookup = dns.lookup;
dns.lookup = function guardedLookup(name, ...rest) {
  if (isLocalHost(name) || net.isIP(String(name))) return lookup.call(this, name, ...rest);
  const callback = rest.at(-1);
  const error = refuseName('lookup', name);
  process.nextTick(() => callback(error));
  return {};
};
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = function guardedPromiseLookup(name, ...rest) {
  if (isLocalHost(name) || net.isIP(String(name))) return promiseLookup.call(this, name, ...rest);
  return Promise.reject(refuseName('lookup', name));
};
for (const method of Object.keys(dns).filter((key) => /^resolve/.test(key) && typeof dns[key] === 'function')) {
  const original = dns[method];
  dns[method] = function guardedResolve(name, ...rest) {
    if (isLocalHost(name)) return original.call(this, name, ...rest);
    const callback = rest.at(-1);
    const error = refuseName(method, name);
    process.nextTick(() => callback(error));
    return {};
  };
}
// Every other way to ask a DNS server (review S-L2): the promise resolvers, Resolver instances (callback
// and promise), and reverse lookups of an address beyond this machine.
for (const method of Object.keys(dns.promises).filter((key) => /^resolve/.test(key))) {
  const original = dns.promises[method];
  dns.promises[method] = function guardedPromiseResolve(name, ...rest) {
    if (isLocalHost(name)) return original.call(this, name, ...rest);
    return Promise.reject(refuseName(method, name));
  };
}
for (const Resolver of [dns.Resolver, dns.promises.Resolver]) {
  const promised = Resolver === dns.promises.Resolver;
  for (const method of Object.getOwnPropertyNames(Resolver.prototype).filter((key) => /^(resolve|reverse)/.test(key))) {
    const original = Resolver.prototype[method];
    if (typeof original !== 'function') continue;
    Resolver.prototype[method] = function guardedResolverMethod(name, ...rest) {
      if (isLocalHost(name)) return original.call(this, name, ...rest);
      const error = refuseName(method, name);
      if (promised) return Promise.reject(error);
      const callback = rest.at(-1);
      process.nextTick(() => callback(error));
      return {};
    };
  }
}
const lookupService = dns.lookupService;
dns.lookupService = function guardedLookupService(address, port, callback) {
  if (isLocalHost(address)) return lookupService.call(this, address, port, callback);
  const error = refuseName('lookupService', address);
  process.nextTick(() => callback(error));
  return {};
};

// UDP (review S-L2): a datagram to a host beyond this machine, or a socket connected to one, is refused
// the way a send to an unreachable host fails. A name as the address would itself be a lookup.
const blockedDatagram = (target) =>
  Object.assign(new Error(`send ECONNREFUSED ${target} (blocked: the offline end-to-end run)`), {
    code: 'ECONNREFUSED',
  });
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function guardedSend(...args) {
  // A socket connected with connect() sends without an address; connect() itself is guarded below.
  const at = args.findIndex((arg, index) => index > 0 && typeof arg === 'string');
  const address = at >= 0 ? args[at] : undefined;
  if (address !== undefined && !isLocalHost(address)) {
    const port = typeof args[at - 1] === 'number' ? args[at - 1] : '';
    record('udp', `${address}:${port}`);
    const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined;
    if (callback) process.nextTick(() => callback(blockedDatagram(address)));
    return undefined;
  }
  return send.apply(this, args);
};
const udpConnect = dgram.Socket.prototype.connect;
dgram.Socket.prototype.connect = function guardedUdpConnect(port, address, ...rest) {
  const host = typeof address === 'string' ? address : undefined;
  if (host !== undefined && !isLocalHost(host)) {
    record('udp', `${host}:${port}`);
    const callback = rest.at(-1) ?? (typeof address === 'function' ? address : undefined);
    process.nextTick(() => {
      if (typeof callback === 'function') callback(blockedDatagram(host));
      else this.emit('error', blockedDatagram(host));
    });
    return undefined;
  }
  return udpConnect.call(this, port, address, ...rest);
};
syncBuiltinESMExports();
