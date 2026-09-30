# Task: Implement the Emberglass UI redesign

You are working on **Emberglass**, a self-hosted virtual tabletop for in-person D&D 5e (2014 rules). A Node server runs on the DM's PC and serves a React app over the LAN. The DM runs the game from a laptop (**DM view**) while the players watch a TV or projector (**Player view**). The MVP is functionally close to done. This task replaces its UI with the attached design and then adds three features that come right after the MVP.

Read the existing codebase before changing anything. Keep the current architecture, data model, sync model and map rendering approach (canvas library or DOM). **This task is a re-skin plus specific additions, not a rewrite.**

## The design file

`Design.html` is a self-contained bundle. Open it in a browser to see three boards:

1. **Live DM view**, 1440×900
2. **Player view · live (TV)**, 1920×1080
3. **Player view · idle (TV)**, 1920×1080

The PNG screenshots with the same names are a quick reference. The HTML is the source of truth for exact values. The map in the design is an SVG placeholder. In the app, it is the uploaded map image.

The boards use fixed pixel sizes. Implement a fluid layout: side panels keep their width, and the map area fills the rest. The player view must fill any screen size, down to a 1280×720 TV.

## Design tokens

Define these once, as CSS variables or a theme module. Don't scatter hex values through components.

| Token | Value | Use |
| --- | --- | --- |
| bg-app | `#13100D` | DM view background |
| bg-panel | `#1A1612` | Header, sidebars |
| bg-raised | `#1F1A15` / `#221D18` | Popovers, buttons |
| bg-hover | `#2C251F` | Hover state |
| bg-selected | `#26201A` + inset `#4A3F34` | Selected scene or list row |
| border | `#2E2720` / `#3A3129` | Dividers / controls |
| text | `#EDE3CF` | Primary text |
| text-muted | `#C9BBA4` / `#A89A85` | Secondary text / captions |
| accent (ember) | `#E8913A`, hover `#F2A04E` | Primary actions, TV frame, active tool |
| live | `#F2826B` on `rgba(224,83,61,.1)` | LIVE badge, "on the TV" |
| hidden (DM only) | `#8FB3D9`, text `#BFD2E6` | Hidden tokens, fog regions |
| connected | `#7FC98E` | Screen connected dot |
| player bg | `#0A0806` | Player view background and fog |
| token PC ring | `#F0CD86` on `#2a2119` | Player characters |
| token monster ring | `#E0533D` on `#2a1712` | Monsters |
| bloodied | `#C8402C` | Condition badge and pulse |
| concentrating | `#C7AEF5` dotted ring | Condition |
| ping | `#FFB35C` | Ping rings |

**Typography:** Alegreya 500/700 for titles and the wordmark, Alegreya Sans 400/500/700 for UI, IBM Plex Mono 500 for `kbd`. **The app must work offline on a LAN, so self-host the fonts** (e.g. `@fontsource/*` packages). Never load them from Google Fonts. Include the **Greek** subsets for Alegreya and Alegreya Sans, because campaign, scene and token names may be in Greek.

## Part A: Re-skin the existing MVP screens

### DM view layout (see board 1)

- **Header (56px):** logo and wordmark. Campaign / session breadcrumb with a dropdown to switch session. A centered **LIVE pill**: "Players see **{scene}**", with a pulsing dot and a **Go idle** button. A **screens counter** (e.g. "1 screen") with a green dot. A settings button.
  - When nothing is live, the pill switches to an idle state with a **Go live** action.
  - The screens counter is the number of connected player-view clients. The server already knows them through the players room, so expose that count. Show 0 in a warning color.
- **Left sidebar (256px):** session title and scene count, a "+" to add a scene, and the scene list with thumbnail, name and token summary ("5 tokens · 4 hidden").
  - The live scene shows an **ON THE TV** badge.
  - Other scenes have a "put on the TV" button.
  - Scenes can be reordered by dragging.
  - A **NEXT UP** footer shows the next scene in order with **Go live** (`Shift+N`).
- **Map area:**
  - A title row with the scene name and **TV CAMERA** controls: Send my view, Fit map, TV zoom − / +, Lock TV camera.
  - The map canvas with a floating vertical **tool rail**: Select `V`, Ruler `M`, Ping `P`, Fog regions `F`, Add token `T`, then Undo / Redo.
  - Bottom-left: grid status ("Grid 5 ft · Diagonals …"). Bottom-right: DM zoom controls and a fit button.
  - A shortcut bar along the bottom edge.
- **The "What the TV shows" frame** is an ember rectangle over the map that marks the players' camera, with the outside dimmed. The DM's own camera moves freely. The TV only moves on Send my view / Fit map / TV zoom, or when the DM drags or resizes this frame. This follows the spec: independent cameras, controlled by the DM.
- **Token popover** (on selecting a token): name, visibility line ("Players can see it" / hidden), Hide/Reveal (`H`), Rename, a "…" menu (delete, duplicate, bring to front), and the CONDITION chips (Part B).
- **Right sidebar (≈320px):** tabs **In this scene** / **Library**.
  - *In this scene* groups tokens into **PARTY** (PCs), **MONSTERS** (with Reveal all) and **FOG REGIONS** (Part B). Each row has an avatar, a name, a status line and an eye toggle.
  - Hidden rows use italics, a dashed avatar ring and a crossed-eye icon.
  - Clicking a row selects and centers that token.
  - *Library* is the existing asset library, restyled with the same tokens. The design doesn't draw it, so follow the visual language of the other panels.

