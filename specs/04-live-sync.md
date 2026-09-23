# 04 — Live Sync

The WebSocket contract for the live scene: who sends what, what each room receives, and how clients stay in step.

## 1. Principles

- The WebSocket MUST carry only the live scene; everything else is REST (`02` §4). [input]
- The real-time layer MUST use Socket.io with two rooms, `dm` and `players`. [input]
- A socket MUST join `dm` only when it carries a valid DM session (`07` §2); every other socket joins `players`. [input, Q-010]

## 2. Commands

Commands flow from a DM socket to the server; the server MUST reject any command from a socket that is not in `dm`. [input]

| Command | Effect | Undoable |
| --- | --- | --- |
| `token.add` | place a token of an asset on the live scene | yes |
| `token.move` | set a token's position | yes |
| `token.delete` | remove a token from the live scene | yes |
| `token.setVisibility` | hide or reveal a token | yes |
| `scene.activate` | make a scene the live scene | no |
| `scene.deactivate` | clear the live scene; the player view goes idle | no |
| `camera.setPlayer` | set the player camera | no |
| `ruler.update`, `ruler.clear` | show or clear a measurement on the TV | no |
| `undo` | apply the most recent inverse command | — |

- The token commands on the live scene MUST be exactly `token.add`, `token.move`, `token.setVisibility` and `token.delete`; label and stacking order are edited only on scenes that are not live. [input, Q-014]
- Clearing the live scene MUST be possible at any time with `scene.deactivate`. [Q-025]
- Conflicting commands MUST resolve last-write-wins. [input]
- Several DM sockets MAY be connected at once, each receiving every `dm` event. [Q-008, recommendation accepted]

## 3. Events

| Event | `dm` room | `players` room |
| --- | --- | --- |
| `scene.snapshot` | full scene, all tokens | visible tokens only, player fields only |
| `token.added` | on add | on add of a visible token, and on reveal |
| `token.updated` | on move, visibility change | on move of a visible token |
| `token.removed` | on delete | on delete of a visible token, and on hide |
| `scene.cleared` | on deactivate | on deactivate |
| `camera.player` | on change | on change |
| `ruler.shown`, `ruler.cleared` | on change | on change |

## 4. Role-filtered projection

- The DM room MUST receive the full live state; the players room MUST receive only visible content. [input]
- Filtering MUST happen on the server before emitting, never in the player client. [input]
- Revealing a token MUST reach players as `token.added`, and hiding it as `token.removed`. [input]
- A player client MUST NOT receive anything from which the existence of a hidden token can be learnt: no hidden token, no hidden token's ID, asset or image, no count. [input]
- A player-room token MUST carry only what rendering needs: ID, position, size, image reference, stacking order and label; asset notes and defaults are never sent. [input, Q-032]
- The grid overlay MUST NOT be sent to players when the scene's grid is set hidden for players (`06` §2). [input]

## 5. Snapshot and versioning

- A client MUST receive a `scene.snapshot` for its role on connection and after every scene activation. [input]
- Every event MUST carry an ascending version number; a client that sees a gap MUST request a new snapshot. [input]
- The version counter is one per server process, starting at 1 on start-up. [D-017]

## 6. Reconnection

- Clients MUST reconnect automatically after sleep or network loss, and resynchronise from a fresh snapshot. [input]
- A DM socket that reconnects within the same server run MUST keep its DM role without asking for the PIN again (`07` §2). [Q-008, recommendation accepted]

## 7. Dragging

- While dragging, the DM client MUST move the token locally and send `token.move` only on drop. [input]
- A live preview of a drag in progress is Future (`01` §6). [input]

## 8. Undo

- The server MUST keep the inverse of every undoable DM command on the live scene: move, add, delete, visibility. [input]
- Ctrl+Z in the DM view MUST send `undo`, and the server MUST apply the inverse through the same path as a normal command, emitting the same events. [input]
- The undo history MUST be held in memory only, cleared when another scene is activated or the server restarts, and bounded to the last 100 commands. [Q-005]
- Setup edits to the live scene (`04` §10) are not undoable. [input]

## 9. Cameras

- The DM view and the player view MUST have independent cameras (zoom and pan). [input]
- The player view MUST start fitted to the map. [input]
- The DM MUST be able to set the player camera from the DM view, which shows a frame of what the TV sees, without changing the DM's own camera. [input]
- The player camera is held in server memory and resets to fit-to-map on every activation. [D-018]

## 10. Editing the live scene's setup

- Changes to the live scene's map image, grid calibration or grid visibility MUST be saved and pushed to both rooms as a fresh `scene.snapshot`. [Q-015, recommendation accepted]

## 11. Ruler on the TV

- While the DM measures on the live scene, the ruler line and distance MUST be shown on the player view through `ruler.shown` and `ruler.cleared`; measurements are never stored. [Q-027]
- A measurement made on a scene that is not live MUST NOT be sent to players. [input]
