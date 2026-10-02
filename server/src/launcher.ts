// The Windows package's launcher (PKG-01, specs/09-operations.md §1, D-164, D-166): open the DM view
// on loopback in the default browser, starting the server first only when none answers on the port,
// so that the first run's PIN setup happens from this PC (specs/07-security-and-access.md §1).
import { spawn } from 'node:child_process';

/** The DM view on the loopback address: the only place PIN setup is accepted from. */
export function dmViewUrl(port: number): string {
  return `http://localhost:${port}/dm`;
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
}

export type LaunchOutcome = 'opened-running' | 'started';

/**
 * One launch. A server already running is left alone and only the DM view is opened, so a second
 * launch never starts a second server; otherwise the server starts in this process (its console is
 * the launcher's window, and closing it stops the server) and the DM view opens once it listens.
 */
export async function launch(deps: LaunchDeps): Promise<LaunchOutcome> {
  const url = dmViewUrl(deps.port);
  if (await deps.isAnswering(deps.port)) {
    deps.print(`Emberglass is already running on port ${deps.port}. Opening ${url}`);
    await openOrSay(deps, url);
    return 'opened-running';
  }
  await deps.startServer();
  deps.print(`Opening the DM view: ${url}`);
  await openOrSay(deps, url);
  return 'started';
}

async function openOrSay(deps: LaunchDeps, url: string): Promise<void> {
  if (!(await deps.open(url))) deps.print(`Could not open a browser. Open ${url} in a browser on this PC.`);
}
