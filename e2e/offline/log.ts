import { existsSync, readFileSync } from 'node:fs';

// Reading the offline run's outbound log (specs/10-testing-acceptance.md §6, D-127): one JSON line per
// attempt beyond the local host, from the browsers' proxy (blackhole.ts) or the server's guard
// (guard.mjs), and one `armed` line from each process the guard was loaded into.

export interface Attempt {
  from: 'browser' | 'server';
  kind: string;
  target: string;
  agent?: string | null;
  pid?: number;
}

export const OUTBOUND_LOG = process.env.EMBERGLASS_E2E_OUTBOUND_LOG!;

// A documentation address (RFC 5737): never a real host, on any network.
export const OUTSIDE = '198.51.100.7';

/** The image each browser project asks for beyond the local host, to show its traffic is watched. */
export const probeUrl = (project: string) => `http://${OUTSIDE}/probe-${project}.png`;

export function attempts(file: string = OUTBOUND_LOG): Attempt[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Attempt)
    : [];
}

/** A process the guard was loaded into, not an attempt. */
export const armed = (each: Attempt) => each.from === 'server' && each.kind === 'armed';

// Edge's own services: it calls Bing and Microsoft's hosts by itself, whatever page it shows
// (CI run 36569636626: www.bing.com and edge.microsoft.com, Edge on Windows). Such an attempt is
// the browser's, not the running application's (specs/02-architecture.md §6): it is set aside only
// when Edge's user agent sent it to one of these domains, and listed in the report; any other
// attempt, Edge's to any other host included, fails the gate (D-133).
const EDGE_AGENT = /\bEdg\//;
const MICROSOFT_SERVICES =
  /(?:^|\.)(?:bing\.com|microsoft\.com|msn\.com|live\.com|skype\.com|msedge\.net|windows\.com)$/;

export const hostOf = (target: string) =>
  target
    .replace(/^[A-Z]+ /, '')
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/:].*$/, '')
    .toLowerCase();

export const browserService = (each: Attempt) =>
  each.from === 'browser' && EDGE_AGENT.test(each.agent ?? '') && MICROSOFT_SERVICES.test(hostOf(each.target));
