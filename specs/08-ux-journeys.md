# 08 — UX and Journeys

How the DM prepares and runs a session, what the TV shows, and how screens get connected.

## 1. DM workspace

- The DM view MUST be one workspace: a header that names the campaign and session and says what the TV shows, a left sidebar listing the current session's scenes, collapsible (§14), the scene canvas in the centre, and a right-hand panel whose tabs are the live scene's tokens and the asset library (§11). [Q-023, Q-100, Q-121]
- The Campaign → Session → Scene tree MUST be reachable from the header's session switcher, where campaigns and sessions are created, renamed, deleted and reordered. [Q-100]
- Campaigns, sessions and scenes MUST be creatable, renamable and deletable; sessions MUST be reorderable by dragging in the tree and scenes by dragging in the scene list, each with a keyboard alternative, while campaigns are listed by name. [input, Q-023, Q-089, Q-090, Q-100]

## 2. Live mode and prep mode

- The canvas MUST show one scene at a time: the live scene in live mode, any other scene in prep mode. [Q-024]
- Live mode MUST be unmistakable (a persistent live indicator around the canvas), and every action in it reaches the TV; nothing done in prep mode reaches the TV. [Q-024]
- The header's live indicator MUST return the canvas to the live scene in one click. [Q-024, Q-100]
- "Go live" on the scene being edited MUST activate it, and a "Go idle" action MUST clear the live scene (`04` §2). [Q-024, Q-025, Q-100]
- In live mode the DM view MUST show the frame of what the TV sees, which the DM can move and resize to steer the player camera (`04` §9). [input, Q-080]

## 3. Canvas

- Both views MUST show the scene's map as a background image with zoom and pan. [input]
- The DM view MUST support drag to move tokens, Ctrl+Z to undo on the live scene (`04` §8), and the add-token flow of `05` §5. [input]
- The DM view MUST support selecting several tokens and acting on them together (§14). [Q-122]

## 4. Player view

- When no scene is live, the player view MUST show a dark idle screen with the product name and the line "The table is set. Waiting for the Dungeon Master.", and nothing else. [Q-025, Q-100]
- When a scene goes live the player view MUST switch to it, fitted to the map (`04` §9). [input, Q-038]

## 5. Connecting a screen

- The server MUST find its LAN address and show a QR code. [input]
- The QR code and a short URL to type MUST be shown in the server console at start and in a "Connect a screen" panel of the DM view, and MUST open the player view; the DM view's address MUST NOT be put in a QR code. [Q-026]
- All non-internal IPv4 addresses MUST be listed, each with the name of its network adapter. The one shown prominently, which the QR code encodes, MUST be chosen with no step by the DM: addresses of adapters named as virtual ones (WSL, Hyper-V, VMware, VirtualBox, Docker, VPNs and the like) come after the others, and within each group a private-range address comes first. [Q-110]
- As an emergency correction for a PC where that ranking guesses wrong, the DM MUST be able to choose in Settings, from the detected addresses with their adapter names, the TV address the panel, the QR code and the console use; Automatic, the ranking above, is the default. A chosen address the PC no longer has MUST fall back to the automatic one, and the panel and the console MUST say so. [Q-110]
- On Windows the first start triggers a firewall prompt; the console and README MUST tell the DM to allow private networks only (`09` §4). [input, Q-076]

## 6. Language

- The UI MUST be in English, with every UI string in one message catalogue so that a translation can be added without code changes. [Q-028]

## 7. Devices

- The DM view MUST support laptop and desktop browsers with mouse and keyboard; touch devices are not supported in the MVP. [Q-029]
- The player view MUST also lay out on phones and tablets, portrait or landscape, and on large desktop screens, and MUST take touch on a device whose primary pointer is coarse and cannot hover (§14); the DM view stays mouse and keyboard. [Q-125]
- The player view MUST work on the acceptance browsers and TV of `10` §4. [Q-019, recommendation accepted]

## 8. Accessibility

- There is no formal accessibility target; core DM actions MUST be operable by keyboard and text MUST keep readable contrast. [Q-030]

## 9. Presentation details

- A hidden token is drawn semi-transparent with a hidden marker in the DM view; the player view has no controls and hides the cursor after two seconds. [Q-054] On a touch device without hover, and only there, the player view MAY show the fullscreen and reset buttons of §14. [Q-125]

## 10. Critical journeys

The critical journeys MUST be these five: [Q-065]

