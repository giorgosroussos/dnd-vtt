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
| `token.setStats` | set or clear a token's hit points, maximum, temporary hit points and armour class (§15) | yes |
| `token.applyHp` | apply a signed amount to a token's hit points, negative for damage and positive for healing (§15) | yes |
| `fog.paint` | one stroke of the brush on the live scene, painting fog or erasing it (§13) | yes |
| `fog.fill` | fog the live scene's whole map, or clear all its fog | yes |
| `scene.activate` | make a scene the live scene | no |
| `scene.deactivate` | clear the live scene; the player view goes idle | no |
| `camera.setPlayer` | set the player camera | no |
| `ruler.update`, `ruler.clear` | show or clear a measurement on the TV | no |
| `ping` | mark a point of the live scene on both views for a moment (§12) | no |
| `encounter.start`, `encounter.end` | start the live scene's combat from its player characters, or end it (§14) | yes |
| `encounter.reorder`, `encounter.setInitiative` | set the order of the entries by dragging, or an entry's initiative number, which sorts them (§14) | yes |
| `encounter.next`, `encounter.previous` | pass the turn to the next or the previous entry, counting rounds (§14) | yes |
| `encounter.addEntry`, `encounter.removeEntry` | add a player character's, a monster's or an npc's entry, or remove one (§14) | yes |
| `undo` | apply the most recent inverse command | — |
| `redo` | apply again the most recently undone command | — |

- The token commands on the live scene MUST be exactly `token.add`, `token.move`, `token.setVisibility`, `token.setMarkers`, `token.setStats`, `token.applyHp` and `token.delete`; label and stacking order are edited only on scenes that are not live, notes at any time over REST (§16); deleting a token also removes its initiative entry, and undoing the delete puts the entry back (§14). [input, Q-014, Q-099, Q-111, Q-112, Q-114]
- Clearing the live scene MUST be possible at any time with `scene.deactivate`. [Q-025]
- Conflicting commands MUST resolve last-write-wins. [input]
- Several DM sockets MAY be connected at once, each receiving every `dm` event. [Q-008, recommendation accepted]

## 3. Events

Each event MUST reach the rooms as this table states. [input, Q-014, Q-025, Q-027, Q-038, Q-047, Q-083, D-049, Q-111, Q-112, Q-114]

| Event | `dm` room | `players` room |
| --- | --- | --- |
| `scene.snapshot` | full scene, all tokens | visible tokens only, player fields only |
| `token.added` | on add | on add of a visible token, on reveal, and when a token leaves the fog or the fog over it lifts |
| `token.updated` | on move, visibility, markers, hit points or armour class change | on move or markers change of a visible token, markers set by its hit points included (§15) |
| `token.removed` | on delete | on delete of a visible token, on hide, and when the fog covers a token |
| `scene.cleared` | on deactivate | on deactivate |
| `camera.player` | on change | on change |
| `ruler.shown`, `ruler.cleared` | on change | on change |
| `ping` | on ping | on ping |
| `history.changed` | when whether undo or redo would change anything changes | never |
| `fog.updated` | when the fog changes: the whole mask | when the fog changes: the whole mask |
| `encounter.updated` | when the encounter changes: the whole encounter | when what players see of it changes: its projection (§14) |
| `notes.updated` | when the live scene's or one of its tokens' notes change (§16) | never |

## 4. Role-filtered projection

- The DM room MUST receive the full live state; the players room MUST receive only visible content. [input]
- A token MUST count as visible to players only when it is not hidden AND its centre is under no fogged cell (§13); a centre on a cell's edge counts as under it. Every players' snapshot, event, rank, label numbering and image file MUST follow this rule. [input, Q-099, Q-101]
- Filtering MUST happen on the server before emitting, never in the player client. [input]
- Revealing a token MUST reach players as `token.added`, and hiding it as `token.removed`. [input]
- A player client MUST NOT receive anything from which the existence of a hidden token can be learnt: no hidden token, no hidden token's ID, asset or image, no count. [input]
- A player-room token MUST carry only what rendering needs: ID, position, size, image reference, stacking order, label, its asset's category, which colours its ring, and its condition markers; asset notes and defaults are never sent, nor a token's hit points, armour class or notes, nor the scene's notes, and a hidden token's markers never reach players. [Q-047, Q-032, Q-100, Q-099, Q-112, Q-114]
- The players' snapshot MUST carry the live scene's name, shown on the TV (`08` §11), and its painted fog, the mask alone; the undo state MUST NOT reach players, nor the count of connected player views, which the DM view reads over REST (`02` §5). [input, Q-100]
- The players' encounter MUST carry only the round and, in order, the entries whose token players can see, each naming that token, which they already render with its label, and which of them has the turn and which is next; never an initiative number, nor an entry whose token they cannot see, nor anything from which such an entry can be counted; while the turn is an entry they cannot see, neither the turn nor the next is named (§14). [Q-111]
- Hit points, armour class and notes MUST be filtered on the server like hidden tokens: a change of them alone sends the players room nothing and moves its version counter by nothing, and a change of hit points reaches players only as the markers it sets or removes on a token they can see (§15, §16). [Q-112, Q-114]
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

