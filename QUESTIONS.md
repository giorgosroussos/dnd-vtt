# QUESTIONS

Generated file. The source of truth is the append-only, hash-chained event log at `.log/events.jsonl`; this file is the projection of its `questions` stream. Do not edit it by hand: an edit here does not change what was asked or answered, and `make check-docs` fails until the file equals a fresh rebuild (`projection-fresh`). Cards are opened, answered, deferred, resolved and superseded by appending events with `scripts/log-append.py`, then `make rebuild-questions`.

Only matters the specs cannot answer, each as a decision card. A card belongs here if and only if its plausible answers change data, security, scope, external commitments or product identity/UX; anything else is decided in `DECISIONS.md` with alternatives and is never asked. A card is resolved by answering it, writing the answer into the specs with a `[Q-NNN]` tag (or, after the baseline, into a decision), and appending `card-resolved`. Nothing is ever removed: an owner who changes their mind gets a new card and a `card-superseded` event, and both cards stay readable, because the options the owner saw are the only record of why the decision reads as it does.

Card format:

```
### Q-NNN — <title>
- Surface: data | security | scope | external | ux
- Source: <requirement text, input file, mockup artboard, or the gap that raised it>
- Question: <one sentence>
- Options:
  - A) <option> → effect on <surface>: <concrete consequence>
  - B) <option> → effect on <surface>: <concrete consequence>
- Recommendation: <A|B|C>, because <one or two sentences>
- Blocks: <specification | Phase N | WORK-PACKAGE-ID>
- Answer: <A|B|C|text> (<date>[; recommendation accepted])
```

Every card opens `Blocking` and is answered before the specification proceeds. `Open` cards are the ones the owner deferred, by a `card-deferred` event that names the phase or work package before which they are answered; the spec text that depends on them states the recommendation and carries the `[Q-NNN]` tag, so the provisional status is visible where the statement is read. `make check-docs` verifies the card fields, the Surface value, and that every Resolved card that has not been superseded is cited by a statement.

## Index

- Q-001 — Grid preset propagation between scenes — data — Resolved
- Q-002 — Image files no longer referenced — data — Resolved
- Q-003 — Deleting a campaign — data — Resolved
- Q-004 — Permanence of deletions — data — Resolved
- Q-005 — Lifetime of the DM's undo history — data — Resolved
- Q-006 — Whether a scene must have a map image — data — Resolved
- Q-007 — Setting, changing and recovering the DM PIN — security — Resolved
- Q-008 — How long a PIN entry lasts — security — Resolved
- Q-009 — PIN format and protection against guessing — security — Resolved
- Q-010 — Who may open the player view — security — Resolved
- Q-011 — Plain HTTP or HTTPS on the LAN — security — Resolved
- Q-012 — Who may fetch image files — security — Resolved
- Q-013 — Campaign export/import: MVP or Phase 2 — scope — Resolved
- Q-014 — Token operations available on the live scene — scope — Resolved
- Q-015 — Editing the live scene's setup while it is live — scope — Resolved
- Q-016 — Table tools beyond the ruler — scope — Resolved
- Q-017 — How a DM installs and starts the MVP — scope — Resolved
- Q-018 — Operating systems the server supports — scope — Resolved
- Q-019 — Browsers the player view is accepted on — scope — Resolved
- Q-020 — Contact with anything outside the LAN — external — Resolved
- Q-021 — Licence of the project's source — external — Resolved
- Q-022 — Public name and the D&D trademark — external — Resolved
- Q-023 — Top-level navigation of the DM view — ux — Resolved
- Q-024 — Controlling the live scene while preparing another — ux — Resolved
- Q-025 — Player view when no scene is live — ux — Resolved
- Q-026 — Where the QR code appears and what it opens — ux — Resolved
- Q-027 — Whether the ruler is visible on the player view — ux — Resolved
- Q-028 — Language of the user interface — ux — Resolved
- Q-029 — Devices the DM view supports — ux — Resolved
- Q-030 — Accessibility target — ux — Resolved
- Q-031 — Deleting the scene that is live — data — Resolved
- Q-032 — Token labels on the player view — ux — Resolved
- Q-033 — Effect of a PIN change on DM sessions — security — Resolved
- Q-034 — Map-less scene default extent and attaching a map later — data — Resolved
- Q-035 — Rejected uploads leave nothing behind — data — Resolved
- Q-036 — Image variant format, sizes and regeneration — data — Resolved
- Q-037 — Scope of the diagonal-rule setting — data — Resolved
- Q-038 — Player camera kept in memory and reset on activation — data — Resolved
- Q-039 — Default data directory location — data — Resolved
- Q-040 — Log file on disk — data — Resolved
- Q-041 — Client addresses in logs — data — Resolved
- Q-042 — PIN stored only as a slow hash — security — Resolved
- Q-043 — DM session cookie and origin checks — security — Resolved
- Q-044 — Credentials never in logs — security — Resolved
- Q-045 — Default visibility of npc and object assets — security — Resolved
- Q-046 — The DM session as the only source of DM rights — security — Resolved
- Q-047 — Fields a player client receives — security — Resolved
- Q-048 — Ruler with two points only — scope — Resolved
- Q-049 — Keeping the MVP wrapper-compatible — scope — Resolved
- Q-050 — Undo for setup edits on the live scene — scope — Resolved
- Q-051 — Where settings are changed — scope — Resolved
- Q-052 — Which view sits at the server root — ux — Resolved
- Q-053 — Which LAN address the connect panel highlights — ux — Resolved
- Q-054 — How hidden tokens look to the DM and whether the TV view has controls — ux — Resolved
- Q-055 — Who creates entity identifiers — data — Resolved
- Q-056 — Live version counter after a restart — data — Resolved
- Q-057 — Image URLs built from the content hash — security — Resolved
- Q-058 — Signing a browser out of the DM view — security — Resolved
- Q-059 — Placing a token off the grid — scope — Resolved
- Q-060 — Load the MVP is accepted against — scope — Resolved
- Q-061 — How MVP acceptance is defined — scope — Resolved
- Q-062 — Which MUSTs are part of MVP acceptance — scope — Resolved
- Q-063 — Token numbering rule on the TV — ux — Resolved
- Q-064 — Tag filter matching in the library and picker — ux — Resolved
- Q-065 — The set of critical journeys — ux — Resolved
- Q-066 — Code host and CI service — external — Resolved
- Q-067 — A test that records everything the player view receives — security — Resolved
- Q-068 — A test that player commands are rejected — security — Resolved
- Q-069 — Security over convenience in conflicts — security — Resolved
- Q-070 — What "Future" means — scope — Resolved
- Q-071 — Material ambiguities go to you before code — scope — Resolved
- Q-072 — What changing a locked decision requires — scope — Resolved
- Q-073 — Small implementation details decided locally — scope — Resolved
- Q-074 — New product promises go through the matrix first — scope — Resolved
- Q-075 — Automatic database migration on start — data — Resolved
- Q-076 — Firewall scope the DM is told to allow — security — Resolved
- Q-077 — The register over detailed statements — scope — Resolved
- Q-078 — What the MVP label means — scope — Resolved
- Q-079 — What Out of Scope means — scope — Resolved
- Q-080 — Steering the TV camera with the frame — ux — Resolved
- Q-081 — How schema changes treat existing data — data — Resolved
- Q-082 — What data migrations are tested on — data — Resolved
- Q-083 — Hiding and deleting look the same to players — security — Resolved
- Q-084 — Internal sequential keys beside UUIDs — data — Resolved
- Q-085 — What `/api/auth` tells a browser without a session — security — Resolved
- Q-086 — Measurements on scenes that are not live — security — Resolved
- Q-087 — Ruler scale from the scene's feet per square — scope — Resolved
- Q-088 — Test art is generated, not third-party — external — Resolved
- Q-089 — Reordering by dragging in the sidebar — ux — Resolved
- Q-090 — Ordering campaigns in the sidebar — data — Resolved
- Q-091 — Remembering the token numbers already issued on a scene — data — Resolved
- Q-092 — Token numbering that would reveal a hidden token — security — Resolved
- Q-093 — Version numbers that would reveal a hidden token — security — Blocking

## Blocking

### Q-093 — Version numbers that would reveal a hidden token
- Surface: security
- Source: Raised while implementing LIV-01, 2026-09-25: `04` §5 has one version counter per server process [Q-056, D-017] carried by every event, but `04` §3 sends the `players` room only some events (not the move, addition or deletion of a hidden token), so a TV would see its versions skip (5, then 7) exactly when the DM touches a hidden token, and `04` §4 forbids anything from which a hidden token's existence can be learnt. In LIV-01 only per-socket snapshots exist, so nothing diverges yet; LIV-02's events are the first that do.
- Question: How should event versions be counted so that the players room never sees a version it did not receive?
- Options:
  - A) One counter per room, both in the process's memory and starting at 1 at start-up: the dm room's counts every event, the players room's only the events players receive → effect on security: a player's versions never skip, so they say nothing about hidden tokens; `04` §5's "one per server process" becomes "one per room per server process", and the register bullet (in memory, restarts at 1) still holds.
  - B) Keep one counter; the players' copy of each event carries no version, and players resynchronise only from the snapshot every reconnection brings → effect on security: nothing leaks, but `04` §5's input requirement that every event carries a version and a client detects gaps no longer holds for the TV.
  - C) Keep one counter shared by both rooms and accept that a TV can infer that some DM-only event happened → effect on security: an exception to `04` §4; a curious player reading the traffic learns when a hidden token is added, moved or deleted.
  - D) Keep one counter, and send players an empty keep-alive event for every DM-only event so their sequence has no holes → effect on security: the TV still learns that something invisible happened and when, which is the same leak as C.
- Recommendation: A, because it is the only option that keeps both the gap detection `04` §5 requires and the isolation `04` §4 requires, and it changes only where the counter lives, not what is stored.
- Blocks: specification

## Open

None.

## Resolved

### Q-001 — Grid preset propagation between scenes
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.5 §Grid calibration «Preset ανά εικόνα: ο ίδιος χάρτης σε άλλη σκηνή παίρνει αυτόματα το grid του»; p.3–4 §Data model: `grid preset` on Image and `grid` on Scene.
- Question: When the DM calibrates the grid in one scene, what happens to the map image's preset and to other scenes that use the same map?
- Options:
  - A) Each scene copies the image preset when it is created; calibrating a scene also updates the preset for scenes created later; existing scenes keep their own grid → effect on data: grid stored per scene, the preset is a template; an edit never ripples into a scene already prepared.
  - B) Scenes share the image's grid live; calibrating in any scene changes every scene that uses that map → effect on data: grid stored once per image and Scene holds none; one edit moves the overlay in all scenes.
  - C) Each scene copies the preset when created; the preset changes only when the DM explicitly chooses "use as preset for this map" → effect on data: grid per scene; the preset is updated only by an explicit action.
