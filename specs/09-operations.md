# 09 — Operations

How a DM installs, starts, configures and backs up Emberglass.

## 1. Installation

- The MVP MUST be installable from source: install Node, clone the repository, run one install command and one start command, all documented in the README; nothing is published to a package registry. [Q-017, recommendation accepted]
- The install command is `npm install` and the start command `npm start`, which builds the client if needed, applies pending migrations and starts the server; `npm run dev` is the development mode. [D-033]
- The server refuses to start on a Node major older than 24. [D-012]

## 2. Start-up

- On start the server MUST print the player-view URL and QR code for its LAN address (`08` §5). [input]
- When no PIN is set, the console MUST tell the DM to open the DM view on the server PC to set it (`07` §1). [Q-007, recommendation accepted]
- The server MUST apply pending SQLite migrations before accepting connections. [D-009]

## 3. Supported systems

- The server MUST be verified on Windows and on Linux; macOS is best-effort, with no acceptance run. [Q-018, recommendation accepted]

## 4. Firewall

- On Windows the firewall asks for permission on first start; the README MUST explain allowing Node on private networks. [input]
- The README MUST also explain opening the port on Linux with a common host firewall. [Q-018, recommendation accepted]

## 5. Data directory and backup

- All state MUST live in one data directory: the SQLite database and the images folder (`02` §7). [input]
- A backup MUST be a copy of the data directory, with no database server to set up. [input]
- In the MVP, moving a campaign to another PC means copying the whole data directory; there is no per-campaign export (`01` §4). [Q-013, recommendation accepted]
- The default location is the per-user application data folder of each system, holding `emberglass.db`, `images/` and `logs/`; the README says to stop the server before copying it. [D-034]

## 6. Logging

- Logs follow `07` §8 and go to the console and to a rotating file in the data directory. [D-035]

## 7. Configuration

- The upload size limit (`05` §6), the display-version size (`05` §7) and the ruler rule (`06` §5) MUST be settings the DM changes from the DM view without restarting. [input, D-021, D-024]
- Port and data directory are set with `EMBERGLASS_PORT` and `EMBERGLASS_DATA_DIR`. [D-034]

## 8. Repository documents

- The repository MUST ship the AGPL-3.0 licence text as `LICENSE` (`01` §8). [Q-021]
- The README MUST describe the product as compatible with 5th edition (SRD 5.1) without using "D&D" in the product name (`01` §8). [Q-022]
- The README MUST state the network exposure of `07` §4. [Q-011, recommendation accepted]
