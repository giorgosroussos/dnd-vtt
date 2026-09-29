# Emberglass

A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1). The DM prepares sessions as series of scenes and runs them on a TV or projector. The server runs on the DM's own PC, and the TV opens the player view in its browser over the home Wi-Fi. It is not a remote-play platform, a character manager or a map maker. Licensed under AGPL-3.0 (`LICENSE`).

## Install and start

You need Node.js 24 or newer (<https://nodejs.org>) and Git. Emberglass is installed from source; nothing is published to a package registry.

Type the commands below in a terminal: on Windows, Command Prompt or PowerShell; on Linux or macOS, Terminal. `npm install` can take a few minutes the first time. Keep the terminal window open while you play: closing it stops the server.

```bash
git clone https://github.com/giorgosroussos/dnd-vtt.git emberglass
cd emberglass
npm install
npm start
```

- `npm start` builds Emberglass the first time, applies any pending database changes, then starts the server. It refuses to start on a Node.js older than 24, and says so.
- To update, run `git pull` and `npm install`, then `npm run build` before `npm start`. `npm start` builds only when no build exists, so without this step it would start the old build.
- Stop the server with Ctrl+C.

On start the console prints the player view's address and a QR code for it, for example `http://192.168.1.20:3000/`, followed by the PC's other addresses.

- **First run.** While no PIN is set, the console says so and prints the address to open. Open `http://localhost:3000/dm` (or your port, if you set `EMBERGLASS_PORT`) in a browser **on this PC** and choose the DM PIN (4 to 8 digits; 6 to 8 are much harder to guess). Setup is refused from any other device, and from this PC through its network address: use `localhost`.
- **The TV.** Open the printed address in the TV's browser, or use Connect a screen in the DM view, which shows the same address and code. The player view needs no PIN.
- **The DM view.** On any browser on the Wi-Fi, open the same address followed by `/dm`, then enter the PIN. A browser stays signed in until the server restarts, the PIN changes or it signs out.
- **Forgotten PIN.** Run `npm run reset-pin` in the Emberglass folder on this PC, then set a new one from `http://localhost:3000/dm` (or your port).

## Settings

The DM view's Settings (in the live bar) change these without a restart:

- **The upload limit:** 50 MB by default, from 1 to 1,024 MB. The next upload is checked against it.
- **The display size:** the longest side, in pixels, of the version of each map and token image that screens show. It is 4,096 by default, from 512 to 16,383. Choose a smaller size if the TV is slow or runs out of memory. After a change, every display version is made again in the background, and the TV shows each map at the new size once it is done. Originals, which calibration uses, never change.
- **Diagonals on the ruler:** every diagonal square counts 5 ft (PHB, the default), or diagonals alternate 5 ft and 10 ft (DMG). The distance on the TV follows at once.
- **Change the PIN:** give the current PIN and the new one. Every other browser signed in to the DM view is signed out.

Two environment variables set what the Settings cannot, and are read when the server starts:

- `EMBERGLASS_PORT`: the port, 3000 by default;
- `EMBERGLASS_DATA_DIR`: the data directory.

For example, `EMBERGLASS_PORT=8080 npm start` on Linux or macOS; in Windows PowerShell `$env:EMBERGLASS_PORT=8080; npm start`; in Command Prompt `set EMBERGLASS_PORT=8080` and then `npm start`.

## Your data and backups

Everything lives in one data directory:

| System | Default data directory |
| --- | --- |
| Windows | `%APPDATA%\Emberglass` |
| Linux | `$XDG_DATA_HOME/emberglass`, else `~/.local/share/emberglass` |
| macOS | `~/Library/Application Support/Emberglass` |

It holds:

- `emberglass.db`, the database: campaigns, sessions, scenes, tokens, the asset library and the settings;
- `images/`, every uploaded image in its three versions;
- `logs/`, `emberglass.log` and up to three older files, 5 MB each.

Nothing about the game is stored anywhere else.

- **Backup.** Stop the server, then copy the whole data directory somewhere safe. There is no database server to set up or dump. To restore, or to move your campaigns to another PC, put the copy in place (or point `EMBERGLASS_DATA_DIR` at it) and start Emberglass.
- **Automatic backups.** Before it applies a database change after an update, Emberglass copies the database to `emberglass-backup-<date and time>-v<version>.db` in the data directory. Delete old ones when you no longer need them.
- **Backups hold the PIN hash.** The database, every `emberglass-backup-*.db` file and every copy of the folder hold the PIN as a salted hash, never the PIN itself. A 4-to-8-digit PIN can still be guessed offline from a stolen copy. After changing the PIN or running `npm run reset-pin`, delete the old `emberglass-backup-*.db` files and old copies you do not need, and keep the others where only you can read them.
- **One server per data directory.** Run only one Emberglass server on a data folder at a time. A second server started on the same folder breaks any upload the first is receiving and deletes images uploaded but not yet used by an asset or a scene, even if it then fails to start because the port is taken.
- **The images folder grows with your uploads.** An image is removed only when nothing uses it any more: no asset and no scene. The same file uploaded twice is stored once.

## Network and security

Emberglass is meant for a trusted home network.

- It serves plain HTTP on the LAN, with no encryption. The PIN and the DM view's session cross the Wi-Fi unencrypted, so anyone who can watch your Wi-Fi traffic could read them. Do not run it on a public or shared network.
- **Nothing leaves your LAN.** The running server contacts nothing on the internet: no telemetry, no update check, no web fonts or scripts from elsewhere.
- **The player view is open to any browser on the Wi-Fi.** It shows only what is visible on the live scene; hidden tokens never leave the server.
- **Guessing the PIN:**
  - After 5 wrong PINs from one device, PIN entry from it is refused for 1 minute. The wait doubles on each further 5.
  - After 20 wrong PINs from any devices within 10 minutes, PIN entry is paused for 10 minutes on every device except the server PC itself. The pause doubles on each further 20, and only a restart of the server brings it back to 10 minutes. Every pause is logged with the addresses that caused it.
  - Browsers already signed in keep working during a pause. To sign in, or to change the PIN, during a pause, use a browser on the server PC opened at `http://localhost:3000/dm` (not the network address the console prints); its own limit of 5 wrong PINs still applies.
  - A device that keeps just under 20 wrong PINs every 10 minutes, changing its address, is never paused: about 2,700 guesses a day. A 4-digit PIN could be found that way within days, a 6-digit one in months, an 8-digit one practically never.
  - Choose a PIN of 6 to 8 digits: a 4-digit PIN is the easiest to guess.

### Firewall

**Windows.** The first time Emberglass starts, Windows Defender Firewall asks whether Node.js may communicate on networks. Allow it on **private networks only**, and leave public networks unticked. Your home Wi-Fi must be set as a private network in Windows' network settings; otherwise the TV cannot reach the server. To change the answer later, open Windows Defender Firewall, then "Allow an app through firewall", then Node.js.

**Linux.** If a host firewall is active, open the port (3000 by default) to your home network only. For example, for a network of `192.168.1.x`:

```bash
# ufw (Ubuntu, Debian, Mint)
sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp

# firewalld (Fedora, RHEL, openSUSE): first find the zone your Wi-Fi connection is in
sudo firewall-cmd --get-active-zones
# then open the port in that zone (here `home`; use the name the command above printed)
sudo firewall-cmd --zone=home --add-port=3000/tcp --permanent
sudo firewall-cmd --reload
```

**macOS** is best-effort: allow incoming connections for Node.js if asked.

## Logs

The console and `logs/emberglass.log` in the data directory record:

- start-up and the addresses served;
- screens and DM views connecting;
- wrong PINs with the device's address, lockouts and pauses;
- settings changes;
- errors.

They never contain a PIN, a session identifier or a cookie. `emberglass.log` rotates at 5 MB, and three older files are kept.

## Licence and name

Emberglass is free software under the GNU Affero General Public License, version 3 (`LICENSE`). If you run a modified version for others over a network, you must offer them its source. Emberglass is compatible with the 5th edition rules as published in the System Reference Document 5.1. It is not affiliated with or endorsed by Wizards of the Coast.

## Development

Development needs Node.js 24 or newer (`nvm use` reads `.nvmrc`) and Python 3 for the documentation gates.

```bash
make setup        # npm ci, Playwright's Chromium, .env from .env.example
make verify       # lint, format-check, typecheck, test, e2e, build, check-docs
make dev          # the server with Vite on http://localhost:3000 (player view /, DM view /dm)
make smoke        # checks a running server
make help         # the full command contract
```

`make setup` points development at `.dev-data/` in the clone, so `make dev` never opens your real campaigns.

- Agents and contributors start at `AGENTS.md`. Ready-made session prompts: `SESSION_BOOTSTRAP_PROMPT_SAMPLE.md`.
- Specifications: `specs/README.md` (map, requirement language, conflict resolution).
- Raw requirements and their authority: `docs/inputs/README.md`.
- Current work, decisions, gaps, open questions and evidence: `PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`.

Stack: Node.js 24 LTS (one process), TypeScript, Fastify, Socket.io, SQLite (better-sqlite3), sharp, React with react-konva, Vite; Vitest and Playwright.

### Continuous integration

GitHub Actions, `.github/workflows/ci.yml` (FND-02, `specs/13-implementation-plan.md` §3; D-060, D-061), on every pull request, every push to `main` and on demand. Every job runs exactly one root `Makefile` target, so a gate cannot pass in CI and fail locally: to reproduce a red job, run its command. Before it, a job only provisions the machine (checkout, Node from `.nvmrc`, `make setup`; on Windows also MSYS2 for `make` and bash). No job retries.

| Job | Runners | Command |
| --- | --- | --- |
| `lint · linux`, `lint · windows` | `ubuntu-latest`, `windows-latest` | `make lint` |
| `format-check · linux`, `format-check · windows` | both | `make format-check` |
| `typecheck · linux`, `typecheck · windows` | both | `make typecheck` |
| `test · linux`, `test · windows` | both | `make test` |
| `e2e · linux`, `e2e · windows` | both | `make e2e` |
| `build · linux`, `build · windows` | both | `make build` |
| `check-docs · linux`, `check-docs · windows` | both | `make check-docs` |
| `audit · linux`, `audit · windows` | both | `make audit` |
| `scan-secrets · linux`, `scan-secrets · windows` | both | `make scan-secrets` |
| `tripwire · offline-e2e (absent)` | `ubuntu-latest` | `make tripwire GATE=offline-e2e` |
| `tripwire · external-url-build (absent)` | `ubuntu-latest` | `make tripwire GATE=external-url-build` |

A tripwire job stands in for a gate that `specs/10-testing-acceptance.md` §3 or §6 requires and nothing implements yet. It passes only while the gate is provably absent, meaning no code file carries the marker `@gate:<id>`, and says so in its name and output; it is never the gate. The first test or build check that carries the marker turns the job red, with the promotion steps: run the gate inside a real gate target, then remove its job here and its entry in `scripts/tripwire.mjs`.

`make verify` runs the first seven gate commands; `make audit`, `make scan-secrets` and `make tripwire` run beside it. Caches (npm, Playwright browsers) are keyed on `package-lock.json`, and a failed `e2e` job keeps `e2e/test-results/` as an artifact for seven days. A ruleset on `main` requires every job above by name, so a red pipeline blocks a merge; it lives on GitHub, not in this repository. Promoting a tripwire removes its job, so the same change must remove that job from the ruleset's required checks, or GitHub waits for a check that never runs.

