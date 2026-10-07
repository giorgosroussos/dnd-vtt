# 01 — Product Scope

What Emberglass is for, who uses it, and what each release contains.

## 1. Vision and definition of done

- The MVP is done when the DM can prepare a session in advance and run it on a TV or projector, operating everything alone. [input]
- Use context: in-person play at one table of up to about eight people, all on the same Wi-Fi network. [input]
- Motivation: a free, self-hosted alternative to virtual tabletops with limited free plans. [input]
- Differentiator: a session is a series of scenes the DM prepares in advance, with pre-placed and hidden tokens. [input]
- Rules baseline: D&D 5e, 2014 edition (SRD 5.1); every campaign carries `rules_version = 5e-2014` (`03` §8). [input]
- The MVP MUST NOT put game rules in code. [input]
- The input itself specifies the token size table (`05` §2) and the ruler's diagonal rules (`06` §5). [input]
- The hit-point automation of the DM toolkit (§10, `04` §15) MUST be the only other game rule in code: Bloodied, Dead and Unconscious set from a token's hit points, temporary hit points taking damage first. [Q-112]
- One server hosts one game at a time; Settings hold a single live scene (`03` §1). [input]

## 2. Actors

The actors MUST be exactly these: [input, Q-007, Q-010, Q-029, Q-125]

| Actor | Device | Access | Can |
| --- | --- | --- | --- |
| DM | laptop or desktop browser (`08` §7) | DM view, after the PIN (`07` §1) | prepare everything, run the live scene |
| Player screen | TV or projector browser, or since Phase 8 a phone or tablet (§11) | player view, no credential (`07` §3) | display the visible state of the live scene |
| Players | none in the MVP | — | look at the player screen |

- The MVP MUST NOT provide player devices, player accounts or per-player views. [input]
- Since Phase 8 a phone or tablet MAY open the read-only player view as one more player screen (§11); it sends no command and is no player device in the sense above: no account, no per-player view and no part in the game. [Q-125]
- Any browser on the LAN MAY open the player view; it is read-only. [Q-010, recommendation accepted]

## 3. MVP capabilities

The MVP MUST provide: [input]

- a local Node server serving the React client and the WebSocket (`02` §2);
- SQLite storage and an images folder (`02` §7);
- joining from the LAN with a QR code (`08` §5);
- a PIN protecting the DM view (`07` §1);
- automatic reconnection with snapshot and versioning (`04` §5, `04` §6);
- Campaign → Sessions → Scenes (`03` §1);
- a background map image with zoom and pan (`08` §3);
- grid calibration with three methods (`06` §1);
- a shared asset library with tags and search (`05` §1);
- tokens with drag, snap-to-grid and automatic numbering (`05` §3, `06` §4);
- hidden tokens filtered on the server (`04` §4);
- a ruler with the PHB 2014 diagonal rule and the optional DMG rule as a setting (`06` §5);
- independent DM and player cameras, with the live scene separate from the scene being edited (`04` §9, `08` §2);
- duplicating a scene (`03` §7);
- undo for the DM on the live scene (`04` §8);
- upload limits on file types and size (`05` §6).

The MVP MUST also provide deleting a token on the live scene (`04` §2). [Q-014, recommendation accepted]

The MVP MUST also allow editing the live scene's setup while it is live (`04` §10). [Q-015, recommendation accepted]

## 4. Phase 2 (Future)

Phase 2 MUST NOT be implemented in the MVP; it covers: [input]

- characters with a join link or QR code per character;
- permissions: each player moves only their own token;
- a mobile UI, beyond the read-only player view on phones and tablets of §11; [Q-125]
- an initiative tracker;
- HP and conditions on tokens;
- fog of war;
- DM notes per scene;
- handouts;
- character sheets with computed derived values and manual override;
- data-driven rules in JSON, importing SRD 5.1;
- campaign export and import as a zip.

Manual fog painted by the DM, condition markers on tokens and the initiative tracker (`13` §10) MUST be built after the MVP's features, before the release (§9); hit points, per-enemy initiative and DM notes per scene are built in the DM toolkit (§10); automatic fog, DM-defined markers, condition durations and dice stay Phase 2. [Q-099, Q-101, Q-103, Q-111, Q-112, Q-114]

Campaign export and import as a zip is built in the DM toolkit (§10), beside copying the whole data folder, which stays the backup (`09` §5). [Q-115]

## 5. Phase 3 (Future)

Phase 3 MUST NOT be implemented in the MVP; it covers: [input]

- guided level-up from SRD data;
- a personal screen per player with hidden messages;
- packaging as a Tauri or Electron desktop app, without changing the architecture; the Windows package of `09` §1, which opens the DM view in the browser, is built before the release instead. [input, Q-107]

## 6. Nice-to-have (Future, unscheduled)

These MUST NOT be implemented in the MVP: [input]

- the 2024 rules as a second data set;
- homebrew classes, spells and items;
- an AI assistant for the DM;
- automatic grid detection;
- physical screen scale for miniatures (1 square = 25 mm);
- a live drag preview with throttling.

