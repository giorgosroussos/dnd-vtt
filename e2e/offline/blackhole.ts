import { appendFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// The browsers' half of the offline end-to-end run (specs/10-testing-acceptance.md §6, Q-020,
// @gate:offline-e2e). Every browser of the run is launched with this as its proxy, bypassed only
// for this machine's own addresses (playwright.config.ts), so any request a view makes beyond the
// local host arrives here instead of the internet: it is refused, and recorded in the outbound log
// that the gate test reads. Plain requests and CONNECT tunnels (HTTPS, WebSockets) alike.

export interface Blackhole {
  port: number;
  close: () => Promise<void>;
}

export function startBlackhole(port: number, log: string): Promise<Blackhole> {
  // The user agent says which browser asked, so the gate can tell a browser's own service traffic
  // from a view's request (D-133).
  const record = (kind: string, target: string, agent: string | undefined) =>
    appendFileSync(
      log,
      `${JSON.stringify({ from: 'browser', kind, target, agent: agent ?? null, at: new Date().toISOString() })}\n`,
    );
  const server = http.createServer((request, response) => {
    record('request', `${request.method} ${request.url}`, request.headers['user-agent']);
    response.writeHead(502, { 'content-type': 'text/plain', connection: 'close' });
    response.end('Blocked: the offline end-to-end run allows no traffic beyond the local host.');
  });
  server.on('connect', (request, socket) => {
    // A browser may reset a tunnel it asked for; unhandled, that error would end the whole run
    // (CI run 36566598624, Edge on Windows).
    socket.on('error', () => socket.destroy());
    record('connect', String(request.url), request.headers['user-agent']);
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.on('connection', (socket) => socket.on('error', () => socket.destroy()));
  server.on('clientError', (_error, socket) => socket.destroy());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    );
  });
}
