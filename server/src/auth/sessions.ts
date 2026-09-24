import { randomBytes } from 'node:crypto';

// DM sessions (specs/07-security-and-access.md §2, Q-008, Q-033, Q-058, D-027):
// random 256-bit identifiers held in this process's memory only, so a restart
// ends every one of them and none is ever written to disk. LIV-01's WebSocket
// handshake checks the same store.

export const SESSION_ID_PATTERN = /^[0-9a-f]{64}$/;

export interface SessionStore {
  /** A new session; its identifier goes to the browser in the cookie and nowhere else. */
  create(): string;
  has(id: string | undefined): boolean;
  end(id: string | undefined): void;
  /** Ends every session but `keep`; returns how many ended. */
  endAllExcept(keep: string | undefined): number;
  readonly size: number;
}

export function createSessionStore(): SessionStore {
  const sessions = new Set<string>();
  return {
    create() {
      const id = randomBytes(32).toString('hex');
      sessions.add(id);
      return id;
    },
    has: (id) => id !== undefined && sessions.has(id),
    end(id) {
      if (id !== undefined) sessions.delete(id);
    },
    endAllExcept(keep) {
      let ended = 0;
      for (const id of sessions) {
        if (id !== keep) {
          sessions.delete(id);
          ended++;
        }
      }
      return ended;
    },
    get size() {
      return sessions.size;
    },
  };
}