### Token visuals (DM view)

- Circle with initials (or the asset image when there is one), plus a name label below on a dark pill.
- **Visible:** solid ring, colored by category (PC gold, monster red, NPC/object: choose a neutral from the palette).
- **Hidden:** dashed `#8FB3D9` ring, 60% opacity fill, a small crossed-eye badge, and an italic blue label. Hidden tokens must never be mistaken for visible ones.
- Token sizes follow the grid (Large = 2×2, etc.), as already implemented.

### Player view (boards 2 and 3)

- **Live:** only the map, tokens, fog, pings and a small scene-name plate at bottom-left (it can fade after a few seconds). No other UI. Add a subtle vignette.
  - Tokens and labels are scaled for reading at 2–3 m.
  - Hidden tokens are **not sent** to players, as today. Keep the server-side filtering.
  - Show the grid overlay only when the scene's grid is set to visible for players.
- **Idle:** shown when no scene is live ("Go idle"). The Emberglass wordmark with the slow ember glow and the line "The table is set. Waiting for the Dungeon Master."
- Transitions between idle and live, and between scenes, should be a short fade.

## Part B: Post-MVP features shown in the design

Implement these after Part A, in separate commits. Behaviour is defined in the project spec (section "Μετά το MVP: ping, δείκτες, fog of war"). Summary:

1. **Ping (`P`)**
   - The DM clicks the map, and every view shows two expanding ember rings with a glowing center at that point (see the `pingring` keyframes).
   - WebSocket event `ping` with the position **in grid units**. It is not persisted and fades after about 2 s.
2. **Condition markers**
   - A fixed set: Bloodied, Unconscious, Dead, Concentrating. Toggled from the popover chips. Visible to everyone, players included.
   - Stored as a `markers` field on Token, sent through the normal command/event flow, and supported by undo.
   - Visuals: **Bloodied** = red ring pulse plus a blood-drop badge. **Concentrating** = dotted purple outer ring.
   - The design doesn't draw **Unconscious** and **Dead**. Suggested: Unconscious = desaturated token with a "z" badge. Dead = greyed token with a skull or ✕ badge, label struck through. Every marker needs a badge or shape, not color alone.
3. **Manual fog of war (`F`)**
   - A new `Region` entity: `scene_id`, `name`, `shape` (rectangle or polygon, **in grid units**, snapping to grid corners), `hidden`.
   - The DM draws regions in the fog tool, names them, and toggles **Reveal / Fog** from the right panel or on the map. The DM sees fogged regions as a dashed blue outline with diagonal hatching and a label ("Back room · fogged").
   - Players see opaque `#0A0806` over fogged regions with a soft edge.
   - **The fog is a client-side mask.** This is a deliberate decision: the table is trusted. Do not render fogged map pixels server-side.
   - **Tokens:** the server filters them for players with the rule *visible = not hidden AND not inside a fogged region* (test the token's center point). Revealing a region therefore sends `token.added` for the tokens inside it.
   - The region list shows each region's status and the number of hidden tokens inside it.

## Decisions to respect, and gaps in the design

- **Diagonal rule:** the design's status bar reads "Diagonals 5/10". The spec default is the **PHB rule (every diagonal = 5 ft)**, with the DMG 5/10 rule as a setting. The status bar shows whichever rule is active, and the default stays PHB.
- **Redo:** the design adds Redo next to Undo. Implement it as a redo stack that is cleared by any new command.
- **Lock TV camera:** this is my interpretation, so confirm it with me if it's unclear. While locked, the TV camera controls and the frame are disabled, so the DM can't move the players' view by accident.
- **Sample data:** "Campaine Test" and the scene or token names are placeholders.
- **Don't invent features** beyond this prompt. If the design implies behaviour that isn't described here, ask me before building it.

## Accessibility and quality

- Every icon button has an `aria-label` (the design already names them) and a visible focus ring.
- All shortcuts in the shortcut bar work, and none fire while typing in an input.
- Text contrast meets WCAG AA against its background.
- Test the player view in a real TV browser or at 1280×720 with 2.5× zoom. Labels must be readable.

## Done when

- Part A: every existing MVP flow still works (prep, calibration, library, live play, reconnect, undo), now in the new UI. Existing tests pass, and screenshots of the three screens match the boards.
- Part B: ping, condition markers and fog regions work end-to-end across DM and player views, survive a reconnect (snapshot), and have tests for the fog visibility rule and the new commands.
- Commit Part A and each Part B feature separately, with a short summary of any deviation from the design.