- Recommendation: A, because it matches "preset" in the input (a new scene gets the latest calibration automatically) while an edit never silently changes a scene that is already prepared.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-002 — Image files no longer referenced
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.3 §Data model (Image shared by Asset and Scene, «Διπλότυπα αναγνωρίζονται από το hash»); p.6 «Αποθήκευση: αρχεία με όνομα το hash, στον φάκελο εικόνων»; deletion of image files is absent from the inputs.
- Question: When no scene and no asset references an image any more, what happens to its files (original, display variant, thumbnail) and its grid preset?
- Options:
  - A) Removed automatically when the last reference is deleted → effect on data: the images folder holds only images in use; a map deleted with its scene loses its grid preset and must be re-uploaded.
  - B) Kept until the DM runs an explicit "remove unused images" action that lists them first → effect on data: unreferenced images accumulate on disk until the DM cleans up; nothing disappears without the DM seeing it.
  - C) Kept forever, with no way to delete image files in the MVP → effect on data: disk use only grows; the images folder is the full upload history.
- Recommendation: A, because it needs no extra screen and keeps the data folder (the backup unit) equal to what the DM actually uses; losing the preset of a map nobody uses any more is a small cost.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-003 — Deleting a campaign
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.4 §Αποφάσεις «Διαγραφές: session και scene κάνουν cascade. Asset σε χρήση: restrict»; campaign deletion is not stated.
- Question: What does deleting a campaign do?
- Options:
  - A) Cascades to its sessions, scenes and tokens after a confirmation that shows what will be removed → effect on data: one action removes the whole campaign tree; library assets and images stay.
  - B) Refused while the campaign still has sessions; the DM deletes the sessions first → effect on data: nothing is removed in bulk; a campaign can be deleted only when empty.
- Recommendation: A, because it is consistent with the session and scene cascade the input already fixes.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-004 — Permanence of deletions
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.4 §Αποφάσεις cascade rules; p.3 «Undo … για την ενεργή σκηνή»; p.2 «Backup = αντιγραφή φακέλου»; recovery of deleted campaigns, sessions, scenes and assets is absent from the inputs.
- Question: Outside the live-scene undo, are deletions permanent or recoverable?
- Options:
  - A) Permanent after a confirmation dialog; recovery only from a copy of the data folder → effect on data: deleted rows and their children are gone immediately.
  - B) Soft delete into a trash the DM can restore from or empty → effect on data: every entity gains a deleted state; deleted data stays on disk until emptied; the asset-in-use rule must also consider trashed scenes.
- Recommendation: A, because the input's recovery model is "copy the folder" and undo is deliberately scoped to the live scene; a trash doubles the lifecycle of every entity.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-005 — Lifetime of the DM's undo history
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.3 «Undo. Ο server κρατά ιστορικό αντίστροφων εντολών του DM για την ενεργή σκηνή»; lifetime and depth are absent from the inputs.
- Question: How long does the DM's undo history live?
- Options:
  - A) In server memory only, for the live scene, cleared when another scene is activated or the server restarts, bounded to the last 100 commands → effect on data: undo history is never stored; after a scene switch or restart Ctrl+Z does nothing.
  - B) Stored per scene in SQLite, surviving scene switches and restarts → effect on data: a new stored history per scene, with its own growth and deletion rules.
  - C) In memory, kept per scene for the server's lifetime (survives switching away and back, lost at restart) → effect on data: nothing stored on disk; several scenes' histories held at once.
- Recommendation: A, because the input scopes undo to the active scene and to play-time mistakes; nothing about it needs to outlive the scene being live.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-006 — Whether a scene must have a map image
- Surface: data
- Source: `D&D VTT — MVP Spec.pdf` p.4 §Data model Scene «map_image_id»; p.1 «Εκτός MVP: … δημιουργία χαρτών»; a scene without a map is absent from the inputs.
- Question: Must every scene have a map image?
- Options:
  - A) Yes; a scene is created from an uploaded map → effect on data: map_image_id required; no empty scenes.
  - B) No; a scene may have no map and show a plain background with the grid → effect on data: map_image_id optional; grid extent must be stored explicitly for map-less scenes.
- Recommendation: A, because grid calibration and token positions are defined relative to the map image, and map creation is outside the MVP.
- Blocks: specification
- Answer: B (2026-09-23)

### Q-007 — Setting, changing and recovering the DM PIN
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Πρόσβαση: χωρίς λογαριασμούς. PIN για το DM view»; how the PIN is set, changed and recovered is absent from the inputs.
- Question: How is the DM PIN first set, changed and recovered?
- Options:
  - A) Chosen by the DM on first launch from a browser on the server machine itself (localhost only); changeable in the DM view; reset by a command run on the server machine → effect on security: whoever controls the server PC controls the PIN; nobody on the Wi-Fi can claim the DM view before the DM does.
  - B) Generated by the server at every start and printed in the server console → effect on security: the PIN rotates every run and is never stored; the DM reads it off the PC each session.
  - C) Written by the DM in a configuration file before start → effect on security: the PIN is stored in plain text on disk; changing it means editing the file and restarting.
- Recommendation: A, because physical access to the server PC is the natural authority in a no-accounts design, and it closes the window where a first visitor on the Wi-Fi could set the PIN.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-008 — How long a PIN entry lasts
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.2 «PIN για το DM view» and «Επανασύνδεση: αυτόματη, γιατί οι συσκευές κοιμούνται και χάνουν το WebSocket»; session lifetime is absent from the inputs.
- Question: After the PIN is entered, how long does that browser stay authorised as DM?
- Options:
  - A) A server-issued session cookie valid for 30 days, invalidated on every device when the PIN changes → effect on security: the PIN is entered once per device per month; reconnects after sleep never ask again; a browser left logged in stays DM until expiry or a PIN change.
  - B) Until the server restarts → effect on security: the PIN is asked once per game night per device; sessions exist in memory only.
  - C) On every new connection, including automatic reconnects → effect on security: no stored credential; a laptop waking from sleep asks for the PIN, which defeats automatic reconnection.
- Recommendation: B, because a game night is the natural unit, nothing credential-like survives on disk, and automatic reconnection still works within the night.
- Blocks: specification
- Answer: B (2026-09-23; recommendation accepted)

### Q-009 — PIN format and protection against guessing
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.2 «PIN για το DM view»; p.6 «ο server είναι ανοιχτός σε όλο το Wi-Fi»; PIN format and throttling are absent from the inputs.
- Question: What PIN format and guessing protection does the DM view have?
- Options:
  - A) Numeric, 4–8 digits, with throttling per client (e.g. a 1-minute lockout after 5 failures, doubling on repeat) → effect on security: easy to type on any device; guessing a 4-digit PIN from the Wi-Fi takes days instead of seconds.
  - B) Free-form passphrase of at least 8 characters, same throttling → effect on security: much harder to guess; slower to type.
  - C) Numeric with no throttling → effect on security: a 4-digit PIN falls to a script on the same Wi-Fi within minutes.
- Recommendation: A, because it keeps the "PIN" the input names while making guessing impractical on a shared Wi-Fi.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-010 — Who may open the player view
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.1–2 «Η TV συνδέεται μόνο στο live», «PIN για το DM view»; p.1 «Εκτός MVP: συσκευές παικτών»; access to the player view is not stated.
- Question: Who may open the player view?
- Options:
  - A) Anyone on the LAN, without a code, any number of screens at once, read-only → effect on security: any device on the Wi-Fi can watch the visible state of the live scene; nothing hidden is ever sent to it.
  - B) Only screens the DM has approved from the DM view → effect on security: a second credential type (screen pairing) exists; unapproved devices see nothing.
  - C) Anyone on the LAN, but only one player-view connection at a time → effect on security: a new screen disconnects the previous one; any device on the Wi-Fi can take over the TV.
- Recommendation: A, because the input protects only the DM view, and server-side filtering already guarantees a player view never learns hidden content.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-011 — Plain HTTP or HTTPS on the LAN
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.1 «όλοι οι άλλοι συνδέονται από browser στο LAN»; p.2 «ο server βρίσκει την τοπική IP και δείχνει QR code»; transport security is absent from the inputs.
- Question: Is traffic on the LAN plain HTTP/WS or encrypted HTTPS/WSS?
- Options:
  - A) Plain HTTP and WS → effect on security: the PIN and the DM session cross the Wi-Fi unencrypted and can be captured by someone sniffing the same network; TV browsers connect without warnings.
  - B) HTTPS and WSS with a self-signed certificate generated on first run → effect on security: traffic encrypted; every browser, including the TV's, shows a certificate warning, and some TV browsers refuse to continue.
  - C) HTTP by default; HTTPS optional through a setting for a DM who supplies their own certificate → effect on security: as A by default, plus a second supported configuration.
- Recommendation: A, because the product runs on the DM's own Wi-Fi and certificate warnings on TV browsers would break the core journey; the exposure is stated in the README.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-012 — Who may fetch image files
- Surface: security
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Το φιλτράρισμα γίνεται στον server, όχι στο UI … Ο player client δεν ξέρει ότι υπάρχουν κρυφά tokens»; p.6 images stored as files named by hash; how image files are served is absent from the inputs.
- Question: Are image files served to anyone who requests them by hash, or only to clients entitled to see them?
- Options:
  - A) Served to anyone on the LAN who requests a hash; a player client only ever learns hashes of visible content → effect on security: protection rests on sha256 names being unguessable; a hash once seen (e.g. a token revealed then hidden) stays fetchable, as do prep maps if their hash leaks.
  - B) Player-role requests are served only for images referenced by visible content of the live scene; a DM session gets all → effect on security: the server checks entitlement on every image request; a revealed-then-hidden token's image stops being fetchable.
- Recommendation: B, because the input makes server-side filtering the security model, and B extends it to files instead of relying on unguessable names.
- Blocks: specification
- Answer: B (2026-09-23; recommendation accepted)