| Journey | Steps | Specs |
| --- | --- | --- |
| First run | start server → set PIN on the server PC → open `/dm` | `09` §2, `07` §1 |
| Prepare | create campaign → session → scene from a map → calibrate → add tokens, hide some | `03`, `06` §1, `05` §5 |
| Connect TV | "Connect a screen" → type URL on the TV → idle screen | §5, §4 |
| Run | Go live → move, reveal, measure, steer the TV camera → prep the next scene → Go live on it | §2, `04` |
| Recover | TV or laptop sleeps → reconnects → same state | `04` §6 |

## 11. The 2026-09-30 redesign

The DM view MUST provide, in the palette and typography of the redesign (`01` §9): [input, Q-100]

- a header with the logo and wordmark, the campaign / session breadcrumb opening the session switcher, a live indicator reading "Players see {scene}" with Go idle, or an idle state with Go live, a counter of connected player views (0 in a warning colour) that opens "Connect a screen", and a settings button;
- a left sidebar with the session's title and scene count, a button to add a scene, and each scene's thumbnail, name and token summary; the live scene marked "On the TV", every other scene with a button that puts it on the TV; and a "Next up" footer naming the scene after the live one with Go live (Shift+N);
- above the canvas the scene's name and, on the live scene, the TV camera controls: Send my view, Fit map, TV zoom out and in, and Lock TV camera, which while on disables them and the TV frame;
- on the canvas a tool rail (Select V, Ruler M, Ping P, Fog brush F, Add token T, Undo, Redo), the grid and diagonal rule in use bottom left, the DM's zoom bottom right, and a shortcut bar below;
- the frame of what the TV shows in the accent colour, the map outside it dimmed (§2);
- a popover on the selected token with its name and visibility, Hide or Reveal (H), Rename, and a menu with Delete, Duplicate and stacking;
- the popover opened by a click on the token, by its row in the right panel, or by placing or duplicating it; a press that moves about 4 px is a drag, which closes the popover, leaving it closed after the drop with the token still selected, and Escape, a click on empty map and the start of a pan close it too; a second click on the token whose popover is open closes it, the token still selected; [Q-102, Q-126]
- in the right panel the live scene's tokens grouped by category, each with its visibility toggle; a row selects and centres its token;
- tokens drawn as circles ringed by category, a hidden one with a dashed ring, a lighter fill, a crossed-eye badge and an italic label, so it is never taken for a visible one (§9);
- no shortcut acting while a text field has focus.

The table tools (`01` §9) MUST add to it: [input, Q-099]

- Ping (P) on the live scene: a click, or Enter at the centre of the view, shows two expanding rings with a glowing centre at that point on every view for about two seconds (`04` §12);
- the popover's condition chips, Bloodied, Unconscious, Dead, Concentrating, Prone and Poisoned, each a toggle, then a chip for each other condition the token carries, and More… opening a searchable alphabetical list of the others; Exhaustion's chip with a stepper from 1 to 6; each chip's hover text its rule text; each marker drawn on both views as a badge with an icon of its own, never by colour alone, at most three then "+N", Dead first, then Unconscious, Bloodied and the rest as applied; Dead greying the token and striking its label, Invisible drawing it semi-transparent on both views (`03` §1); [Q-103]
- About & credits in the header, crediting the condition icons and the SRD 5.1 text; [Q-103]
- the fog brush (F): a round brush that paints fog by a drag and an eraser that reveals it (E switches them), its radius on a slider from a quarter square to five ([ and ] step it), Fog all and Clear all, each asked first, and Enter painting at the centre of the view; the fog shown to the DM as a blue hatch, and to players as an opaque mask with a soft edge; in the right panel how many tokens under the fog players cannot see (`04` §13). [Q-101]

The player view MUST show the live scene with a subtle vignette, labels sized to be read from 2–3 m, and the scene's name at the bottom left, fading after a few seconds; changes between idle and live, and between scenes, fade. [input, Q-100]

## 12. Initiative

The DM view MUST add, on the live scene (`04` §14): [Q-111]

