# PLAN

Only `Now` and `Next`. Completed items are removed; Git is the archive. See `AGENTS.md` for rules.

## Now

### REL-01 — Operations and repository documents

- **Outcome:** a DM installs from source and runs Emberglass on their own PC from the README alone, and tunes the upload limit, the display-version size and the ruler's diagonal rule from a settings screen in the DM view without restarting (Q-051). The settings are saved through the session-guarded settings route, strictly validated and bounded. A new display size regenerates every display version in the background, including an image uploaded during the run (G-015). A new rule reaches the TV's measurement and every open DM view (G-036). The README covers the install and start commands, the data directory and backup, the PIN hash held in backups (G-008), one server per data directory and the images folder's growth (G-017), the firewall on Windows and Linux, the network exposure of `07` §4, and the 5th-edition description without "D&D". `LICENSE` holds the AGPL-3.0 text. The start-up, migration, logging and configuration behaviour already built is checked against `09` §1, §2, §5, §6 and §7, and any mismatch is fixed or recorded.
- **Specs:** `13` §7 REL-01, `09` §1, `09` §2, `09` §4, `09` §5, `09` §6, `09` §7, `09` §8, `05` §6, `05` §7, `06` §5, `07` §4, `01` §8; Q-011, Q-017, Q-021, Q-022, Q-037, Q-051, Q-076; G-008, G-010, G-015, G-017, G-036.
- **Dependencies:** LIV-07 (the ruler rule, D-121); SRV-04's `regenerateDisplayVersions` (D-080); SRV-02's settings and PIN routes (D-076).
- **Before implementation:** G-010's closing evidence is an owner decision. Its card (a failure budget across addresses, IPv6 keyed by /64, or the residual risk accepted in the README) is opened and answered first (prompt 3).
- **Acceptance (executable):**
  - Vitest (server, real SQLite file): the settings update is accepted only from a DM session with a valid Origin, and is strict and bounded for each field. A rejected update changes nothing. A new upload limit applies to the next upload. A new display size regenerates every display version, including one uploaded during the run. A new ruler rule changes the distance of the live measurement in both rooms. No response carries the PIN hash.
  - Vitest (client): the settings screen shows, edits and saves the three settings, with field errors, keyboard operation and its loading, saving and failure states. An open DM view measures by the new rule.
  - Playwright: a settings change in a DM context takes effect with no restart: the upload limit is refused at its new value, and the TV's distance follows a new rule.
  - Documents: `README.md` and `LICENSE` present with the content above, and each README statement checked against the running server. G-008, G-015, G-017 and G-036 closed, or kept with a recorded decision. G-010 closed by its card's answer and test. `make verify` exit 0 on both CI runners. `TRACEABILITY.md` REL-01 row with test names.
- **Non-goals:** packaging or a desktop wrapper (`02` §8); publishing to a registry (Q-017); the acceptance suite, the offline run and the system matrix (REL-02); the owner's TV (REL-03).
- **Review:** `Touches red line: yes` and `Contract change: yes`, so prompt 2 (review) runs after implementation.

## Next

1. **REL-02 — Acceptance suite and system matrix.** The acceptance scenarios, including the run journey end to end, which is Phase 3's remaining exit criterion; the offline run and the external-URL build check; the large-scene fixture; server acceptance on Windows and Linux and the browser matrix; and the residuals it closes or accepts (G-003, G-018, G-022, G-026, G-029, G-031 to G-035, G-037; `13` §7, `10` §3, `10` §4, `10` §5, `10` §6).
2. **REL-03 — Acceptance on the owner's TV.** The player view on the owner's LG TV with the large-scene fixture, and the display-size default confirmed or changed (G-002; `13` §7, `10` §4, `05` §7).
