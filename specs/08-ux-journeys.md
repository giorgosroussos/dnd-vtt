# 08 — UX and Journeys

How the DM prepares and runs a session, what the TV shows, and how screens get connected.

## 1. DM workspace

- The DM view MUST be one workspace: a left sidebar with the Campaign → Session → Scene tree, the scene canvas in the centre, the asset library as a right-hand panel, and a live bar at the top that names the live scene. [Q-023]
- Campaigns, sessions and scenes MUST be creatable, renamable, reorderable and deletable from the sidebar; reordering is by dragging in the tree, with a keyboard alternative. [input, Q-023, Q-089]

## 2. Live mode and prep mode

- The canvas MUST show one scene at a time: the live scene in live mode, any other scene in prep mode. [Q-024]
- Live mode MUST be unmistakable (a persistent live indicator around the canvas), and every action in it reaches the TV; nothing done in prep mode reaches the TV. [Q-024]
- The live bar MUST return the canvas to the live scene in one click. [Q-024]
- "Go live" on the scene being edited MUST activate it, and a "Blank TV" action MUST clear the live scene (`04` §2). [Q-024, Q-025]
- In live mode the DM view MUST show the frame of what the TV sees, which the DM can move and resize to steer the player camera (`04` §9). [input, Q-080]

## 3. Canvas

- Both views MUST show the scene's map as a background image with zoom and pan. [input]
- The DM view MUST support drag to move tokens, Ctrl+Z to undo on the live scene (`04` §8), and the add-token flow of `05` §5. [input]

## 4. Player view

- When no scene is live, the player view MUST show a dark idle screen with the product name only. [Q-025]
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
