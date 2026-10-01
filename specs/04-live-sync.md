# 04 — Live Sync

The WebSocket contract for the live scene: who sends what, what each room receives, and how clients stay in step.

## 1. Principles

- The WebSocket MUST carry only the live scene; everything else is REST (`02` §4). [input]
- The real-time layer MUST use Socket.io with two rooms, `dm` and `players`. [input]
- A socket MUST join `dm` only when it carries a valid DM session (`07` §2); every other socket joins `players`. [Q-046, Q-010]

## 2. Commands

Commands flow from a DM socket to the server; the server MUST reject any command from a socket that is not in `dm`. [input, Q-046]

| Command | Effect | Undoable |
| --- | --- | --- |
| `token.add` | place a token of an asset on the live scene | yes |
| `token.move` | set a token's position | yes |
| `token.delete` | remove a token from the live scene | yes |
| `token.setVisibility` | hide or reveal a token | yes |
| `token.setMarkers` | set the condition markers a token carries (`03` §1) | yes |
| `fog.paint` | one stroke of the brush on the live scene, painting fog or erasing it (§13) | yes |
| `fog.fill` | fog the live scene's whole map, or clear all its fog | yes |
| `scene.activate` | make a scene the live scene | no |
| `scene.deactivate` | clear the live scene; the player view goes idle | no |
| `camera.setPlayer` | set the player camera | no |
| `ruler.update`, `ruler.clear` | show or clear a measurement on the TV | no |
| `ping` | mark a point of the live scene on both views for a moment (§12) | no |
| `undo` | apply the most recent inverse command | — |
| `redo` | apply again the most recently undone command | — |

- The token commands on the live scene MUST be exactly `token.add`, `token.move`, `token.setVisibility`, `token.setMarkers` and `token.delete`; label and stacking order are edited only on scenes that are not live. [input, Q-014, Q-099]
- Clearing the live scene MUST be possible at any time with `scene.deactivate`. [Q-025]
- Conflicting commands MUST resolve last-write-wins. [input]
- Several DM sockets MAY be connected at once, each receiving every `dm` event. [Q-008, recommendation accepted]

## 3. Events

Each event MUST reach the rooms as this table states. [input, Q-014, Q-025, Q-027, Q-038, Q-047, Q-083, D-049]

| Event | `dm` room | `players` room |
| --- | --- | --- |
| `scene.snapshot` | full scene, all tokens | visible tokens only, player fields only |
| `token.added` | on add | on add of a visible token, on reveal, and when a token leaves the fog or the fog over it lifts |
| `token.updated` | on move, visibility or markers change | on move or markers change of a visible token |
| `token.removed` | on delete | on delete of a visible token, on hide, and when the fog covers a token |
| `scene.cleared` | on deactivate | on deactivate |
| `camera.player` | on change | on change |
| `ruler.shown`, `ruler.cleared` | on change | on change |
| `ping` | on ping | on ping |
| `history.changed` | when whether undo or redo would change anything changes | never |
| `fog.updated` | when the fog changes: the whole mask | when the fog changes: the whole mask |

## 4. Role-filtered projection

- The DM room MUST receive the full live state; the players room MUST receive only visible content. [input]
- A token MUST count as visible to players only when it is not hidden AND its centre is under no fogged cell (§13); a centre on a cell's edge counts as under it. Every players' snapshot, event, rank, label numbering and image file MUST follow this rule. [input, Q-099, Q-101]
- Filtering MUST happen on the server before emitting, never in the player client. [input]
- Revealing a token MUST reach players as `token.added`, and hiding it as `token.removed`. [input]
- A player client MUST NOT receive anything from which the existence of a hidden token can be learnt: no hidden token, no hidden token's ID, asset or image, no count. [input]
- A player-room token MUST carry only what rendering needs: ID, position, size, image reference, stacking order, label, its asset's category, which colours its ring, and its condition markers; asset notes and defaults are never sent, and a hidden token's markers never reach players. [Q-047, Q-032, Q-100, Q-099]
- The players' snapshot MUST carry the live scene's name, shown on the TV (`08` §11), and its painted fog, the mask alone; the undo state MUST NOT reach players, nor the count of connected player views, which the DM view reads over REST (`02` §5). [input, Q-100]
- The grid overlay MUST NOT be drawn on the player view when the scene's grid is set hidden for players (`06` §2). [input]