### Q-013 — Campaign export/import: MVP or Phase 2
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.5 §Βιβλιοθήκη assets «Export/import campaign: zip με τα assets που χρησιμοποιεί»; p.4 «UUID … ώστε το import από άλλο PC να μην έχει συγκρούσεις»; p.7 Roadmap, Φάση 2 «Export/import campaign σε zip». The input places it in both.
- Question: Is campaign export/import to a zip in the MVP or in Phase 2?
- Options:
  - A) Phase 2, as the roadmap lists; the MVP keeps UUIDs and hash-named images so it can be added without migration → effect on scope: no zip export/import in the first release; moving a campaign to another PC means copying the whole data folder.
  - B) MVP → effect on scope: export, and import with asset matching by image hash, ship in the first release; the rules for importing onto existing data become MVP decisions (further cards).
- Recommendation: A, because the roadmap checklist is the more specific statement and the data model already prepares for it.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-014 — Token operations available on the live scene
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Εντολές: token.move, token.add, token.setVisibility, scene.activate»; p.3 «Undo … κίνηση, προσθήκη, διαγραφή, ορατότητα». The undo list names deletion, the command list does not.
- Question: Which token operations can the DM perform on the live scene?
- Options:
  - A) The four listed commands plus token delete (the undo section already assumes it); label and stacking order are edited only while the scene is not live → effect on scope: a slain monster can be removed during play; renaming needs no live command.
  - B) Full token editing while live: move, add, delete, visibility, label, stacking order → effect on scope: six live commands, each with its inverse for undo.
  - C) Only the four listed; deletion only while the scene is not live → effect on scope: a token leaves the live scene only by being hidden; deletion drops out of the undo list.
- Recommendation: A, because it reconciles the two passages of the input with the smallest addition.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-015 — Editing the live scene's setup while it is live
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Ενεργή σκηνή ≠ σκηνή που επεξεργάζεται ο DM … Αλλαγές σε μη ενεργές σκηνές δεν στέλνονται πουθενά»; setup edits to the live scene itself are absent from the inputs.
- Question: Can the DM change the live scene's setup (map image, grid calibration, grid visibility) while it is live?
- Options:
  - A) Yes; each change is saved and pushed to players as a fresh snapshot → effect on scope: calibrating at the table is possible; the TV shows the change immediately, including the overlay while calibrating unless it is hidden for players.
  - B) No; setup is locked while the scene is live and only token commands apply → effect on scope: fixing a misaligned grid mid-game means activating another scene, editing, and activating it again.
- Recommendation: A, because a misaligned grid is typically noticed at the table, and the snapshot mechanism the input defines already covers the change.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-016 — Table tools beyond the ruler
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` Absent from the inputs; p.6 MVP list names only the ruler as a measuring tool, and the roadmap does not mention templates or pings anywhere.
- Question: Are table tools beyond the ruler (area-of-effect templates, a pointer/ping) part of the MVP?
- Options:
  - A) No; they are recorded as nice-to-haves and not built in the MVP → effect on scope: the ruler is the only measuring or pointing tool of the first release.
  - B) Area-of-effect templates (circle, cone, cube, line) in the MVP → effect on scope: a new tool with its own placement UI and, if shown on the TV, new live commands.
  - C) A pointer/ping visible on the TV in the MVP → effect on scope: a transient live event the DM uses to point at the map.
- Recommendation: A, because the input lists the MVP explicitly and adding tools the owner did not name is scope growth.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-017 — How a DM installs and starts the MVP
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Αργότερα: πακετάρισμα σε Tauri ή Electron»; p.7 Φάση 3; p.1 «Κίνητρο: δωρεάν, self-hosted εναλλακτική»; installation before Phase 3 is absent from the inputs.
- Question: How does a DM get and start the MVP?
- Options:
  - A) From source: install Node, clone the repository, run one install and one start command documented in the README → effect on scope: the MVP targets DMs comfortable with a terminal; nothing is published to a registry.
  - B) A published npm package started with one `npx` command → effect on scope: a registry release process joins the MVP; Node is still required.
  - C) A prebuilt single executable per operating system → effect on scope: a per-OS build and release pipeline joins the MVP, overlapping Phase 3 packaging.
- Recommendation: A, because packaging is explicitly Phase 3 and the MVP's success criterion is the owner running a session.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-018 — Operating systems the server supports
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Στα Windows το firewall ζητά άδεια την πρώτη φορά»; other operating systems are absent from the inputs.
- Question: On which operating systems must the server run and be verified in the MVP?
- Options:
  - A) Windows, macOS and Linux, all verified → effect on scope: acceptance on all three; LAN-address discovery and firewall guidance written per OS.
  - B) Windows and Linux verified; macOS best-effort → effect on scope: acceptance on two systems; macOS may work but nothing is promised.
  - C) Windows only → effect on scope: other systems explicitly unsupported.
- Recommendation: B, because Windows is the system the input names and Linux can be verified automatically at no cost; macOS needs hardware to verify.
- Blocks: specification
- Answer: B (2026-09-23; recommendation accepted)

### Q-019 — Browsers the player view is accepted on
- Surface: scope
- Source: `D&D VTT — MVP Spec.pdf` p.6 «battlemaps 5.000–10.000 px κολλάνε κινητά και browsers των TV» and «Χρειάζεται δοκιμή στη δική σας TV ή projector»; supported browsers are absent from the inputs.
- Question: Which browsers must the player view be accepted on?
- Options:
  - A) Current Chrome, Edge, Firefox and Safari on a device driving the TV or projector (laptop, mini-PC, HDMI stick); TV built-in browsers best-effort → effect on scope: acceptance on evergreen browsers only.
  - B) As A, plus the owner's own TV or projector browser, named in the answer, as an acceptance device → effect on scope: one specific low-power browser becomes an MVP target and bounds image sizes and canvas features.
  - C) As A, plus the built-in browsers of the major TV platforms (Samsung Tizen, LG webOS, Android TV) → effect on scope: acceptance on several constrained browsers nobody on the project may own.
- Recommendation: B, because the input already ties the display image size to the owner's own device; please name the device (model or platform) if you choose it.
- Blocks: specification
- Answer: B (2026-09-23; recommendation accepted)

### Q-020 — Contact with anything outside the LAN
- Surface: external
- Source: `D&D VTT — MVP Spec.pdf` p.1 «Web app που τρέχει τοπικά … συνδέονται από browser στο LAN»; internet access at runtime is absent from the inputs.
- Question: May the running application contact anything outside the LAN?
- Options:
  - A) Never: code, fonts and icons are bundled; no telemetry, no update check; it works with no internet connection → effect on external: no third party receives any data; the app works at a table without internet.
  - B) A version check against the project's release page at start, nothing else → effect on external: one third party (the release host) sees the DM's IP at each start; skipped silently when offline.
  - C) Opt-in anonymous crash reports to an error-tracking service → effect on external: a third-party processor with its own terms, and a privacy notice.
- Recommendation: A, because a free self-hosted LAN tool has no need to reach out, and the table may have no internet at all.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-021 — Licence of the project's source
- Surface: external
- Source: `D&D VTT — MVP Spec.pdf` p.1 «Κίνητρο: δωρεάν, self-hosted εναλλακτική στα VTT»; the project's own licence is absent from the inputs.
- Question: Under which licence is the project's source published?
- Options:
  - A) MIT → effect on external: anyone may reuse the code, including in closed or hosted products.
  - B) AGPL-3.0 → effect on external: anyone who distributes or hosts a modified version must publish its source.
  - C) Not published; the repository stays private → effect on external: "free, self-hosted" applies only to people the owner gives the code to.
- Recommendation: A, because it maximises reuse of a free tool and is compatible with every dependency the input names; choose B if preventing closed hosted forks matters more to you.
- Blocks: specification
- Answer: B (2026-09-23)

### Q-022 — Public name and the D&D trademark
- Surface: external
- Source: `D&D VTT — MVP Spec.pdf` Document title «D&D VTT»; p.1 «Κανόνες: D&D 5e, έκδοση 2014 (SRD 5.1)»; the product's public name is absent from the inputs.
- Question: What name does the product use publicly, given that "D&D" is a Wizards of the Coast trademark?
- Options:
  - A) A name of the owner's choosing without WotC marks (given in the answer), described as "compatible with 5th edition (SRD 5.1)" → effect on external: no use of third-party marks; the brand is the owner's own.
  - B) Keep "D&D VTT" → effect on external: the product name uses a third party's registered trademark without a licence, a legal risk once published.
  - C) "D&D VTT" only as the private working name; a public name without WotC marks is chosen before the repository or any release becomes public → effect on external: no public use of the mark; publication is blocked until the name is chosen.
- Recommendation: C, because the MVP runs at your own table and needs a working name now, while the public name only matters at publication.
- Blocks: specification
- Answer: A — public name "Emberglass" (2026-09-23)

### Q-023 — Top-level navigation of the DM view
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Βιβλιοθήκη, campaigns, sessions και στήσιμο σκηνών είναι REST CRUD»; p.4 Campaign → Session → Scene; how the DM view's screens connect is absent from the inputs.
- Question: What is the top-level navigation of the DM view?
- Options:
  - A) One workspace: a left sidebar with the Campaign → Session → Scene tree, the scene canvas in the centre, the asset library as a right-hand panel, and a persistent live bar at the top naming the live scene → effect on ux: the DM prepares and runs from one screen; the library is always one click away.
  - B) Page-based: Campaigns → Campaign (its sessions) → Session (its scenes) → full-screen scene editor; the library is a separate top-level page → effect on ux: more room per screen, more navigation between preparing and running.
- Recommendation: A, because the differentiator is preparing the next scene while the current one is live, which works best when both are one click apart.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-024 — Controlling the live scene while preparing another
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.2 «Ενεργή σκηνή ≠ σκηνή που επεξεργάζεται ο DM. Ο DM ετοιμάζει την επόμενη σκηνή ενώ οι παίκτες βλέπουν την τρέχουσα»; p.3 §Κάμερες (frame showing what the TV sees).
- Question: How does the DM control the live scene while editing another one?
- Options:
  - A) One canvas: the DM views either the live scene (live mode: every action reaches the TV, the player-camera frame is shown) or another scene (prep mode: nothing reaches the TV); the live bar returns to the live scene in one click; "Go live" activates the scene on screen → effect on ux: an unmistakable mode indicator tells the DM whether an action is visible to players.
  - B) Split view: the live scene in a smaller always-visible pane beside the scene being edited → effect on ux: the live scene stays controllable while preparing, at the cost of canvas space on a laptop.
- Recommendation: A, because on a laptop screen canvas space matters, and a single clear live/prep mode is the safest guard against revealing something by accident.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-025 — Player view when no scene is live
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.4 §Data model Settings «live_scene_id»; what the player view shows with no live scene is absent from the inputs.
- Question: What does the player view show when no scene is live?
- Options:
  - A) A dark idle screen with the product name only → effect on ux: the TV reveals nothing before the first scene or between scenes.
  - B) An idle screen with the connection URL and QR code → effect on ux: the TV doubles as the "how to connect" screen; the address is visible to the table.
  - C) The last live scene stays on screen until another is activated, and there is no "no live scene" state after the first → effect on ux: the DM can never blank the TV.
- Recommendation: A, because the DM needs a way to blank the TV and the player view has nothing to connect to it in the MVP.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-026 — Where the QR code appears and what it opens
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.2 «ο server βρίσκει την τοπική IP και δείχνει QR code»; where it is shown and which view it opens are absent from the inputs.
- Question: Where does the connection QR code appear, and which view does it open?
- Options:
  - A) In the server console at start and in a "Connect a screen" panel of the DM view; it opens the player view, shown next to a short URL to type into a TV browser → effect on ux: connecting the TV starts from the DM view; the DM view's address is never put in a QR.
  - B) Only in the server console at start, one QR for the DM view → effect on ux: the DM connects a laptop or tablet by scanning; the TV URL is typed from the console.
  - C) In the server console, two QR codes (DM view and player view) → effect on ux: both entry points are visible to anyone who sees the PC screen.
- Recommendation: A, because in the MVP the screen that needs connecting is the TV, and a TV browser needs a typed URL more than a QR.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-027 — Whether the ruler is visible on the player view
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.6 MVP «Ruler: κανόνας PHB 2014 (κάθε διαγώνιος = 5 ft), με τον προαιρετικό κανόνα DMG (5/10 ft) ως ρύθμιση»; who sees the measurement is absent from the inputs.
- Question: Is the ruler visible on the player view?
- Options:
  - A) Yes: while the DM measures on the live scene, the line and distance appear on the TV → effect on ux: players see movement distances; a transient live event.
  - B) No, DM-only → effect on ux: the DM reads distances aloud.
  - C) The DM chooses per measurement with a "show to players" toggle → effect on ux: one extra control; both behaviours.
- Recommendation: A, because at an in-person table the point of measuring is usually to show the players.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-028 — Language of the user interface
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` The input is written in Greek; the UI language is absent from the inputs.
- Question: In which language or languages is the user interface?
- Options:
  - A) English only in the MVP, with every UI string in one message catalogue so a translation can be added later → effect on ux: DM and TV text in English; game terms match the English SRD.
  - B) Greek only → effect on ux: UI in Greek; SRD terms need Greek equivalents.
  - C) English and Greek with a language switch in the MVP → effect on ux: every string exists twice; a missing translation falls back to English.
