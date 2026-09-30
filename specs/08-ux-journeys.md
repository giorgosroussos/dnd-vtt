# 08 — UX and Journeys

How the DM prepares and runs a session, what the TV shows, and how screens get connected.

## 1. DM workspace

- The DM view MUST be one workspace: a header that names the campaign and session and says what the TV shows, a left sidebar listing the current session's scenes, the scene canvas in the centre, and a right-hand panel whose tabs are the live scene's tokens and the asset library (§11). [Q-023, Q-100]
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

## 4. Player view

- When no scene is live, the player view MUST show a dark idle screen with the product name and the line "The table is set. Waiting for the Dungeon Master.", and nothing else. [Q-025, Q-100]
- When a scene goes live the player view MUST switch to it, fitted to the map (`04` §9). [input, Q-038]

## 5. Connecting a screen

- The server MUST find its LAN address and show a QR code. [input]
- The QR code and a short URL to type MUST be shown in the server console at start and in a "Connect a screen" panel of the DM view, and MUST open the player view; the DM view's address MUST NOT be put in a QR code. [Q-026]
- All non-internal IPv4 addresses MUST be listed, the first private-range one shown prominently. [Q-053]
- On Windows the first start triggers a firewall prompt; the console and README MUST tell the DM to allow private networks only (`09` §4). [input, Q-076]

## 6. Language

- The UI MUST be in English, with every UI string in one message catalogue so that a translation can be added without code changes. [Q-028]

## 7. Devices

- The DM view MUST support laptop and desktop browsers with mouse and keyboard; touch devices are not supported in the MVP. [Q-029]
- The player view MUST work on the acceptance browsers and TV of `10` §4. [Q-019, recommendation accepted]

## 8. Accessibility

- There is no formal accessibility target; core DM actions MUST be operable by keyboard and text MUST keep readable contrast. [Q-030]

## 9. Presentation details

- A hidden token is drawn semi-transparent with a hidden marker in the DM view; the player view has no controls and hides the cursor after two seconds. [Q-054]

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
- on the canvas a tool rail (Select V, Ruler M, Ping P, Fog regions F, Add token T, Undo, Redo), the grid and diagonal rule in use bottom left, the DM's zoom bottom right, and a shortcut bar below;
- the frame of what the TV shows in the accent colour, the map outside it dimmed (§2);
- a popover on the selected token with its name and visibility, Hide or Reveal (H), Rename, and a menu with Delete, Duplicate and stacking;
- in the right panel the live scene's tokens grouped by category, each with its visibility toggle; a row selects and centres its token;
- tokens drawn as circles ringed by category, a hidden one with a dashed ring, a lighter fill, a crossed-eye badge and an italic label, so it is never taken for a visible one (§9);
- no shortcut acting while a text field has focus.

The player view MUST show the live scene with a subtle vignette, labels sized to be read from 2–3 m, and the scene's name at the bottom left, fading after a few seconds; changes between idle and live, and between scenes, fade. [input, Q-100]