- The server MUST keep the inverse of every undoable DM command on the live scene: move, add, delete, visibility, markers, hit points and armour class with the markers they set (§15), the fog commands, each stroke one step, and the encounter commands (§14). [input, Q-099, Q-101, Q-111, Q-112]
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
- The DM view MUST offer Follow my view on the live scene, off at every activation: while it is on, the player camera continuously mirrors the DM's camera, sent as `camera.setPlayer` and throttled, the DM's whole visible area widened to the TV's aspect ratio so that nothing the DM sees is cropped. [Q-113]
- Follow my view MUST turn off when Lock TV camera is turned on, when any other TV camera control is used (Send my view, Fit map, TV zoom, the TV frame), and when another scene goes live or the TV goes idle. [Q-113]

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

## 14. Initiative

- A scene MUST hold at most one encounter (`03` §1); the encounter commands MUST name the live scene and are refused when it is not live, as the ping is (§12). [Q-111]
- The DM records the order; the table rolls physical dice, and the server MUST NOT roll, compute or suggest an initiative number. [Q-111]
- `encounter.start` MUST build one entry per player character, monster and npc token of the scene that players can see, monster and npc tokens carrying Dead left out, in the order of the DM's token list; the round is 1 and the turn the first entry that can take it. Starting an encounter already active MUST be refused. [Q-111]
- Every entry MUST name one token of the scene: a player character's (`kind: pc`), or a monster's or npc's (`kind: monster`), at most one entry per token; object tokens are never part of the encounter. [Q-111]
- Setting an initiative number, or clearing it, MUST sort the entries with the highest number first and the entries without one below them, keeping their order among themselves; ties keep their order. `encounter.reorder` MUST set the order exactly as given, and that order stands until a number is set again. [Q-111]
- `encounter.next` MUST pass the turn to the next entry that can take it, and past the last entry back to the first, counting one more round; `encounter.previous` MUST do the reverse, and does nothing on round 1's first turn. [Q-111]
- A player character's entry MUST take its turn whatever markers its token carries, Unconscious and Dead included, but MUST be passed over while players cannot see its token. A monster's or npc's entry MUST stay in the order but be passed over while its token carries Dead or players cannot see it. [Q-111, Q-118]
- `encounter.addEntry` MUST add a token players can see that has no entry yet: a player character, or a monster or npc not carrying Dead; at the end, or, given the number the table rolled for it, before the first entry with a lower number or none, the rest of the order left as it stands. `encounter.removeEntry` removes any entry. [Q-111, Q-117, D-183]
- `encounter.end` MUST clear the encounter: no entries, round 1, not active. [Q-111]
- The encounter MUST be carried in both rooms' snapshots, so a view that connects or reconnects shows it, and players' projection (§4) MUST be sent to them only when it changes, whatever command changed it. [Q-111]
- An encounter stored with the one Enemies entry of before MUST have that entry expanded in place, at upgrade, into one monster entry per member it had: the scene's monster and npc tokens players could see, without Dead. [Q-111]
- The expanded entries take the Enemies entry's initiative number and the order of the DM's token list; the turn, if the Enemies entry had it, passes to the first of them; an Enemies entry with no member is removed, its turn passing as on removal. [D-181]

## 15. Hit points

- `token.setStats` MUST set or clear any of a token's `hp_current`, `hp_max`, `hp_temp` and `ac` (`03` §9); `token.applyHp` MUST apply a signed amount, negative for damage and positive for healing, damage taking the temporary hit points first. [Q-112, D-182]
- Damage MUST stop `hp_current` at 0, and healing MUST stop it at `hp_max` when one is set; healing never adds temporary hit points. [D-181]
- While a token has `hp_max`, every change of its hit points, live, in preparation, undone or redone, MUST set Bloodied when `hp_current` is at most `hp_max` / 2 rounded down and remove it above that; at 0 a monster or npc token MUST gain Dead and a player character token Unconscious. Without `hp_max`, nothing is set. [Q-112]
- Hit points rising above 0 MUST NOT remove Dead or Unconscious; the DM removes them. [Q-116]
- The markers the hit points set or remove belong to the same undoable step as the change, an object token gains neither Dead nor Unconscious, and a Dead set this way takes a monster's entry out of the turns as any Dead does (§14). [D-181]

## 16. DM notes

- A scene's and a token's notes MUST be seen and edited only by the DM, and never reach the players room (§4). [Q-114]
- Notes are edited over REST on any scene, live included, and are not undoable; on the live scene the change reaches the `dm` room as `notes.updated`. [D-181]
