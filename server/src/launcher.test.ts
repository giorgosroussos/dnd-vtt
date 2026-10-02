import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestData, type TestData } from './http/testing/app.js';
import { browserCommand, dmViewUrl, isEmberglassAnswering, launch, type LaunchDeps } from './launcher.js';

// The package's launcher (PKG-01, specs/09-operations.md §1, D-164, D-166).

describe('dmViewUrl', () => {
  it('is the DM view on the loopback name, where PIN setup is accepted (specs/07 §1)', () => {
    expect(dmViewUrl(3000)).toBe('http://localhost:3000/dm');
    expect(dmViewUrl(8123)).toBe('http://localhost:8123/dm');
  });
});

describe('browserCommand', () => {
  it('opens the URL with no shell in between on every system', () => {
    const url = 'http://localhost:3000/dm';
    expect(browserCommand('win32', url)).toEqual({
      command: 'rundll32.exe',
      args: ['url.dll,FileProtocolHandler', url],
    });
    expect(browserCommand('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(browserCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] });
  });
});

describe('isEmberglassAnswering', () => {
  let data: TestData | undefined;
  let other: Server | undefined;
  afterEach(async () => {
    data?.remove();
    data = undefined;
    await new Promise<void>((resolve) => (other ? other.close(() => resolve()) : resolve()));
    other = undefined;
  });

  it('is true for a running Emberglass server, asked without a DM session', async () => {
    data = createTestData();
    const app = await buildTestApp(data);
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const { port } = app.server.address() as AddressInfo;
      expect(await isEmberglassAnswering(port)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('is false when nothing listens on the port', async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    expect(await isEmberglassAnswering(port)).toBe(false);
  });

  it('is false for another program on the port, whatever it answers', async () => {
    const answers = [
      { status: 200, body: '<html>a router page</html>' },
      { status: 200, body: '{"dm":"yes"}' },
      { status: 404, body: '{"dm":false}' },
    ];
    let next = 0;
    other = createServer((_request, response) => {
      const answer = answers[next++ % answers.length]!;
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.body);
    });
    await new Promise<void>((resolve) => other!.listen(0, '127.0.0.1', resolve));
    const { port } = other.address() as AddressInfo;
    for (let i = 0; i < answers.length; i++) expect(await isEmberglassAnswering(port)).toBe(false);
  });

  it('gives up on a program that never answers', async () => {
    other = createServer(() => {});
    await new Promise<void>((resolve) => other!.listen(0, '127.0.0.1', resolve));
    const { port } = other.address() as AddressInfo;
    const started = Date.now();
    expect(await isEmberglassAnswering(port, fetch, 100)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    other.closeAllConnections();
  });
});

describe('launch', () => {
  function deps(overrides: Partial<LaunchDeps>): LaunchDeps & { events: string[] } {
    const events: string[] = [];
    return {
      events,
      port: 3000,
      isAnswering: () => Promise.resolve(false),
      startServer: () => {
        events.push('start');
        return Promise.resolve();
      },
      open: (url) => {
        events.push(`open ${url}`);
        return Promise.resolve(true);
      },
      print: (line) => events.push(`print ${line}`),
      ...overrides,
    };
  }

  it('starts the server and then opens the DM view when none answers', async () => {
    const d = deps({});
    expect(await launch(d)).toBe('started');
    expect(d.events).toEqual([
      'start',
      'print Opening the DM view: http://localhost:3000/dm',
      'open http://localhost:3000/dm',
    ]);
  });

  it('starts no second server when one answers, and only opens the DM view', async () => {
    const d = deps({ isAnswering: () => Promise.resolve(true) });
    expect(await launch(d)).toBe('opened-running');
    expect(d.events).not.toContain('start');
    expect(d.events).toContain('open http://localhost:3000/dm');
  });

  it('asks on the configured port', async () => {
    const asked: number[] = [];
    const d = deps({
      port: 8123,
      isAnswering: (port) => {
        asked.push(port);
        return Promise.resolve(false);
      },
    });
    await launch(d);
    expect(asked).toEqual([8123]);
    expect(d.events).toContain('open http://localhost:8123/dm');
  });

  it('prints the address to open when no browser could be started', async () => {
    const d = deps({ open: () => Promise.resolve(false) });
    await launch(d);
    expect(d.events.at(-1)).toBe(
      'print Could not open a browser. Open http://localhost:3000/dm in a browser on this PC.',
    );
  });

  it('opens nothing when the server fails to start, and lets the failure through', async () => {
    const d = deps({ startServer: () => Promise.reject(new Error('listen EADDRINUSE')) });
    await expect(launch(d)).rejects.toThrow('EADDRINUSE');
    expect(d.events.some((event) => event.startsWith('open'))).toBe(false);
  });
});