## 5. Snapshot and versioning

- A client MUST receive a `scene.snapshot` for its role on connection. [input]
- Activating a scene sends every client a fresh snapshot. [D-039]
- Every event MUST carry an ascending version number; a client that sees a gap MUST request a new snapshot. [input]
- The version counter MUST be one per room per server process, each held in memory and starting at 1 on start-up; the `players` room's counts only the events players receive, so a player never sees a version skip that another room's event caused (`04` §4). [Q-056, Q-093]

## 6. Reconnection

- Clients MUST reconnect automatically after sleep or network loss, and resynchronise from a fresh snapshot. [input]
- A DM socket that reconnects within the same server run MUST keep its DM role without asking for the PIN again (`07` §2). [Q-008, recommendation accepted]

## 7. Dragging

- While dragging, the DM client MUST move the token locally and send `token.move` only on drop. [input]
- A live preview of a drag in progress is Future (`01` §6). [input]

## 8. Undo

- The server MUST keep the inverse of every undoable DM command on the live scene: move, add, delete, visibility, markers, and the fog commands, each stroke one step. [input, Q-099, Q-101]
- Ctrl+Z in the DM view MUST cause the most recent inverse command to be applied as an ordinary command, so synchronisation does not change. [input]
- Ctrl+Z sends `undo`; the server applies the inverse from its history through the ordinary command path. [D-040]
- The undo history MUST be held in memory only, cleared when another scene is activated or the server restarts, and bounded to the last 100 commands. [Q-005]
- Setup edits to the live scene (`04` §10) MUST NOT be undoable. [Q-050]
- Redo MUST apply again, through the ordinary command path, the most recent command undone; any new undoable command that changes something MUST empty the redo stack, which is held and cleared like the history. [input]

## 9. Cameras

- The DM view and the player view MUST have independent cameras (zoom and pan). [input]
- The player view MUST start fitted to the map. [input]
- The DM MUST be able to set the player camera from the DM view, which shows a frame of what the TV sees, without changing the DM's own camera. [input]
- The player camera MUST be held in server memory and reset to fit-to-map on every activation. [Q-038]

## 10. Editing the live scene's setup

- Changes to the live scene's map image, grid calibration or grid visibility MUST be saved and pushed to both rooms as a fresh `scene.snapshot`. [Q-015, recommendation accepted]

## 11. Ruler on the TV

- While the DM measures on the live scene, the ruler line and distance MUST be shown on the player view through `ruler.shown` and `ruler.cleared`; measurements are never stored. [Q-027]
- A measurement made on a scene that is not live MUST NOT be sent to players. [Q-086]

## 12. Ping

- A `ping` MUST name the live scene and a point on it in grid units, as token positions are (`03` §4); a ping naming a scene that is not live MUST be refused and sent to nobody. [Q-099]
- Both rooms MUST receive the point as a `ping` event, drawn on each view for about two seconds; a ping names no token and MUST NOT be stored, undone or carried in a snapshot, so a view that connects later never sees it. [input, Q-099]

## 13. Painted fog

- The DM MUST paint fog with a round brush and reveal it with an eraser, the brush's radius set on a slider from a quarter square to five, and MUST be able to fog the whole map or clear all its fog, in preparation and on the live scene (`03` §1). [Q-101]
- The fog MUST be kept in grid units, in cells of a quarter square each way; a stroke covers each cell whose centre is within its radius, and a stroke or a fill stays within the map. [Q-101]
- The fog MUST be a mask the player view draws over the map; the map's pixels are not withheld, since the table is trusted. [input, Q-099]
- A stroke, a fill or a clear, and its undo and redo, MUST reach both rooms as `fog.updated` with the whole mask, and players as a `token.added` for every token it lets them see and a `token.removed` for every token it covers, computed in the same step as the change; a stroke that changes nothing MUST reach nobody and is not undoable. [input, Q-099, Q-101]
- Painting in preparation MUST have no undo, as no preparation edit has (§8). [Q-101]
- A token MUST be numbered the first time players can see it, whatever made it so (`05` §3), so that a token placed visible inside the fog renames no token players see. [Q-092, Q-096, Q-099]
