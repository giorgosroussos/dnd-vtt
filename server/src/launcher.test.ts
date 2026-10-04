import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, createTestData, type TestData } from './http/testing/app.js';
import {
  browserCommand,
  dmViewUrl,
  isEmberglassAnswering,
  launch,
  openInBrowser,
  PortInUseError,
  portInUseAdvice,
  type LaunchDeps,
} from './launcher.js';

// The package's launcher (PKG-01, specs/09-operations.md §1, D-164, D-166).

describe('dmViewUrl', () => {
  it('is the DM view on the loopback address the probe asks, where PIN setup is accepted (specs/07 §1)', () => {
    expect(dmViewUrl(3000)).toBe('http://127.0.0.1:3000/dm');
    expect(dmViewUrl(8123)).toBe('http://127.0.0.1:8123/dm');
  });
});

describe('browserCommand', () => {
  it('opens the URL with no shell in between on every system', () => {
    const url = 'http://127.0.0.1:3000/dm';
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
    expect(await launch(d)).toEqual({ outcome: 'started', opened: true });
    expect(d.events).toEqual([
      'start',
      'print Opening the DM view: http://127.0.0.1:3000/dm',
      'open http://127.0.0.1:3000/dm',
      // An installed DM may never read a README (review U-L3).
      'print Keep this window open while you play: closing it stops Emberglass.',
    ]);
  });

  it('starts no second server when one answers, and only opens the DM view', async () => {
    const d = deps({ isAnswering: () => Promise.resolve(true) });
    expect(await launch(d)).toEqual({ outcome: 'opened-running', opened: true });
    expect(d.events).not.toContain('start');
    expect(d.events).toContain('open http://127.0.0.1:3000/dm');
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
    expect(d.events).toContain('open http://127.0.0.1:8123/dm');
  });

  it('prints the address to open when no browser could be started, and says it did not open', async () => {
    const d = deps({ open: () => Promise.resolve(false) });
    expect(await launch(d)).toEqual({ outcome: 'started', opened: false });
    expect(d.events).toContain(
      'print Could not open a browser. Open http://127.0.0.1:3000/dm in a browser on this PC.',
    );
  });

  it('opens nothing when the server fails to start, and lets the failure through', async () => {
    const d = deps({ startServer: () => Promise.reject(new Error('listen EADDRINUSE')) });
    await expect(launch(d)).rejects.toThrow('EADDRINUSE');
    expect(d.events.some((event) => event.startsWith('open'))).toBe(false);
  });

  // Two double-clicks in a row: both launches find nothing, the first server takes the port, and the second
  // must open its DM view rather than fail (PKG-01 review C-L1).
  it('opens the DM view of another Emberglass that took the port while this one was starting', async () => {
    let answers = 0;
    const d = deps({
      isAnswering: () => Promise.resolve(answers++ >= 3),
      startServer: () => Promise.reject(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
      sleep: () => Promise.resolve(),
    });
    expect(await launch(d)).toEqual({ outcome: 'opened-running', opened: true });
    expect(d.events).toContain('print Emberglass is already running on port 3000. Opening http://127.0.0.1:3000/dm');
  });

  it('gives up on a port another program holds, after waiting, with a PortInUseError', async () => {
    const waits: number[] = [];
    const d = deps({
      startServer: () => Promise.reject(Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const failure = await launch(d).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PortInUseError);
    expect((failure as PortInUseError).port).toBe(3000);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(10_000);
    expect(d.events.some((event) => event.startsWith('open'))).toBe(false);
  });

  it('opens the DM view of another Emberglass that holds the data directory while this one was starting', async () => {
    let answers = 0;
    const d = deps({
      isAnswering: () => Promise.resolve(answers++ >= 2),
      startServer: () => Promise.reject(Object.assign(new Error('in use'), { code: 'EMBERGLASS_DATA_DIR_IN_USE' })),
      sleep: () => Promise.resolve(),
    });
    expect(await launch(d)).toEqual({ outcome: 'opened-running', opened: true });
    expect(d.events).toContain('print Emberglass is already running on port 3000. Opening http://127.0.0.1:3000/dm');
  });

  it('waits a minute for a server that holds the data directory, then says so, opening nothing', async () => {
    const waits: number[] = [];
    const held = Object.assign(new Error('Emberglass is already running in another window, perhaps on another port.'), {
      code: 'EMBERGLASS_DATA_DIR_IN_USE',
    });
    const d = deps({
      port: 3001,
      startServer: () => Promise.reject(held),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    const failure = await launch(d).catch((error: unknown) => error);
    // Its own error, not a taken port: that server holds the data on another port.
    expect(failure).toBe(held);
    expect(failure).not.toBeInstanceOf(PortInUseError);
    // A whole start-up to wait out, a backup and a migration on a slow disk included (review C-L6).
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(60_000);
    expect(d.events.some((event) => event.startsWith('open'))).toBe(false);
  });

  it('lets any other start-up failure through at once', async () => {
    let asked = 0;
    const d = deps({
      isAnswering: () => Promise.resolve(asked++ > 0),
      startServer: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    });
    await expect(launch(d)).rejects.toThrow('EACCES');
    expect(asked).toBe(1);
  });
});

describe('portInUseAdvice', () => {
  it('names the port and gives a way to start on the next one, for Windows and elsewhere', () => {
    const windows = portInUseAdvice(3000, 'win32', 'C:\\Program Files\\Emberglass');
    expect(windows[0]).toBe('Port 3000 is used by another program, so Emberglass cannot start on it.');
    expect(windows).toContain('  set EMBERGLASS_PORT=3001');
    expect(windows).toContain('  Emberglass.cmd');
    expect(windows.join(' ')).toContain('open the folder C:\\Program Files\\Emberglass in File Explorer');
    expect(windows.join(' ')).toContain('for this time only');
    expect(portInUseAdvice(3000, 'linux', '/opt/Emberglass').join(' ')).toContain(
      'EMBERGLASS_PORT=3001 /opt/Emberglass/emberglass.sh',
    );
    expect(portInUseAdvice(65535, 'win32', 'C:\\Program Files\\Emberglass')).toContain('  set EMBERGLASS_PORT=65534');
  });
});

describe('openInBrowser', () => {
  it('answers false, without throwing, when the opener cannot be started', async () => {
    const path = process.env.PATH;
    process.env.PATH = '';
    try {
      expect(await openInBrowser('http://127.0.0.1:3000/dm', 'linux')).toBe(false);
    } finally {
      process.env.PATH = path;
    }
  });
});
