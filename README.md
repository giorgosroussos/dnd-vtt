# Emberglass

A free, self-hosted virtual tabletop for in-person play, compatible with 5th edition (SRD 5.1). The DM prepares sessions as series of scenes and runs them on a TV or projector. The server runs on the DM's own PC, and the TV opens the player view in its browser over the home Wi-Fi. It is not a remote-play platform, a character manager or a map maker. Licensed under AGPL-3.0 (`LICENSE`).

## Install and start

On Windows you can use the installer or the portable zip instead, which need no Node.js, Git or terminal: see [Windows package](#windows-package) below. Everywhere else, and on Windows if you prefer, you need Node.js 24 or newer (<https://nodejs.org>) and Git. Emberglass is installed from source; nothing is published to a package registry.

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

On start the console prints the player view's address and a QR code for it, for example `http://192.168.1.20:3000/`, followed by the PC's other addresses, each with the name of its network adapter. Emberglass picks the address itself: the Wi-Fi's or the Ethernet's, before those of virtual adapters that WSL, Hyper-V, VMware, VirtualBox, Docker or a VPN add.

- **First run.** While no PIN is set, the console says so and prints the address to open. Open `http://localhost:3000/dm` (or your port, if you set `EMBERGLASS_PORT`) in a browser **on this PC** and choose the DM PIN (4 to 8 digits; 6 to 8 are much harder to guess). Setup is refused from any other device, and from this PC through its network address: use `localhost`.
- **The TV.** Open the printed address in the TV's browser, or use Connect a screen in the DM view (the screens counter in its header), which shows the same address and code. The player view needs no PIN. If neither the TV nor a phone opens it, check that Windows calls your Wi-Fi a private network (see Firewall below), then choose the TV address in Settings.
- **The DM view.** On any browser on the Wi-Fi, open the same address followed by `/dm`, then enter the PIN. A browser stays signed in until the server restarts, the PIN changes or it signs out.
- **Forgotten PIN.** Run `npm run reset-pin` in the Emberglass folder on this PC, then set a new one from `http://localhost:3000/dm` (or your port).

### Windows package

Each release on the repository's GitHub Releases page carries two files for Windows x64, each with its own Node.js runtime and its SHA-256 checksum:

- `Emberglass-<version>-win-x64-setup.exe`, the **installer** (recommended);
- `Emberglass-<version>-win-x64.zip`, the **portable package**, for a PC where you cannot or do not want to install.

**Before opening either file, check it.** Run `certutil -hashfile <file> SHA256` in Command Prompt, in the folder you downloaded it to, and compare the result with the file's `.sha256`. If they differ, do not open the file. A match shows the download is intact; it does not show who built it. **Neither is signed.** The first time you run one, Windows may show "Windows protected your PC": choose **More info**, then **Run anyway**, only for a file whose checksum matches.

Before a release is published, its installer is installed on a fresh Windows build machine and must pass the hidden-information tests, the five DM journeys in Chrome and Edge, and the offline check; the zip holds the same program and passes a start-up check. These tests vouch for the program the release workflow built, not for the third-party packages it is built from. Optionally, if you use the GitHub CLI (<https://cli.github.com>, signed in with `gh auth login`), `gh attestation verify <file> --repo giorgosroussos/dnd-vtt --signer-workflow giorgosroussos/dnd-vtt/.github/workflows/release.yml` confirms the file was built by this repository's release workflow.

**The installer.**

- It installs Emberglass for every user of the PC under `C:\Program Files\Emberglass`, with one administrator prompt. It adds an **Emberglass** folder to the Start Menu (Emberglass, Reset the Emberglass PIN, Uninstall Emberglass) and, if you tick it, a desktop shortcut.
- It allows Emberglass through Windows Defender Firewall on **private networks only**, and blocks it on public ones, so Windows never asks. Your Wi-Fi must be a private network in Windows' settings: on a network Windows classes as Public the TV cannot reach the server. To change it: Settings, Network & internet, Wi-Fi, your network, Network profile type: **Private network**.
- **To update,** finish your session, then run the newer installer: it upgrades in place, and stops Emberglass if it is still running. The first start then upgrades your data after a dated backup copy.
- **To uninstall,** use Uninstall Emberglass in the Start Menu, or Settings, Apps. It stops Emberglass if it is running, then removes the program, its shortcuts and its firewall rules. It **never** removes your data in `%APPDATA%\Emberglass`; delete that folder yourself if you want it gone.
- The Emberglass shortcut opens a console window, which cannot be pinned to the taskbar: pin it to Start instead.
- **One DM at a time on a shared PC.** If two Windows users of the same PC start Emberglass, the second one's shortcut opens the first one's DM view, on the same port. Use one Windows account for Emberglass, or give each user their own `EMBERGLASS_PORT`.

**The portable zip.** Unzip it into a folder of its own, for example `Documents\Emberglass`, and double-click `Emberglass.cmd`. To update, stop the server and unzip the newer package into a new folder. Windows asks about the firewall on the first start: allow private networks only.

**Either way:**

- Start Emberglass from its shortcut or `Emberglass.cmd`. It opens the DM view, `http://127.0.0.1:3000/dm`, in your browser, starting the server first if it is not already running; starting it again on the same port while it runs only opens the browser. Keep its window open while you play: closing it stops the server. The window shows the TV's address and QR code.
- Your data is in `%APPDATA%\Emberglass`, as with a source install, never in the program's folder.
- **Forgotten PIN.** Use Reset the Emberglass PIN, or `Reset PIN.cmd` in the zip's folder, then set a new one from `http://127.0.0.1:3000/dm`.
- If another program already uses port 3000, the window says so and how to start Emberglass on another port, for that start only.
- `README.txt` in the program's folder says the same and names the source tag it was built from; `THIRD_PARTY_NOTICES.txt` holds the licences of everything it carries. Emberglass never checks for updates.

## Settings

The DM view's Settings (the button at the right of its header; Sign out is in the same dialog) change these without a restart:

- **The upload limit:** 50 MB by default, from 1 to 1,024 MB. The next upload is checked against it.
- **The display size:** the longest side, in pixels, of the version of each map and token image that screens show. It is 4,096 by default, from 512 to 16,383. Choose a smaller size if the TV is slow or runs out of memory. After a change, every display version is made again in the background, and the TV shows each map at the new size once it is done. Originals, which calibration uses, never change.
- **Diagonals on the ruler:** every diagonal square counts 5 ft (PHB, the default), or diagonals alternate 5 ft and 10 ft (DMG). The distance on the TV follows at once.
- **TV address:** Automatic, the default, needs nothing from you. Change it only if the TV or a phone cannot open the address Connect a screen shows: choose your PC's Wi-Fi or Ethernet address from the list, where each is named with its adapter. In Windows Settings, open Network & internet, then your network: the one to choose is its **IPv4 address** (not the default gateway or a DNS server, which are your router). Connect a screen, its QR code and the console at the next start then use it. If the PC no longer has that address, on another Wi-Fi for example, Emberglass goes back to Automatic and says so.
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
- `logs/`, `emberglass.log` and up to three older files, 5 MB each;
- `emberglass.lock`, which a running server holds so that no second one uses the folder (it holds no data).

Nothing about the game is stored anywhere else.

- **Backup.** Stop the server, then copy the whole data directory somewhere safe. There is no database server to set up or dump. To restore, or to move your campaigns to another PC, put the copy in place (or point `EMBERGLASS_DATA_DIR` at it) and start Emberglass.
- **Automatic backups.** Before it applies a database change after an update, Emberglass copies the database to `emberglass-backup-<date and time>-v<version>.db` in the data directory. Delete old ones when you no longer need them.
- **Backups hold the PIN hash.** The database, every `emberglass-backup-*.db` file and every copy of the folder hold the PIN as a salted hash, never the PIN itself. A 4-to-8-digit PIN can still be guessed offline from a stolen copy. After changing the PIN or running `npm run reset-pin`, delete the old `emberglass-backup-*.db` files and old copies you do not need, and keep the others where only you can read them.
- **One server per data directory.** Emberglass runs only one server on a data folder at a time: a second one started on the same folder, on any port, says that another Emberglass is running with it and stops before it touches anything. It holds the folder through `emberglass.lock`, which it releases when it stops, even after a crash; leave the file where it is. Started from the Windows package on the same port, a second start just opens the running server's DM view.
- **The images folder grows with your uploads.** An image is removed only when nothing uses it any more: no asset and no scene. The same file uploaded twice is stored once.

## Network and security

Emberglass is meant for a trusted home network.

- It serves plain HTTP on the LAN, with no encryption. The PIN and the DM view's session cross the Wi-Fi unencrypted, so anyone who can watch your Wi-Fi traffic could read them. Do not run it on a public or shared network.
- **Nothing leaves your LAN.** The running server contacts nothing on the internet: no telemetry, no update check, no web fonts or scripts from elsewhere.
- **The player view is open to any browser on the Wi-Fi.** It shows only what is visible on the live scene; hidden tokens never leave the server.
- **Guessing the PIN:**
  - After 5 wrong PINs from one device, PIN entry from it is refused for 1 minute. The wait doubles on each further 5.
  - After 20 wrong PINs from any devices within 10 minutes, or 100 within 24 hours, PIN entry is paused for 10 minutes on every device except the server PC itself. Wrong PINs typed on the server PC count towards neither. The pause doubles on each further run of either kind, and only a restart of the server brings it back to 10 minutes, so a device that keeps guessing can keep PIN entry away from other devices for ever longer; restart the server to end that. Every pause is logged with the addresses that caused it.
  - Browsers already signed in keep working during a pause. To sign in, or to change the PIN, during a pause, use a browser on the server PC opened at `http://localhost:3000/dm` (not the network address the console prints); its own limit of 5 wrong PINs still applies. A device refused during a pause says so, gives that address with the port it used, and says how long the pause has left, in hours once it passes two.
  - A device that keeps just under both limits, changing its address, is never paused: at most 99 guesses a day. A 4-digit PIN could be found that way within about 100 days, a 6-digit one only in decades, an 8-digit one practically never.
  - Choose a PIN of 6 to 8 digits: a 4-digit PIN is the easiest to guess.

### Firewall

**Windows.** With the Windows installer this is done for you: see [Windows package](#windows-package). Otherwise, the first time Emberglass starts, Windows Defender Firewall asks whether Node.js (with the zip: Emberglass) may communicate on networks. Allow it on **private networks only**, and leave public networks unticked. Your home Wi-Fi must be set as a private network in Windows' network settings; otherwise the TV cannot reach the server. To change the answer later, open Windows Defender Firewall, then "Allow an app through firewall", then Node.js (or Emberglass).

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

`make setup` points development at `.dev-data/` in the clone, so `make dev` never opens your real campaigns. On Windows, `npm start` and `npm run dev` run natively and the `make` targets run from MSYS2, Git Bash or WSL, as CI runs them; `make clean-start` needs Linux or WSL (D-129).

The acceptance journeys of `specs/10-testing-acceptance.md` §5 are `e2e/tests/journeys/`. `node e2e/fixtures/large-scene.ts <folder>` writes the large-scene fixture's generated images (a 10,000 × 7,000 px map and five token images) for loading by hand, as on a TV acceptance run.

- Agents and contributors start at `AGENTS.md`. Ready-made session prompts: `SESSION_BOOTSTRAP_PROMPT_SAMPLE.md`.
- Specifications: `specs/README.md` (map, requirement language, conflict resolution).
- Raw requirements and their authority: `docs/inputs/README.md`.
- Current work, decisions, gaps, open questions and evidence: `PLAN.md`, `DECISIONS.md`, `GAPS.md`, `QUESTIONS.md`, `TRACEABILITY.md`.

Stack: Node.js 24 LTS (one process), TypeScript, Fastify, Socket.io, SQLite (better-sqlite3), sharp, React with react-konva, Vite; Vitest and Playwright.

### Continuous integration

GitHub Actions, `.github/workflows/ci.yml` (FND-02, `specs/13-implementation-plan.md` §3; D-060, D-061), on every pull request, every push to `main` and on demand. The two package jobs run only on pushes to `main` and on demand, not on pull requests (D-179). Every job runs exactly one root `Makefile` target, so a gate cannot pass in CI and fail locally: to reproduce a red job, run its command. Before it, a job only provisions the machine (checkout, Node from `.nvmrc`, `make setup`; on Windows also MSYS2 for `make` and bash). No job retries.

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
| `package · windows` | `windows-latest` | `make package` |
| `package gates · windows` | `windows-latest` | `make package-gates` |

The `e2e` jobs run the acceptance suite (`specs/10-testing-acceptance.md` §4–§6, D-127): Chromium runs every spec, and the five journeys of `e2e/tests/journeys/` also run in Firefox and WebKit on both runners and in Edge on Windows, as named by `EMBERGLASS_E2E_BROWSERS` (locally the default is Chromium alone; `npx playwright install firefox webkit` adds the others). Every browser runs behind a proxy that refuses and records anything beyond the local host, and the server under a guard that does the same, so `make e2e` is also the offline run. Its last test, `e2e/tests/offline.spec.ts`, fails unless every server announced the guard and nothing was attempted but one probe request from each browser, which shows that browser's traffic was watched; Edge's own calls to Microsoft's services are blocked and listed, not counted (D-133). `make build` fails when the built client references another host (`scripts/check-external-urls.mjs`).

The `package · windows` job builds the portable Windows package from the commit (`scripts/package/build.mjs`: the server bundled by esbuild, the runner's own Node.js renamed `emberglass.exe`, the native modules `npm ci` installed for Windows, the licences) and checks it as a DM would use it (`scripts/package/check.mjs`): unzipped, started by `Emberglass.cmd` with no Node.js on PATH and an empty data directory, it must pass `make smoke`'s checks, and a second start must only open the browser; the zip is kept as an artifact for seven days. Elsewhere `make package` builds and checks the same folder for that system, to try it; only Windows x64 is published. `.github/workflows/release.yml` runs the same target on a `v<version>` tag (D-164, D-166).

The `package gates · windows` job (PKG-03, D-176) takes the installer and zip that job kept, installs the installer silently on a fresh Windows runner, and runs `make package-gates` (`scripts/package/gates.mjs`) against the installed folder: the three `@gate:` tests of the hidden-information suite, then the five journeys and the large-scene fixture in Chromium and Edge, then the offline run's check. Every server of both runs is the installed `emberglass.exe` running the installed launcher, as `Emberglass.cmd` does, with nothing on PATH, so no Node.js is found and no other browser opens; the job fails unless each gate test ran there and passed (the verdicts are `scripts/package/lib.mjs`'s, tested in `lib.test.mjs`), checks that the installer and zip are the ones the package job built, and uninstalls the package at the end. Elsewhere `make package-gates` runs the same against the zip `make package` left, unzipped. On a tag, the release workflow runs this job after `package · windows`, and only when it passes, and the owner approves the job in the repository's `release` environment, does its last job, which runs no project code, check that the files are the ones built and gated, attest their build provenance and publish the GitHub Release (a pre-release for a tag such as `v1.0.0-rc.1`); a release already published for the tag is never replaced, and a draft an earlier attempt left is deleted, not published (D-177).

Gates that the testing specification requires and nothing implements yet would run as failing-forward tripwires (`make tripwire`, D-061), one job each; there are none left, since REL-02 promoted the last two, and `make tripwire` says so.

`make verify` runs the first seven gate commands; `make audit` and `make scan-secrets` run beside it. Caches (npm, Playwright browsers) are keyed on `package-lock.json`, and a failed `e2e` job keeps `e2e/test-results/` as an artifact for seven days. A ruleset on `main` requires every job above by name but the two package jobs, so a red pipeline blocks a merge; it lives on GitHub, not in this repository. The package jobs cannot be required checks, since they do not run on pull requests: a red one on `main` is fixed before the next tag, and the release workflow refuses to publish without them.