Adding tokens by dragging them from a sidebar comes later (the input says «αργότερα» without naming a phase); the MVP flow is button, picker, click on the map (`05` §5). [input] The drag from the library arrives in Phase 8 (§11). [Q-124]

Area-of-effect templates are a nice-to-have and MUST NOT be implemented; the ping moved to §9. [Q-099]

## 7. Out of scope

Emberglass MUST NOT implement: [input]

- custom map creation;
- remote play;
- a full effects engine;
- dynamic lighting;
- hex grids.

## 8. Name, licence and distribution

- The public product name is Emberglass. [Q-022]
- The product name, UI title and package names MUST NOT contain "D&D" or "Dungeons & Dragons"; the product MAY describe itself as compatible with 5th edition (SRD 5.1). [Q-022]
- The source is licensed under AGPL-3.0, with the licence text at the repository root. [Q-021]
- The MVP is installed from source (`09` §1). [Q-017, recommendation accepted]
- Before the release, a Windows x64 installer and a portable zip carrying their own Node runtime are built from a version tag and attached to a GitHub Release, beside installation from source; the package is unsigned, and the README gives the SmartScreen steps and each file's SHA-256 (`09` §1). [Q-107, Q-109, recommendation accepted]
- SRD 5.1 content (CC-BY-4.0) enters from Phase 2 on, except the conditions' rule text, shown with the condition markers before the release (§9) and credited in the DM view's About & credits. [input, Q-103]

## 9. After the MVP, before the release

After the MVP's features and before the owner's TV run (`10` §4), Emberglass MUST add: [Q-099, Q-101, Q-103, Q-111]

- a ping the DM places on the live scene, shown on every view (`13` §10);
- eighteen condition markers on tokens, shown on every view: Bloodied, Unconscious, Dead, Concentrating, Prone and Poisoned pinned, and Blinded, Charmed, Deafened, Exhaustion with its level, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Restrained and Stunned in a searchable list, each with its rule text and none applied by another (`13` §10); [Q-103]
- manual fog the DM paints with a brush and reveals with an eraser, with tokens under the fog filtered for players (`13` §10);
- an initiative tracker: one encounter per scene holding one entry per player character and, since the DM toolkit, one per visible monster or npc, ordered by the numbers the table rolled with physical dice or by dragging, its turns and rounds advanced by the DM, shown in the DM view and as a strip along the top of the TV that names only tokens players can see, by their labels (`04` §14, `08` §12, `13` §10). [Q-111]

The DM view and the player view MUST follow the 2026-09-30 redesign: palette, typography, layout, token visuals and the DM's controls of `08` §11. [input, Q-100]

## 10. The DM toolkit

After the Windows package (`13` §11), Emberglass MUST add: [Q-111, Q-112, Q-113, Q-114, Q-115]

- hit points and armour class on every token, optional and seen only by the DM, with defaults on the asset and Bloodied, Dead and Unconscious set from them (`03` §9, `04` §15, `08` §13); [Q-112, Q-116]
- an initiative entry per visible monster or npc in place of the one Enemies entry, each shown on the TV by its token's label (§9, `04` §14); [Q-111, Q-117, Q-118]
- Follow my view, which keeps the TV camera on the DM's view of the live scene (`04` §9, `08` §13); [Q-113]
- DM notes per scene and per token, seen only by the DM (`03` §10, `04` §16); [Q-114]
- export of a campaign or of library assets as a zip, and its import on any Emberglass (`09` §9, `07` §9). [Q-115, Q-119]

## 11. The UI/UX refinements

After the DM toolkit (`13` §12), Emberglass MUST add: [Q-121, Q-122, Q-123, Q-124, Q-125, Q-126, Q-127, Q-128, D-189]

- a scene sidebar that collapses to the edge of the DM view and opens on hover (`08` §1, `08` §14); [Q-121]
- several tokens selected at once, moved, hidden or revealed, marked, damaged or healed and deleted together, one undo step on the live scene (`04` §2, `04` §8, `08` §14); [Q-122, Q-123]
- a token added by dragging an asset from the library onto the map, beside the picker (`05` §5); [Q-124]
- the campaigns menu's actions as icons with their names as tooltips (`08` §14); [D-189]
- a second click on a token closing its popover, and the mouse resting on a token showing a read-only preview of it in the DM view (`08` §11, `08` §14); [Q-126]
- the initiative order making room for a row as it is dragged, its numbers stepped by the mouse wheel, and the TV's strip naming only the turn and the next (`08` §12); [Q-127]
- map notes: the DM's notes pinned at a point of a scene's map, each a small icon on the DM's map only, read and edited by a click, previewed on hover, moved by a drag, on any scene, exported with their campaign (`03` §1, `04` §16, `08` §14, `09` §9); [Q-128]
- the read-only player view laid out for phones, tablets and large screens, with fullscreen and the screen's own pinch zoom on touch devices (`08` §7, `08` §9, `08` §14). [Q-125]
