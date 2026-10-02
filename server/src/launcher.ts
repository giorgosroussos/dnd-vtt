// The Windows package's launcher (PKG-01, specs/09-operations.md §1, D-164, D-166): open the DM view
// on loopback (127.0.0.1, D-171) in the default browser, starting the server first only when none answers on the port,
// so that the first run's PIN setup happens from this PC (specs/07-security-and-access.md §1).
import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * The DM view on the loopback address, the only place PIN setup is accepted from. The IPv4 address the
 * probe asks, not `localhost`: the server listens on IPv4, and a browser that resolves `localhost` to
 * `::1` first could reach another program holding that port there (PKG-01 review S-L1).
 */
export function dmViewUrl(port: number): string {
  return `http://127.0.0.1:${port}/dm`;
}

/**
 * Whether an Emberglass server already answers on the port. `/api/auth` is the one route that
 * answers a browser without a DM session with 200 and its role (specs/02-architecture.md §5, Q-085);
 * a health route open to anyone would break Q-046, so there is none. Anything else on the port, or
 * nothing, is not Emberglass.
 */
export async function isEmberglassAnswering(
  port: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 2000,
): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/api/auth`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status !== 200) return false;
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && typeof (body as { dm?: unknown }).dm === 'boolean';
  } catch {
    return false;
  }
}

/** The program and arguments that open a URL in the default browser, with no shell in between. */
export function browserCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** Open the URL in the default browser; resolves false when no opener could be started. */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const { command, args } = browserCommand(platform, url);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export interface LaunchDeps {
  port: number;
  /** Whether Emberglass already answers on the port. */
  isAnswering: (port: number) => Promise<boolean>;
  /** Start the server in this process; resolves once it listens. */
  startServer: () => Promise<void>;
  open: (url: string) => Promise<boolean>;
  print: (line: string) => void;
  /** Waits between the checks for another Emberglass that holds the port while it starts. */
  sleep?: (ms: number) => Promise<void>;
}

/** What one launch did, and whether the DM view opened in a browser. */
export interface LaunchOutcome {
  outcome: 'opened-running' | 'started';
  opened: boolean;
}

/** The port is held by a program that is not Emberglass, so the server cannot listen on it. */
export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is used by another program, so Emberglass cannot start on it.`);
  }
}

// How long a launch waits for another Emberglass that took the port first to answer: two
// double-clicks in a row start two launches before either server listens (PKG-01 review C-L1).
const SETTLE_MS = 500;
const SETTLE_TRIES = 20;
// A server holds its data directory before it migrates and cleans it, so a launch that finds it held may
// have to wait out that server's whole start-up, a backup and a migration on a slow disk included (review
// C-L6): up to a minute.
const SETTLE_TRIES_DATA_DIR = 120;

const codeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
// Taken by another server: its port, or its data directory, which a server takes before its port (D-173).
const isTaken = (error: unknown): boolean =>
  codeOf(error) === 'EADDRINUSE' || codeOf(error) === 'EMBERGLASS_DATA_DIR_IN_USE';

/**
 * One launch. A server already running is left alone and only the DM view is opened, so a second
 * launch never starts a second server; otherwise the server starts in this process (its console is
 * the launcher's window, and closing it stops the server) and the DM view opens once it listens. When
 * the port or the data directory turns out to be taken, another Emberglass that is just starting is
 * waited for and its DM view opened; anything else on the port is a PortInUseError, and a data
 * directory another server holds without answering here is that server's error.
 */
export async function launch(deps: LaunchDeps): Promise<LaunchOutcome> {
  const url = dmViewUrl(deps.port);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const openRunning = async (): Promise<LaunchOutcome> => {
    deps.print(`Emberglass is already running on port ${deps.port}. Opening ${url}`);
    return { outcome: 'opened-running', opened: await openOrSay(deps, url) };
  };
  if (await deps.isAnswering(deps.port)) return openRunning();
  try {
    await deps.startServer();
  } catch (error) {
    if (!isTaken(error)) throw error;
    const tries = codeOf(error) === 'EMBERGLASS_DATA_DIR_IN_USE' ? SETTLE_TRIES_DATA_DIR : SETTLE_TRIES;
    for (let tried = 0; tried < tries; tried++) {
      if (await deps.isAnswering(deps.port)) return openRunning();
      await sleep(SETTLE_MS);
    }
    // Another server holds the data but answers on no port of ours: say that, not "port in use".
    if (codeOf(error) === 'EMBERGLASS_DATA_DIR_IN_USE') throw error;
    throw new PortInUseError(deps.port);
  }
  deps.print(`Opening the DM view: ${url}`);
  const opened = await openOrSay(deps, url);
  // An installed DM may never read a README: the window says what it is for (review U-L3).
  deps.print('Keep this window open while you play: closing it stops Emberglass.');
  return { outcome: 'started', opened };
}

async function openOrSay(deps: LaunchDeps, url: string): Promise<boolean> {
  const opened = await deps.open(url);
  if (!opened) deps.print(`Could not open a browser. Open ${url} in a browser on this PC.`);
  return opened;
}

/** What the window says when the port is taken: the way out, for Windows and elsewhere, naming the folder. */
export function portInUseAdvice(port: number, platform: NodeJS.Platform, folder: string): string[] {
  const next = port === 65535 ? port - 1 : port + 1;
  return platform === 'win32'
    ? [
        `Port ${port} is used by another program, so Emberglass cannot start on it.`,
        'Close that program and start Emberglass again. Or start Emberglass on another port, for this time only:',
        `open the folder ${folder} in File Explorer, type cmd in its address bar and press Enter, then type`,
        'these two lines, each followed by Enter:',
        `  set EMBERGLASS_PORT=${next}`,
        '  Emberglass.cmd',
      ]
    : [
        `Port ${port} is used by another program, so Emberglass cannot start on it.`,
        `Close that program and start Emberglass again, or start it on another port: EMBERGLASS_PORT=${next} ${path.join(folder, 'emberglass.sh')}`,
      ];
}
