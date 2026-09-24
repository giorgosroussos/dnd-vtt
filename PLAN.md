# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### SRV-02 — PIN, DM session and guessing protection

- **Outcome:** a DM can set the PIN only from the server machine, enter it from any LAN browser to get a DM session that lasts until restart, change it (ending every other session), sign a browser out, and reset it with `npm run reset-pin`; every `/api` route but PIN entry and setup refuses a request without a DM session.
- **Specs:** `13` §4 SRV-02, `07` §1 (loopback setup, change, reset, scrypt), `07` §2 (in-memory sessions, 256-bit HttpOnly SameSite=Strict cookie, Origin checks, sign-out, PIN change), `07` §6 (4–8 digits, lockout after 5 failures doubling), `07` §7 (role from the session only), `07` §8 (no PIN, session identifier or cookie in logs; failed attempts and lockouts logged), `02` §5 (`/api/auth`, `/api/setup`, session on every other route), `09` §2 (console hint when no PIN is set).
- **Dependencies:** SRV-01 (settings row with `pin_hash`).
- **Acceptance (executable):**
  - Vitest against a real SQLite file: setup succeeds from a loopback address and is refused from a LAN address and once a PIN is set; the stored value is a salted scrypt hash, never the PIN; a PIN outside 4–8 digits is refused.
  - Correct PIN gives a cookie with HttpOnly and SameSite=Strict carrying a 256-bit random identifier; a wrong PIN five times locks that client address for 1 minute, doubling on each further run of five; another address is unaffected.
  - Changing the PIN ends every other session and keeps the device that changed it; sign-out ends that browser's session; a restart ends all sessions; `npm run reset-pin` clears the hash so setup runs again from localhost.
  - Every `/api` route except PIN entry and setup, and every unknown `/api` path, answers a request without a session identically, before body parsing (G-005); a REST write with a foreign Origin is refused.
  - `settings` is read and written through explicit column lists and no `/api` response carries `pin_hash` (G-008); a flood of rejected requests from one address leaves earlier failed-PIN lines in the retained log files (G-006); log files and console never contain the PIN, the session identifier or the cookie.
  - `make verify` exit 0 on both CI runners; `TRACEABILITY.md` SRV-02 row with test names.
- **Non-goals:** the DM view screens for PIN entry and settings (PRP-01, REL-01), WebSocket handshake checks (LIV-01), README text on transport exposure and backups (REL-01).
- **Review:** `Surfaces: data, security`, `Touches red line: yes`, `Contract change: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **SRV-03 — Campaigns, sessions and scenes over REST.** CRUD, ordering (two-step reorder under the unique order, D-075), duplication and cascading deletion with confirmation, reading and writing through explicit column lists (`13` §4, `02` §5, `03` §5, `03` §7).
2. **SRV-04 — Image upload pipeline.** PNG, JPEG and WebP judged by content under the configurable limit, a rejection storing nothing, sha256 identity with duplicate reuse, WebP display and thumbnail variants that validate against `ImageVariantsSchema` (G-009) (`13` §4, `05` §6, `05` §7, `03` §7).
3. **SRV-05 — Asset library over REST.** Search and tag filter, create, update, delete refused while in use with the scenes listed, tag case decided (G-009) (`13` §4, `05` §1, `05` §2, `05` §4, `05` §5).
