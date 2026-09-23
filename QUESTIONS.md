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

## Blocking

None. Phase 0 can proceed.

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