- Recommendation: A, because the rules and their data sources are English and the product aims beyond one table; a Greek catalogue can follow without code changes.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-029 — Devices the DM view supports
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` p.1 diagram «DM laptop»; p.7 Φάση 2 «UI για κινητό»; tablets are absent from the inputs.
- Question: Which devices must the DM view support?
- Options:
  - A) Laptop or desktop browsers with mouse and keyboard only; touch devices unsupported in the MVP → effect on ux: keyboard shortcuts such as Ctrl+Z and precise mouse drag are assumed.
  - B) Laptop and tablet (touch) → effect on ux: every DM interaction needs a touch equivalent and the layout must fit a tablet.
- Recommendation: A, because the input names a DM laptop and moves mobile UI to Phase 2.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-030 — Accessibility target
- Surface: ux
- Source: `D&D VTT — MVP Spec.pdf` Absent from the inputs.
- Question: Which accessibility target does the MVP commit to?
- Options:
  - A) No formal target; core DM actions operable by keyboard and text contrast readable → effect on ux: no conformance claim.
  - B) WCAG 2.2 AA for the DM view, the map canvas excepted → effect on ux: a conformance claim with a per-screen audit.
- Recommendation: A, because there is no legal obligation for a free self-hosted tool and the core surface is a canvas; the choice can be raised again before any public release.
- Blocks: specification
- Answer: A (2026-09-23)

### Q-031 — Deleting the scene that is live
- Surface: data
- Source: Raised while writing `specs/03-domain-model.md`: `D&D VTT — MVP Spec.pdf` p.4 «Διαγραφές: session και scene κάνουν cascade» and Settings «live_scene_id»; Q-003 A (campaign cascade) and Q-025 A (idle screen) do not say what happens when the deleted scene, or the session or campaign containing it, is the live one.
- Question: What happens when the DM deletes the live scene, or a session or campaign that contains it?
- Options:
  - A) Allowed after the usual confirmation, which also warns that the scene is live; the live scene is cleared and the player view switches to the idle screen → effect on data: the live pointer is cleared as part of the cascade; the TV blanks immediately.
  - B) Refused while the scene is live; the DM first activates another scene or blanks the TV → effect on data: the live scene and its ancestors cannot be deleted; one extra step before deleting during play.
- Recommendation: A, because it follows the cascade rules you already chose, and the idle screen of Q-025 is exactly the safe state for the TV.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-032 — Token labels on the player view
- Surface: ux
- Source: Raised while writing `specs/04-live-sync.md`: `D&D VTT — MVP Spec.pdf` p.5 «Αυτόματη αρίθμηση: 4 goblins γίνονται «Goblin 1–4»» and p.2 «οι παίκτες [παίρνουν] μόνο τα ορατά»; whether a visible token's label is shown on the TV is absent from the inputs.
- Question: Is a visible token's label shown on the player view?
- Options:
  - A) Yes, every visible token's label is shown on the TV → effect on ux: players can refer to "Goblin 3"; a label the DM writes (e.g. "Assassin") is visible to the table.
  - B) No, labels are DM-only; the TV shows token images only → effect on ux: players point at tokens instead of naming them; labels are private notes.
  - C) Per token: a "show label to players" flag, defaulting from the asset's category (on for pc, off for monster) → effect on ux and data: one more token field and control; the DM decides per token.
- Recommendation: A, because the auto-numbering in the input exists so the table can tell identical tokens apart, which only helps if players see the numbers; the DM controls the label text.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-033 — Effect of a PIN change on DM sessions
- Surface: security
- Source: Raised while writing `specs/07-security-and-access.md`: Q-007 A (PIN changeable in the DM view) and Q-008 B (DM session lasts until the server restarts) do not say whether a PIN change ends the sessions already open.
- Question: When the DM changes the PIN, what happens to DM sessions already open on other devices?
- Options:
  - A) They end immediately; those devices return to the PIN screen; the device that made the change stays signed in → effect on security: changing the PIN revokes anyone who learnt the old one, at once.
  - B) They continue until the server restarts; only new sign-ins need the new PIN → effect on security: a device signed in with a leaked PIN keeps DM access for the rest of the night.
- Recommendation: A, because the usual reason to change a PIN is that someone else learnt it, and B would leave them in.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-034 — Map-less scene default extent and attaching a map later
- Surface: data
- Source: Raised by the assumption review: `03-domain-model.md` §6: "The default extent is 30 × 20 on a neutral dark background; a map MAY be attached later, after which the grid is calibrated to it." (was D-016)
- Question: Should a map-less scene default to 30 × 20 squares and allow a map to be attached later?
- Options:
  - A) 30 × 20 default on a dark background; a map can be attached later and the grid is then calibrated to it → effect on data: every new map-less scene stores 30 × 20 until edited; a scene can turn from map-less into mapped.
  - B) The DM enters the extent when creating the scene, and a map-less scene stays map-less → effect on data: no stored default; converting means creating a new scene.
- Recommendation: A, because a default makes creating a scene one click and attaching a map later avoids re-placing tokens; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-035 — Rejected uploads leave nothing behind
- Surface: data
- Source: Raised by the assumption review: `05-assets-and-images.md` §6: "A rejected upload MUST return an error that names the reason (type or size) and store nothing." (was D-032)
- Question: Should a rejected upload leave nothing in the data directory?
- Options:
  - A) Store nothing; the error names the reason → effect on data: the images folder and database hold only accepted images.
  - B) Keep rejected files in a quarantine folder for diagnosis → effect on data: files that are not images of record, needing a clean-up rule.
- Recommendation: A, because a rejected file has no use to the DM and quarantine needs its own retention rule; can be deferred to SRV-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-036 — Image variant format, sizes and regeneration
- Surface: data
- Source: Raised by the assumption review: `05-assets-and-images.md` §7: "The display version's long edge is at most the display-size setting (default 4096 px, never upscaled); the thumbnail is 256 px; both are WebP; changing the setting regenerates display versions in the background …" (was D-021)
- Question: Should display versions and thumbnails be WebP (display default 4096 px, thumbnail 256 px) and be regenerated when the setting changes?
- Options:
  - A) As written → effect on data: two extra WebP files per image; changing the setting rewrites every display version.
  - B) Keep the original format for the variants and leave existing variants untouched when the setting changes → effect on data: larger files; only new uploads follow a changed setting.
- Recommendation: A, because smaller files help the TV browser and regeneration lets the LG TV test tune the size for existing maps too; can be deferred to SRV-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-037 — Scope of the diagonal-rule setting
- Surface: data
- Source: Raised by the assumption review: `06-grid-and-measurement.md` §5: "The diagonal rule is one server-wide setting, default PHB; a new scene's feet per square defaults to 5." (was D-024)
- Question: Should the PHB/DMG diagonal rule be one server-wide setting or stored per campaign?
- Options:
  - A) One server-wide setting, default PHB → effect on data: stored once in Settings; every campaign measures the same way.
  - B) Per campaign → effect on data: a new Campaign field; two campaigns on one server can use different rules.
- Recommendation: A, because the input calls it "a setting" and one server hosts one game; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-038 — Player camera kept in memory and reset on activation
- Surface: data
- Source: Raised by the assumption review: `04-live-sync.md` §9: "The player camera is held in server memory and resets to fit-to-map on every activation." (was D-018); also `08-ux-journeys.md` §4: "When a scene goes live the player view MUST switch to it, fitted to the map" — the input says only that the player view starts fitted.
- Question: Should the player camera live only in memory and reset to fit-to-map on every activation, or be saved per scene?
- Options:
  - A) Memory only, reset to fit-to-map on every activation and restart → effect on data: nothing stored; every scene goes live showing the whole map.
  - B) Saved per scene → effect on data: a stored camera per Scene; the DM can frame the TV view during prep and going live restores it.
- Recommendation: A, because it matches "the player view starts fitted to the map" with nothing new stored; can be deferred to LIV-06.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-039 — Default data directory location
- Surface: data
- Source: Raised by the assumption review: `09-operations.md` §5: "The default location is the per-user application data folder of each system, holding `emberglass.db`, `images/` and `logs/` …" (was D-034)
- Question: Should the data directory default to the per-user application-data folder, or live inside the repository checkout?
- Options:
  - A) Per-user application-data folder, with logs inside it → effect on data: survives a re-clone or `git clean`; the DM must find a hidden system folder to back it up (the start-up output prints its path).
  - B) A `data/` folder inside the checkout → effect on data: easy to find, but deleting or re-cloning the checkout deletes every campaign.
- Recommendation: A, because losing every campaign to a re-clone is the worse failure; can be deferred to REL-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-040 — Log file on disk
- Surface: data
- Source: Raised by the assumption review: `09-operations.md` §6: "Logs follow `07` §8 and go to the console and to a rotating file in the data directory." (was D-035)
- Question: Should logs also be written to a rotating file in the data directory?
- Options:
  - A) Console plus a file rotated at 5 MB, three old files kept → effect on data: a bounded log history, including client addresses, stays on disk and in backups.
  - B) Console only → effect on data: nothing kept on disk; no history to diagnose a problem after the window closes.
- Recommendation: A, because a game-night problem is usually investigated afterwards; can be deferred to FND-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-041 — Client addresses in logs
- Surface: data
- Source: Raised by the assumption review: `07-security-and-access.md` §8: "Logs record start-up, the LAN addresses served, connections by role, failed PIN attempts with the client address, lockouts and errors" (was D-029)
- Question: Should logs record connections by role and failed PIN attempts with the client's IP address?
- Options:
  - A) Yes, with client addresses → effect on data: household device IP addresses and a connection history are stored on disk; a guessing attempt can be traced to a device.
  - B) Only start-up, lockouts and errors, without client addresses → effect on data: no device addresses stored; guessing attempts cannot be traced.
- Recommendation: A, because on a home LAN the address is what tells the DM which device was guessing the PIN; can be deferred to FND-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-042 — PIN stored only as a slow hash
- Surface: security
- Source: Raised by the assumption review: `07-security-and-access.md` §1: "The PIN is stored only as a salted scrypt hash." (was D-027)
- Question: Should the PIN be stored only as a salted slow hash, or in a recoverable form?
- Options:
  - A) Salted scrypt hash only → effect on security: the PIN cannot be read from the data directory or a backup; a forgotten PIN is reset, never shown.
  - B) Reversible (plain or encrypted) → effect on security: the PIN can be shown again, and anyone with a copy of the data directory can read it.
- Recommendation: A, because the data directory is copied around as the backup; can be deferred to SRV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-043 — DM session cookie and origin checks
- Surface: security
- Source: Raised by the assumption review: `07-security-and-access.md` §2: "The session is a random 256-bit identifier in an HttpOnly, SameSite=Strict cookie, also read by the WebSocket handshake; REST writes and handshakes whose Origin does not match the server's host are refused." (was D-027)
- Question: Should the DM session be an HttpOnly, SameSite=Strict cookie with Origin checks on REST writes and WebSocket handshakes?
- Options:
  - A) HttpOnly SameSite=Strict cookie plus Origin checks → effect on security: page scripts cannot read the session and other web pages cannot drive the API; a DM view opened under a different host name or address than the request's own is refused.
  - B) A token kept by the page and sent explicitly, no Origin check → effect on security: works under any address, but any script in the page can read it and cross-site requests are not refused.
- Recommendation: A, because the DM's browser also visits other sites while the server is running; can be deferred to SRV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-044 — Credentials never in logs
- Surface: security
- Source: Raised by the assumption review: `07-security-and-access.md` §8: "Logs MUST NOT contain a PIN, a session identifier or a cookie." (was D-029)
- Question: Should logs be barred from ever containing the PIN, a session identifier or a cookie?
- Options:
  - A) Never logged, at any level → effect on security: log files and backups carry no credential.
  - B) Allowed at a debug level → effect on security: easier troubleshooting, but a debug log or its backup lets its reader take over the DM view.
- Recommendation: A, because log files travel with backups; can be deferred to FND-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-045 — Default visibility of npc and object assets
- Surface: security
- Source: Raised by the assumption review: `05-assets-and-images.md` §4: "A new `npc` or `object` asset defaults to visible; the DM can change `default_hidden` per asset." (was D-020)
- Question: Should new npc and object assets default to visible or to hidden?
- Options:
  - A) Visible → effect on security: an npc or object token added to the live scene appears on the TV at once unless its asset is set hidden.
  - B) Hidden → effect on security: only pc tokens reach the TV until the DM reveals them; nothing leaks by accident, at the cost of more reveals.
- Recommendation: A, because npcs and objects are usually shown openly and the per-asset flag covers the exceptions; can be deferred to SRV-05.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-046 — The DM session as the only source of DM rights
- Surface: security
- Source: Raised by the input audit: `02-architecture.md` §5 "Every `/api` route except `/api/auth` (PIN entry) and `/api/setup` MUST require a DM session", `04-live-sync.md` §1 "A socket MUST join `dm` only when it carries a valid DM session", `07-security-and-access.md` §7 "The server MUST derive a socket's or request's role only from its DM session" and the register's matching bullet were tagged [input], but the input says only «PIN για το DM view» and «έλεγχος ρόλου».
- Question: Is the DM session obtained with the PIN the only thing that grants DM rights — every REST route, the `dm` WebSocket room — with the server never trusting a role the client declares?
- Options:
  - A) Yes: every REST route except PIN entry and first-run setup, and the `dm` room, require the DM session; nothing the client declares grants a role → effect on security: without the PIN a LAN device can see only the player view.
  - B) Read-only REST routes (library, campaigns, scenes) are open to any LAN device; only writes and the `dm` room need the session → effect on security: anyone on the Wi-Fi can browse prepared scenes, including hidden tokens and future maps.
- Recommendation: A, because B would expose exactly the hidden content the player view is built to withhold.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-047 — Fields a player client receives
- Surface: security
- Source: Raised by the input audit: `04-live-sync.md` §4 "A player-room token MUST carry only what rendering needs: ID, position, size, image reference, stacking order and label; asset notes and defaults are never sent." was tagged [input, Q-032], but the input says only «οι παίκτες μόνο τα ορατά».
- Question: Should a player client receive only an allowlist of rendering fields for each visible token?
- Options:
  - A) Only ID, position, size, image reference, stacking order and label → effect on security: DM notes and asset defaults never reach a player device.
  - B) The full token and asset objects of visible tokens → effect on security: DM notes on a visible asset are readable by anyone who opens the player view.
- Recommendation: A, because DM notes are private and the player view needs nothing else; can be deferred to LIV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-048 — Ruler with two points only
- Surface: scope
- Source: Raised by the assumption review: `06-grid-and-measurement.md` §5: "The ruler measures a straight path between two square centres, without waypoints." (was D-025)
- Question: Should the MVP ruler measure only a straight two-point path?
- Options:
  - A) Two points, no waypoints → effect on scope: the smallest ruler; a path around a wall is measured in two goes.
  - B) Waypoints (multi-segment path) → effect on scope: more MVP work in the ruler, its live events and TV rendering.
- Recommendation: A, because the input names a ruler, not a path tool; can be deferred to LIV-07.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-049 — Keeping the MVP wrapper-compatible
- Surface: scope
- Source: Raised by the assumption review: `02-architecture.md` §8: "Nothing in the MVP may assume a browser-only deployment in a way that such a wrapper could not host, but no packaging work is done now." (untagged prose)
- Question: Should the MVP be constrained now so that a later Tauri or Electron wrapper can host it unchanged?
- Options:
  - A) Yes, as a design constraint with no packaging work → effect on scope: paths, data directory and networking stay wrapper-friendly; Phase 3 packaging should need no architectural change, as the input promises.
  - B) No constraint; Phase 3 adapts the code → effect on scope: the MVP may assume a browser freely; the adaptation cost moves to Phase 3.
- Recommendation: A, because the input says packaging comes later "without changing the architecture"; can be deferred to FND-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-050 — Undo for setup edits on the live scene
- Surface: scope
- Source: Raised by the input audit: `04-live-sync.md` §8 "Setup edits to the live scene are not undoable." was tagged [input]; the input's undo list (move, add, delete, visibility) predates Q-015, which made live setup edits possible.
- Question: Should undo on the live scene also cover setup edits (map image, grid calibration, grid visibility)?
- Options:
  - A) No; undo covers only the input's list: move, add, delete, visibility → effect on scope: a live calibration mistake is fixed by calibrating again.
  - B) Yes; setup edits join the undo history → effect on scope: inverse operations for map and grid changes, each re-sending a snapshot.
- Recommendation: A, because the input lists what undo covers and calibration has its own fine-tuning step; can be deferred to LIV-05.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-051 — Where settings are changed
- Surface: scope
- Source: Raised by the input audit: `09-operations.md` §7 "The upload size limit, the display-version size and the ruler rule MUST be settings the DM changes from the DM view without restarting" was tagged [input]; the input says only «ρυθμιζόμενο» and «ως ρύθμιση».
- Question: How does the DM change the upload limit, display-version size and diagonal rule?
- Options:
  - A) A settings screen in the DM view, applied without restarting → effect on scope: a settings screen joins the MVP.
  - B) Environment variables read at start → effect on scope: no settings screen; a change needs a restart and a terminal.
- Recommendation: A, because the display size is meant to be tuned by trial on the TV, which a restart per try makes slow; can be deferred to REL-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-052 — Which view sits at the server root
- Surface: ux
- Source: Raised by the assumption review: `02-architecture.md` §2: "… the player view is served at `/` and the DM view at `/dm`." (was D-014)
- Question: Should the player view be at the server root and the DM view at `/dm`, or the reverse?
- Options:
  - A) Player view at `/`, DM view at `/dm` → effect on ux: the URL typed on the TV is just address and port; the DM uses `/dm`.
  - B) DM view at `/`, player view at `/tv` → effect on ux: a longer URL on the TV; opening the bare address lands on the PIN screen.
- Recommendation: A, because the TV has the worst keyboard; can be deferred to FND-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-053 — Which LAN address the connect panel highlights
- Surface: ux
- Source: Raised by the assumption review: `08-ux-journeys.md` §5: "All non-internal IPv4 addresses are listed, the first private-range one shown prominently." (was D-030)
- Question: Should the connect panel list every LAN address and highlight the first private-range one?
- Options:
  - A) List all, highlight the first private-range one → effect on ux: works in the common case; with a VPN or virtual adapters the DM may need to pick another from the list.
  - B) One address the DM picks once and the server remembers → effect on ux: one unambiguous URL and QR, after a first-run choice.
- Recommendation: A, because it needs no setup step and still shows the alternatives; can be deferred to LIV-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-054 — How hidden tokens look to the DM and whether the TV view has controls
- Surface: ux
- Source: Raised by the assumption review: `08-ux-journeys.md` §9: "A hidden token is drawn semi-transparent with a hidden marker in the DM view; the player view has no controls and hides the cursor after two seconds." (was D-031)
- Question: Should hidden tokens be semi-transparent with a marker in the DM view, and the player view have no on-screen controls?
- Options:
  - A) As written → effect on ux: the TV shows only the scene; the DM spots hidden tokens by transparency and marker.
  - B) A fullscreen button on the player view and a different hidden-token cue (outline or toggleable layer) → effect on ux: easier TV setup; a different look for hidden tokens during play.
- Recommendation: A, because nobody operates the TV during play and browsers already offer fullscreen; can be deferred to PRP-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-055 — Who creates entity identifiers
- Surface: data
- Source: Raised by the second assumption review: `03-domain-model.md` §3: "UUIDs are generated by the server." (D-038)
- Question: Should new entities receive their UUID only from the server, or may a client supply the UUID of an entity it creates?
- Options:
  - A) Only the server generates UUIDs → effect on data: every identifier originates in one place; a client can never create a record under an identifier of its choosing.
  - B) Clients generate the UUID and send it; the server checks format and uniqueness → effect on data: the server stores identifiers it did not create and must guard against collisions and reuse.
- Recommendation: A, because the input chose UUIDs for moving data between PCs, not for client-side creation, and A keeps the trust boundary simple; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-056 — Live version counter after a restart
- Surface: data
- Source: Raised by the second assumption review: `04-live-sync.md` §5: "The version counter is one per server process, starting at 1 on start-up." (D-017)
- Question: Should the live-event version counter restart at 1 on every server start, or be stored so it keeps ascending?
- Options:
  - A) In memory, restarting at 1 → effect on data: nothing stored; after a restart every client resynchronises from a fresh snapshot.
  - B) Stored in SQLite and ascending forever → effect on data: a value written on every live event.
- Recommendation: A, because every client takes a fresh snapshot after a restart anyway; can be deferred to LIV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-057 — Image URLs built from the content hash
- Surface: security
- Source: Raised by the second assumption review: `05-assets-and-images.md` §7: "files are served at `/images/<sha256>/<variant>` subject to `07` §5" (D-021)
- Question: Should image URLs carry the sha256 of the original upload, or an opaque identifier?
- Options:
  - A) `/images/<sha256>/<variant>`, with the entitlement check of `07` §5 → effect on security: a URL reveals which file it is (the same map has the same hash everywhere); access still depends on entitlement.
  - B) An opaque random identifier mapped to the hash on the server → effect on security: URLs reveal nothing about the file; an extra stored mapping per image.
- Recommendation: A, because entitlement (Q-012) already decides who may fetch a file, and a published battlemap's hash identifies nothing secret; can be deferred to SRV-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-058 — Signing a browser out of the DM view
- Surface: security
- Source: Raised by the second assumption review: `02-architecture.md` §5 lists "leave" on `/api/auth`, while `07` §2 says a DM session lasts until the server restarts or the PIN changes.
- Question: Should the DM be able to sign a browser out of the DM view explicitly?
- Options:
  - A) Yes, a "Leave DM view" action ends that browser's session → effect on security: a borrowed or shared device can be signed out on the spot.
  - B) No; sessions end only on restart or a PIN change → effect on security: a borrowed browser stays a DM device for the rest of the night unless the PIN is changed.
- Recommendation: A, because at a table laptops get passed around and changing the PIN to sign one device out is heavy; can be deferred to SRV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-059 — Placing a token off the grid
- Surface: scope
- Source: Raised by the second assumption review: `06-grid-and-measurement.md` §4: "Snapping is on by default …; holding Alt while dropping places freely." (D-023); the input says only that tokens snap.
- Question: Should the MVP allow placing a token off the grid by holding Alt while dropping it?
- Options:
  - A) Yes: snap by default, Alt places freely → effect on scope: a free-placement capability beyond the input's snap-to-grid.
  - B) No: every drop snaps → effect on scope: tokens always sit on the grid; no override.
- Recommendation: A, because objects and scenery tokens often sit between squares and positions are already stored as decimals; can be deferred to PRP-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-060 — Load the MVP is accepted against
- Surface: scope
- Source: Raised by the second assumption review: `10-testing-acceptance.md` §3: "The large-scene fixture is a generated 10,000 × 7,000 px map with 50 tokens, plus a map-less scene." (D-036)
- Question: What scene load must the MVP be accepted against, including on the LG TV?
- Options:
  - A) A 10,000 × 7,000 px map with 50 tokens → effect on scope: the release promises to handle the top of the input's 5,000–10,000 px range with a busy encounter.
  - B) A lighter bar, e.g. a 5,000 px map with 20 tokens → effect on scope: easier to pass on a weak TV; large battlemaps are not promised.
- Recommendation: A, because the input names 10,000 px battlemaps as the case that breaks TV browsers; can be deferred to REL-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-061 — How MVP acceptance is defined
- Surface: scope
- Source: Raised by the second assumption review: `10-testing-acceptance.md` §5: "The MVP is accepted when each critical journey of `08` §10 passes end to end" (D-042)
- Question: Is the MVP accepted when the five critical journeys pass end to end, or must each MVP capability also be demonstrated on its own?
- Options:
  - A) The five journeys, with the automated suites of `10` §1–§3 covering everything else → effect on scope: the release gate is the journeys plus the test gates.
  - B) The journeys plus a manual per-capability checklist over `01` §3 → effect on scope: every listed capability is demonstrated by hand before release.
- Recommendation: A, because the automated gates already cover each capability and a manual checklist would duplicate them; can be deferred to REL-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-062 — Which MUSTs are part of MVP acceptance
- Surface: scope
- Source: Raised by the second assumption review: `specs/README.md` §Requirement language: "Unless explicitly labeled Future, every `MUST` requirement is part of MVP acceptance." (untagged regime text)
- Question: Is every MUST in the pack that is not labelled Future part of MVP acceptance?
- Options:
  - A) Yes, every non-Future MUST, including those from your cards and from recorded defaults → effect on scope: the release content is exactly what the specs state.
  - B) Only the capability list of `01` §3 plus the card additions; other MUSTs are guidance → effect on scope: a smaller release boundary, and an implementation may skip a MUST outside it.
- Recommendation: A, because a MUST that may be skipped is not a requirement, and every MUST is tagged so its origin is visible.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-063 — Token numbering rule on the TV
- Surface: ux
- Source: Raised by the second assumption review: `05-assets-and-images.md` §3: "Numbering is per scene, a single token keeps the bare name, and freed numbers are not reused." (D-019); labels are shown on the TV (Q-032).
- Question: Which numbering rule should token labels follow?
- Options:
  - A) Per scene; a lone token keeps the bare name until a second is added; freed numbers are not reused → effect on ux: after a deletion the TV may show Goblin 1, 2, 4, but a number never changes meaning.
  - B) Per scene, always numbered from 1, freed numbers reused → effect on ux: contiguous labels, but a new token can take the label players associated with a removed one.
- Recommendation: A, because players refer to tokens by number and a reused number would silently point at a different creature; can be deferred to PRP-04.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-064 — Tag filter matching in the library and picker
- Surface: ux
- Source: Raised by the second assumption review: `05-assets-and-images.md` §1: "filters by category and by tags (all selected tags must match), sorted by name" (D-022)
- Question: When several tags are selected, must an asset carry all of them or any of them, and are results sorted by name?
- Options:
  - A) All selected tags (AND), sorted by name → effect on ux: each tag narrows the picker; alphabetical results.
  - B) Any selected tag (OR), sorted by recent use → effect on ux: each tag widens the picker; recently used assets first.
- Recommendation: A, because a filter is for narrowing and alphabetical order is predictable mid-game; can be deferred to SRV-05.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-065 — The set of critical journeys
- Surface: ux
- Source: Raised by the second assumption review: `08-ux-journeys.md` §10 table: First run, Prepare, Connect TV, Run, Recover (untagged).
- Question: Are First run, Prepare, Connect TV, Run and Recover the complete set of critical journeys?
- Options:
  - A) These five → effect on ux: design and acceptance prioritise them; building the library, settings and backup are ordinary flows.
  - B) Add "Build the asset library" (upload, tag, set defaults) as a sixth → effect on ux: the library flow is designed and accepted end to end as well.
- Recommendation: A, because asset creation is already exercised inside Prepare; can be deferred to REL-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-066 — Code host and CI service
- Surface: external
- Source: Raised by the third assumption review: `13-implementation-plan.md` §3 FND-02: "A pipeline on the project's remote, running on every merge request and every push to the default branch, on Linux and Windows runners" (untagged); the inputs name no code host or CI service, and the repository has no remote yet.
- Question: Where is the repository hosted and where does CI run?
- Options:
  - A) A public GitHub repository with GitHub Actions on Linux and Windows runners → effect on external: a third-party host and CI provider; free for public repositories; the AGPL source is published there.
  - B) A public GitLab repository with GitLab CI → effect on external: a different third party; Windows runners are more limited on the free tier.
  - C) No hosted CI: gates run locally with `make verify`, Windows verified by hand before release → effect on external: no third party; FND-02 becomes a local script and per-merge assurance on Windows is lost.
- Recommendation: A, because the name and licence you chose point to a public release, and free Windows runners make the Windows verification of `09` §3 automatic; can be deferred to FND-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-067 — A test that records everything the player view receives
- Surface: security
- Source: Raised by the third assumption review: `10-testing-acceptance.md` §3: "A test MUST record every message and image response a player view receives across a scripted session … and assert that no hidden token's ID, asset, image or count appears in it" (D-042)
- Question: Should the release be gated on a test that records all player-view traffic across a scripted session and fails on any trace of a hidden token?
- Options:
  - A) Yes, a release gate → effect on security: a leak through any event, field or image, including ones added later, fails the build.
  - B) No; unit tests of the filtering code only → effect on security: a leak through a new event type or field could ship unnoticed.
- Recommendation: A, because hidden information never reaching the TV is the product's one non-negotiable property, and only an end-to-end recording catches leaks nobody anticipated; can be deferred to REL-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-068 — A test that player commands are rejected
- Surface: security
- Source: Raised by the third assumption review: `10-testing-acceptance.md` §3: "A test MUST assert that every command sent from the players room is rejected and changes nothing" (D-042)
- Question: Should a test prove that every command sent from a player view is rejected and changes nothing?
- Options:
  - A) Yes → effect on security: the read-only player view (Q-010) is verified on every build, not assumed.
  - B) No; rely on code review → effect on security: a handler that forgets the role check could let any device on the Wi-Fi move or reveal tokens.
- Recommendation: A, because the player view is open to any device on the Wi-Fi, so its being read-only must be tested; can be deferred to LIV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-069 — Security over convenience in conflicts
- Surface: security
- Source: Raised by the third assumption review: `specs/README.md` §Conflict resolution rule 2: "Security and hidden-information isolation requirements override convenience." (untagged)
- Question: When a security or hidden-information requirement conflicts with convenience, does security always win?
- Options:
  - A) Yes, always → effect on security: an implementer never trades a security or hiding rule for ease of use without an ADR you approve.
  - B) Case by case, decided by the implementer → effect on security: convenience may win silently where the implementer judges the risk small.
- Recommendation: A, because the alternative lets security rules erode one small trade-off at a time without you seeing it.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-070 — What "Future" means
- Surface: scope
- Source: Raised by the third assumption review: `specs/README.md` §Scope labels: "**Future:** anticipated in architecture, but not implemented in MVP." (untagged)
- Question: Must the MVP architecture anticipate Future items, or only avoid implementing them?
- Options:
  - A) Anticipated but not implemented: the MVP keeps the hooks the specs name (e.g. `character_id`, `grid.type`) and avoids choices that block Future items → effect on scope: small preparatory fields and constraints in the MVP, no Future features.
  - B) Only not implemented; Phase 2 adapts the code as needed → effect on scope: the MVP may drop the preparatory hooks; later phases may need migrations.
- Recommendation: A, because the input itself asks for these hooks (character_id, grid.type) so that Phase 2 needs no painful migration.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-071 — Material ambiguities go to you before code
- Surface: scope
- Source: Raised by the third assumption review: `specs/README.md` §Conflict resolution rule 4: "Ambiguities that materially affect data, security or scope become an Architecture Decision Record before implementation." (untagged)
- Question: When an implementer finds an ambiguity that affects data, security or scope, must it become an ADR awaiting your approval before code?
- Options:
  - A) Yes → effect on scope: nothing touching the five areas is decided in code without your sign-off; work on that item pauses until you answer.
  - B) No; the implementer decides and records it → effect on scope: faster, but data, security and scope decisions can be made without you.
- Recommendation: A, because it is the same rule this whole pack was built on: decisions that change the product are yours.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-072 — What changing a locked decision requires
- Surface: scope
- Source: Raised by the third assumption review: `12-decision-register.md` §6: "A proposed change requires: 1. a short ADR describing the problem; 2. alternatives and security/data/scope impact; 3. migration and testing implications; 4. Product Owner approval before code changes." (untagged)
- Question: Must every change to a locked decision go through an ADR with alternatives and impact, and your approval before code?
- Options:
  - A) Yes, all four steps → effect on scope: no locked decision changes without a written case and your approval.
  - B) Your approval only, no written ADR → effect on scope: lighter, but the reasoning and alternatives behind the change are not recorded.
- Recommendation: A, because the written ADR is the only record of why a locked decision changed.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-073 — Small implementation details decided locally
- Surface: scope
- Source: Raised by the third assumption review: `12-decision-register.md` §6: "Agents MUST NOT reopen decisions merely because a different framework or pattern is familiar. Small implementation details may be decided locally if they preserve the locked behavior and are recorded in `DECISIONS.md`." (D-002)
- Question: May implementers decide small details themselves, provided the locked behaviour is kept and the decision is recorded in DECISIONS.md?
- Options:
  - A) Yes, recorded in DECISIONS.md with alternatives → effect on scope: implementation proceeds without asking you about details; every such decision stays reviewable.
  - B) No; every decision not in the specs comes to you → effect on scope: you are asked about libraries, names and internals; work stalls on questions that change nothing you own.
- Recommendation: A, because it is how the pack already works: details are recorded decisions, product changes are your cards.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-074 — New product promises go through the matrix first
- Surface: scope
- Source: Raised by the third assumption review: `11-traceability.md` §Coverage rule: "Any future commercial promise MUST be added here before implementation and classified as MVP, Future or Out of Scope; a code change alone does not change product scope." (D-043)
- Question: Must any new product promise be classified in the traceability matrix before it is implemented?
- Options:
  - A) Yes, classified MVP, Future or Out of Scope in the matrix first → effect on scope: scope only grows through a recorded classification.
  - B) No; new features may be added in code and recorded afterwards → effect on scope: scope can grow silently through implementation.
- Recommendation: A, because the matrix is the one place where the product's scope is read.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-075 — Automatic database migration on start
- Surface: data
- Source: Raised by the fourth assumption review: `09-operations.md` §2 "The server MUST apply pending SQLite migrations before accepting connections." (D-009) and §1 "`npm start`, which builds the client if needed, applies pending migrations and starts the server" (D-033).
- Question: After an update, should the server migrate the DM's database automatically on start, or only after the DM runs an explicit command?
- Options:
  - A) Automatically, after first copying the database file to a dated backup in the data directory → effect on data: an update just works; each migration leaves a restorable copy of the previous database.
  - B) Automatically, with no backup → effect on data: an update just works; a faulty migration can damage the DM's only copy.
  - C) The server refuses to start while migrations are pending and tells the DM to back up and run `npm run migrate` → effect on data: nothing changes without a deliberate step; one more command after every update.
- Recommendation: A, because DMs running from source will just run `npm start` after pulling, and an automatic backup protects their campaigns without an extra step; can be deferred to REL-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-076 — Firewall scope the DM is told to allow
- Surface: security
- Source: Raised by the fourth assumption review: `08-ux-journeys.md` §5 and `09-operations.md` §4: the console and README "MUST tell the DM to allow private networks" (D-041).
- Question: When Windows asks about the firewall, should the DM be told to allow private networks only, or all networks?
- Options:
  - A) Private networks only → effect on security: the unencrypted server is closed on networks Windows marks public (cafés, hotels); on such a network the TV cannot connect until the DM changes the profile.
  - B) Private and public networks → effect on security: connecting works anywhere, but the plain-HTTP server and PIN entry are exposed on public Wi-Fi.
- Recommendation: A, because you chose plain HTTP for a trusted home network (Q-011); can be deferred to LIV-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-077 — The register over detailed statements
- Surface: scope
- Source: Raised by the fourth assumption review: `specs/README.md` §Conflict resolution rule 1: "`12-decision-register.md` and the product statement override inferred behavior." (untagged)
- Question: If a detailed statement in the specs conflicts with a register bullet or the product statement, which wins?
- Options:
  - A) The register and the product statement win; the conflicting detail is corrected under the amendment rules → effect on scope: your recorded decisions cannot be narrowed or widened by a detail elsewhere.
  - B) The more specific statement wins → effect on scope: a detail in `01`–`10` can change what the register says without an ADR.
- Recommendation: A, because the register holds only your own decisions and B would let them change without you.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-078 — What the MVP label means
- Surface: scope
- Source: Raised by the fourth assumption review: `specs/README.md` §Scope labels: "**MVP:** required for the first production release." (untagged)
- Question: Does MVP mean everything required before the first release, or a smaller first cut with the rest following?
- Options:
  - A) Everything labelled MVP is required before the first release → effect on scope: one release, gated on all MVP items and journeys.
  - B) A first usable cut may ship earlier, with some MVP items following → effect on scope: an earlier, smaller release and a tracked follow-up.
- Recommendation: A, because your definition of done (prepare and run a session alone) needs the whole MVP list; the phase plan already delivers usable steps internally.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-079 — What Out of Scope means
- Surface: scope
- Source: Raised by the fourth assumption review: `specs/README.md` §Scope labels: "**Out of Scope:** intentionally excluded; implementation agents must not add it." (untagged)
- Question: Are Out of Scope items (custom maps, remote play, full effects engine, dynamic lighting, hex grids) permanently excluded, or only unplanned?
- Options:
  - A) Intentionally excluded; never built unless you reclassify them through the traceability matrix → effect on scope: no architecture anticipates them and agents never add them.
  - B) Only unplanned, treated like unscheduled Future items → effect on scope: the architecture should leave room for them.
- Recommendation: A, because the input lists them under «Εκτός scope», separate from its Future lists.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-080 — Steering the TV camera with the frame
- Surface: ux
- Source: Raised by the fourth assumption review: `08-ux-journeys.md` §2: "… the frame of what the TV sees, which the DM can move and resize to steer the player camera" (D-046)
- Question: Should the DM steer the TV camera by dragging and resizing the TV frame, or through a separate control?
- Options:
  - A) Drag the frame to pan, resize it to zoom → effect on ux: steering the TV is direct manipulation on the DM canvas, no extra buttons.
  - B) The frame only shows; a "send my view to the TV" button sets the player camera to the DM's own view → effect on ux: one click to frame the TV, but the DM must move their own camera to do it.
- Recommendation: A, because the input gives the frame as the way the DM sets the TV camera, and B would move the DM's own view every time; can be deferred to LIV-06.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-081 — How schema changes treat existing data
- Surface: data
- Source: Raised by the fifth assumption review: `14-agent-playbook.md` §8: "Prefer additive nullable columns and tables, backfill, enforce, then later cleanup (expand, migrate, contract)." (untagged)
- Question: Should schema changes to the DM's database be additive first (add, backfill, enforce, clean up later) rather than rewriting or dropping data in one step?
- Options:
  - A) Additive first; destructive steps only in a later release and never without an approved plan → effect on data: an update never loses campaign data, and an older copy of the app can still read the database for a while.
  - B) Direct changes, dropping or rewriting columns in one migration → effect on data: simpler migrations; a faulty one can lose data, recoverable only from the pre-migration backup (Q-075).
- Recommendation: A, because the DM's database is their only copy of their campaigns; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-082 — What data migrations are tested on
- Surface: data
- Source: Raised by the fifth assumption review: `14-agent-playbook.md` §8: "Test migrations on a realistic anonymized dataset before production." (untagged); the product has no production server, and each DM's data stays on their PC.
- Question: What data should every migration be tested on before a release?
- Options:
  - A) A generated fixture database with campaigns, sessions, scenes, tokens, assets and images of every kind, built by a script in the repository → effect on data: no real campaign data ever enters the repository or CI.
  - B) A copy of a real campaign database the owner provides → effect on data: realistic data, but a DM's campaign (names, notes, purchased maps) is stored in the repository or CI.
- Recommendation: A, because there is no production dataset to anonymize and real campaigns may contain purchased maps; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-083 — Hiding and deleting look the same to players
- Surface: security
- Source: Raised by the fifth assumption review: `04-live-sync.md` §3: a deletion reaches players as `token.removed`, the same event as hiding (D-049).
- Question: Should a player client receive the same event whether a token was hidden or deleted?
- Options:
  - A) Yes, both are `token.removed` → effect on security: a player client cannot tell that a token was hidden rather than removed, so it cannot learn that hidden tokens exist.
  - B) Separate events (`token.hidden`, `token.deleted`) → effect on security: a player client learns which tokens are hidden but still on the scene.
- Recommendation: A, because the input requires that the player client not know hidden tokens exist, and B would tell it; can be deferred to FND-03.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-084 — Internal sequential keys beside UUIDs
- Surface: data
- Source: Raised by the seventh assumption review: `14-agent-playbook.md` §8: "Never expose sequential IDs because internal keys exist." (untagged); `03` §3 fixes UUIDs as identifiers.
- Question: May the database use internal sequential keys alongside the UUIDs, or must the UUIDs (sha256 for Image) be the only keys?
- Options:
  - A) UUIDs (sha256 for Image) are the only primary and foreign keys → effect on data: one identifier per entity everywhere; copying data between PCs needs no key remapping.
  - B) Internal integer keys may exist for joins, never exposed outside the server → effect on data: two identifiers per entity; moving data between PCs relies on the UUID column and a remapping step.
- Recommendation: A, because the input chose UUIDs precisely so data from another PC never collides, and a second key would reintroduce remapping; can be deferred to SRV-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-085 — What `/api/auth` tells a browser without a session
- Surface: security
- Source: Raised by the seventh assumption review: `02-architecture.md` §5: `/api/auth` offers "current role" without a DM session (D-048).
- Question: Should any browser be able to ask `/api/auth` whether it itself holds a DM session?
- Options:
  - A) Yes; the answer concerns only the calling browser and reveals nothing about other sessions → effect on security: one more unauthenticated read, which tells a browser only what its own cookie already implies.
  - B) No; the client probes a protected route and treats a refusal as "not signed in" → effect on security: the unauthenticated surface stays PIN entry, leave and setup; errors and state become harder to tell apart.
- Recommendation: A, because the answer tells a browser nothing it could not learn by trying a protected route; can be deferred to SRV-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-086 — Measurements on scenes that are not live
- Surface: security
- Source: Raised by the seventh input audit: `04-live-sync.md` §11: "A measurement made on a scene that is not live MUST NOT be sent to players." was tagged [input, Q-027]; Q-027 covers the live scene only and the input only implies the rest («Αλλαγές σε μη ενεργές σκηνές δεν στέλνονται πουθενά»).
- Question: Should measurements the DM makes on a scene that is not live stay in the DM view?
- Options:
  - A) Yes, they never leave the DM view → effect on security: nothing about a prepared scene (distances, positions) reaches the TV.
  - B) The TV shows every measurement, whatever scene it is made on → effect on security: measuring in prep mode would show lines from a scene the players have not seen.
- Recommendation: A, because prep mode must never reach the TV (Q-024).
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-087 — Ruler scale from the scene's feet per square
- Surface: scope
- Source: Raised by the seventh assumption review: `06-grid-and-measurement.md` §5: "Distances MUST scale with the scene's feet per square." (D-045)
- Question: Should the ruler multiply squares by each scene's feet per square, or always count 5 ft per square?
- Options:
  - A) Multiply by the scene's feet per square → effect on scope: the MVP ruler supports other scales (e.g. 10 ft or overland maps); feet per square is an editable scene field.
  - B) Always 5 ft per square → effect on scope: feet per square is stored but unused in the MVP; other scales become Future.
- Recommendation: A, because the input stores feet per square on every scene, which only matters if the ruler uses it; can be deferred to LIV-07.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-088 — Test art is generated, not third-party
- Surface: external
- Source: Raised by the seventh assumption review: `10-testing-acceptance.md` §3: "The large-scene fixture MUST be a generated 10,000 × 7,000 px map with 50 tokens" (D-036); the repository is public under AGPL-3.0 (Q-021, Q-066).
- Question: Should test maps and token images be generated by a script, or real third-party art committed to the repository?
- Options:
  - A) Generated by a script; no third-party art in the repository → effect on external: no licence or attribution obligations for test assets in the public repository.
  - B) Real battlemaps and tokens committed as fixtures → effect on external: each image's licence must allow redistribution under AGPL-3.0, with attribution tracked.
- Recommendation: A, because most battlemap licences forbid redistribution, and a public repository would redistribute them; can be deferred to REL-02.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-089 — Reordering by dragging in the sidebar
- Surface: ux
- Source: Raised by the seventh assumption review: `08-ux-journeys.md` §1: campaigns, sessions and scenes are reorderable from the sidebar (D-050: by dragging).
- Question: Should sessions and scenes be reordered by dragging them in the sidebar tree, or through buttons or a separate screen?
- Options:
  - A) Drag in the sidebar tree, with a keyboard alternative (move up/down) for `08` §8 → effect on ux: all structure management stays in the primary navigation.
  - B) Up/down buttons or a separate ordering dialog → effect on ux: a plain tree; ordering takes more clicks or another view.
- Recommendation: A, because the sidebar is where the DM already sees the order; can be deferred to PRP-01.
- Blocks: specification
- Answer: A (2026-09-23; recommendation accepted)

### Q-090 — Ordering campaigns in the sidebar
- Surface: data
- Source: Raised by SRV-03: `08-ux-journeys.md` §1 says campaigns, sessions and scenes are reorderable from the sidebar [input, Q-023, Q-089], but `03-domain-model.md` §1 gives Campaign no `order` field and §2 keeps an order only for sessions within a campaign and scenes within a session; D-050 and Q-089 name only sessions and scenes.
- Question: Should the DM be able to put campaigns in an order of their own in the sidebar, or are campaigns listed in a fixed order?
- Options:
  - A) Campaigns are listed by name, case-insensitively; `08` §1's "reorderable" is amended to sessions and scenes → effect on data: no schema change; the sidebar cannot put a favourite campaign first except by renaming it.
  - B) Campaigns get an `order` like sessions and scenes, reordered by dragging → effect on data: an additive migration adds `campaign.order` (unique, backfilled by name) and `03` §1 and §2 are amended; one more reorder route, `PUT /api/campaigns/order`.
- Recommendation: A, because one game runs per server and a DM rarely has more than a few campaigns; B stays open later as an additive migration. Can be deferred to PRP-01, which builds the sidebar; SRV-03 lists by name meanwhile.
- Blocks: specification
- Answer: A (2026-09-24; recommendation accepted)

### Q-091 — Remembering the token numbers already issued on a scene
- Surface: data
- Source: Raised by PRP-04: `05-assets-and-images.md` §3 says freed numbers are not reused [Q-063] and D-019 that the first token keeps the bare name until a second arrives, but `03-domain-model.md` §1 and migration 0001 store nothing that remembers the highest number issued, so after deleting "Goblin 4" the labels left (Goblin 1 to 3) would give "Goblin 4" again.
- Question: How should the server remember the highest token number issued per scene and asset, and what is a new token called after a lone bare-named one was deleted?
- Options:
  - A) An additive migration adds `scene.token_numbers`, a JSON object from asset id to the highest number issued; only the first token of an asset ever placed on a scene takes the bare name, later ones are numbered even when alone → effect on data: one column on Scene, still eight entities; `03` §1 and `05` §3 amended; no number, the highest included, is ever issued twice.
  - B) An additive migration adds a ninth table (scene_id, asset_id, last_number) with cascading keys → effect on data: relationally cleanest, but contradicts the locked "eight entities" bullet of `12` §1 and needs an ADR.
  - C) No schema change: the next number is the highest among the current labels plus one → effect on data: nothing stored; deleting the highest-numbered token lets its number return ("Goblin 4" deleted, the next is "Goblin 4"), contradicting Q-063, which would need a superseding card.
- Recommendation: A, because it keeps Q-063 strict with one additive column, touches no locked bullet, and a label never points at a different creature.
- Blocks: specification
- Answer: A (2026-09-25; recommendation accepted)

### Q-092 — Token numbering that would reveal a hidden token
- Surface: security
- Source: Raised by the PRP-04 security review, 2026-09-25: numbering counts hidden tokens (`05` §3, D-019, Q-091), so adding a hidden second Goblin to the live scene would rename the visible lone "Goblin" to "Goblin 1" on the TV, and `04` §4 forbids anything from which a hidden token's existence can be learnt.
- Question: How should numbering treat hidden tokens so that it never tells players a hidden token exists?
- Options:
  - A) Number hidden and visible tokens alike, but never rename a visible token when a hidden one is added on the live scene → effect on security: no rename leaks at the moment of adding; the rule differs between preparation and play, and a later reveal renames tokens.
  - B) A token placed hidden takes the bare name and no number; it is numbered when it is first shown to players (placed visible or revealed), and only then is a lone visible bare-named token renamed "<name> 1" → effect on security: numbering never depends on a hidden token; the DM cannot tell hidden tokens of one asset apart by number until they are revealed.
  - C) Keep one rule and accept the leak as an exception to `04` §4 → effect on security: the TV may show a rename that hints a hidden token was added.
  - D) Defer to LIV-02 → effect on security: PRP-04 numbers as now; LIV-02 decides before live play.
- Recommendation: A, because it keeps numbers on hidden tokens for the DM while nothing reaches the TV at the moment of adding.
- Blocks: specification
- Answer: B (2026-09-25)