- an Initiative tab in the right panel, its header showing the round while combat runs, and Start combat while it does not;
- one row per entry in turn order, each with a drag handle, the token's avatar, its name and an optional initiative number field, the number typed or stepped by the mouse wheel over the field, an empty one starting at 10 [Q-127]; typing a number sorts the rows, a drag sets the order and stands until a number is typed again, and Move up and Move down do what a drag does from the keyboard;
- the entry whose turn it is highlighted, and the next one marked; on each entry's turn its token ringed on the map and the DM's camera centred on it; an entry passed over (`04` §14) shown dimmed; [Q-111, Q-118]
- Next turn (Enter) and Previous turn (Shift+Enter), the round counted when the turn passes the last entry; neither acting while a field, a button or a dialog has focus;
- when Next finds no monster or npc entry that can take its turn, once the encounter has had one, "No enemies left. End combat?" with End combat and Continue; [Q-111, Q-118]
- an offer to add the tokens that players can now see and that have no entry, player characters, or monsters or npcs not carrying Dead: one offer for all of them, a fog region revealing four goblins included ("Add {name} to initiative?" for one), each with an optional initiative number, with Add all and Skip; an entry with a number goes in by it (`04` §14), one without at the end of the order, and Skip adds none; [Q-111, Q-117, D-183]
- while combat runs, Add to initiative in the popover of a player character, monster or npc without an entry, saying why when players cannot see it or it carries Dead; a remove action on each row, and Remove dead beside the round, removing every Dead monster's and npc's entry; [Q-111, Q-118, D-183]
- End combat asked first, saying that it cannot be undone once another scene goes live or the server restarts.

While combat runs, the player view MUST show a strip along its top edge, readable from 2–3 m and no taller than it must be: two cards only, the entry whose turn it is and the next one, each when players can see its token, player characters and enemies alike, with its portrait and its token's label as the map shows it ("Bandit 1"), a Dead one greyed, the turn's card highlighted, the next one marked, and the round at one end; both replaced on every turn; it shows no entry players cannot see, and fades in and out as scene changes do. [Q-111, Q-118, Q-127]

## 13. The DM toolkit

The DM view MUST add (`01` §10): [Q-112, Q-113, Q-114, Q-115]

- a token's hit points, current, maximum and temporary, and its armour class, each optional, read and set wherever the token is edited, on every scene, and on the live scene damage or healing applied by an amount (`04` §15); none of it ever drawn on the player view; [Q-112]
- an asset's default maximum hit points and armour class in the asset's editor (`03` §9); [Q-112]
- Follow my view among the TV camera controls of the live scene (§11), a toggle whose state is plain to see, off whenever another TV camera control is used or the TV camera is locked (`04` §9); [Q-113]
- the scene's notes, and a token's notes with its asset's notes beside them, read-only, each readable and editable on every scene (`03` §10); [Q-114]
- Export of a campaign and of library assets, the selected ones or all, and Import of either, an import saying what it added and what it reused, or why it was refused (`09` §9). [Q-115]

## 14. The UI/UX refinements

The DM view MUST add (`01` §11): [Q-121, Q-122, Q-123, Q-124, Q-126, D-189]

- the scene sidebar collapsed by default to a strip at the left edge; the pointer near that edge, or its toggle, opens it over the map without resizing the map, and leaving it closes it; it stays open while it holds the focus, Escape closes it, and a pin docks it in its column, remembered by the browser; [Q-121]
- Ctrl (Cmd on macOS) and a click adding a token to the selection or removing it, on the map and in the token list; a plain click selecting that token alone; a drag of a selected token moving the group with its offsets kept, the arrow keys nudging the group, Escape clearing it; [Q-122]
- with two or more tokens selected, a bar naming how many, with Hide or Reveal (H; Hide unless all are hidden), a condition toggled on all (removed when all carry it, added otherwise), one amount of damage or healing applied to each, Delete asked once for the group, and Clear; on the live scene each action one `token.batch`, one undo step (`04` §2, `04` §8); [Q-122, Q-123]
- an asset of the Library tab dragged onto the map placed where it is dropped (`05` §5), its footprint shown under the pointer, and the picker's rows laying out the thumbnail, the name and the Choose button on one line; [Q-124]
- in the session switcher, each row's actions as icons whose names show as tooltips on hover and on keyboard focus, and New campaign and Import side by side; [D-189]
- the mouse resting on a token for about half a second, while tokens can be selected, showing beside it a read-only preview with its name, whether players can see it, its hit points and armour class, its conditions and the first lines of its notes, or of its asset's when it has none; a pointer passing over a token, a touch, a held button or the token whose popover is open showing none; leaving the token, pressing it, zooming or another tool hiding it at once; the preview taking neither the pointer nor the focus, and never drawn on the player view. [Q-126]

The player view MUST, on a touch device whose primary pointer is coarse and cannot hover: [Q-125]

- show a fullscreen button when the browser can put the page in fullscreen, fading after a few seconds without a touch;
- zoom by a pinch between the whole map and eight times the DM's camera, and pan by a drag, on that screen only, sending nothing;
- return to the DM's camera on a button shown while zoomed, on a double tap and whenever a scene goes live;
- not report its size, so that the TV frame keeps the TV's shape (`04` §9).

The DM's camera is such a screen's starting view, not its limit: it holds only what the server sends every player screen (`04` §4). On every other screen the player view keeps no controls (§9). [Q-125]

