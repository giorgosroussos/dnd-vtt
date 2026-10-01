# REL-03 — The owner's TV run

The steps of the acceptance run on the owner's LG TV, Windows PC and laptop (`specs/10-testing-acceptance.md` §4, `specs/05-assets-and-images.md` §7, `specs/13-implementation-plan.md` §7 REL-03), and what to write down at each. The run is the owner's: nothing here can be automated, because the evidence is the owner's hardware. Fill in the **Record** lines as you go and hand the file back, or paste them into a message; an agent then writes them into `TRACEABILITY.md`, `GAPS.md` and the decision log.

Allow about an hour. You need the TV, the Windows PC that runs the server, the laptop you prepare on, and a phone with a camera.

## 0. Before you start

1. On the Windows PC, in the Emberglass folder: `git pull`, `npm install`, `npm run build`, then `npm start`. Leave the console open: it prints the addresses and the QR code.
2. If Windows asks about the firewall, allow **private networks only**.
3. In a second terminal on the same PC, build the large-scene fixture on the running server (a 10,000 × 7,000 px map, 50 tokens and a map-less scene, in a new campaign named "TV run" and the date):

   ```bash
   node e2e/fixtures/large-scene.ts --seed http://localhost:3000
   ```

   It asks for the DM PIN without showing it, and prints the campaign, session and scene it made. It takes about ten seconds. Run it on the server PC with `localhost`: from another address the PIN crosses the network and a wrong one counts towards the limits on wrong PINs. Prefer typing the PIN at the prompt to setting `EMBERGLASS_PIN` on the command line, which keeps it in the shell's history.

**Record (G-002):**
- TV model (Settings → Support → TV information, or the label on the back):
- webOS version (same screen, "Software version" and "webOS TV version"):
- The PC's Windows version and the Emberglass commit (`git log -1 --format=%h`):

## 1. The connect panel's address (G-031)

The panel highlights the first private-range address in the order Windows lists the adapters (Q-053). On a PC with Hyper-V, WSL or Docker, that may be a virtual adapter's, which the TV cannot reach.

1. In a terminal: `ipconfig`. Note each adapter's name and IPv4 address.
2. In the DM view (`http://localhost:3000/dm`), open **Connect a screen** in the header.

**Record:**
- The prominent address in the panel, and which adapter it belongs to:
- The other addresses the panel lists:
- Does the prominent address reach the TV? (Step 3 answers this.)

If the prominent address is a virtual adapter's, changing which one is highlighted changes a locked decision (Q-053, `specs/12-decision-register.md` §5), so it becomes an ADR for your approval, with a question card listing the options (prefer 192.168/16, then 10/8, then 172.16/12; or skip adapters named like vEthernet, WSL, Docker). If it is the Wi-Fi or Ethernet adapter's, a recorded decision accepts the residual.

## 2. Firefox's first load on the PC (G-040)

In CI, Firefox on Windows took 5 to 26 s to load the views from the machine's own LAN address, where other browsers took about a second. The cause is unknown; Firefox's HTTPS-First upgrade attempt is a candidate.

1. Open a **new private window** in Firefox on the PC.
2. Open the developer tools' Network tab (F12), tick "Disable cache".
3. Type `http://<prominent address>:3000/` and press Enter. Note the time until the idle screen appears (the Network tab's "Load" figure at the bottom).
4. Repeat once in the same window, and once with `localhost` instead of the address.
5. Optional, to test the candidate: in `about:config` set `dom.security.https_first` and `dom.security.https_first_schemeless` to `false`, open a new private window and repeat step 3; then set them back.

**Record:**
- Firefox version:
- First load by LAN address (s), second load (s), load by `localhost` (s):
- With HTTPS-First off (s), if tried:

## 3. The TV (the Connect TV journey, the large scene, and running it)

1. On the TV, open the web browser and **type** the short URL the console printed (`http://<address>:3000/`). The idle screen appears: the product name and "The table is set. Waiting for the Dungeon Master."
2. With the phone's camera, **scan the QR code** in the Connect a screen panel. The phone opens the same address and shows the same idle screen. Close it on the phone.
3. In the DM view, choose the campaign, session and scene the seed command printed ("TV run <date and time>", "TV run", "Large scene <date and time>"), and **Go live**.
4. On the TV: the map and the 50 coloured tokens are drawn. Note how long it takes from Go live, and whether panning the TV's frame in the DM view moves the TV smoothly.
5. **Move** a token (drag it); **hide** one (H) and **reveal** it again; **ping** (P, click); put a **condition marker** on a token; **paint fog** over a token with the fog brush (F) and **erase** it again (E switches the brush). Each appears on the TV as it should, and nothing hidden appears.
6. **Measure** with the ruler (M) across about ten squares. Stand where the players sit and read the distance label on the TV.
7. **Go idle** in the header: the TV returns to the idle screen.
8. **Go live** again, then **cut the TV's network** (TV Settings → Network → turn Wi-Fi off, or unplug its cable) for about 30 s, and restore it. The TV returns to the live scene by itself, without reloading or typing anything. Do the same to the laptop's Wi-Fi while it shows the DM view: it returns without asking for the PIN.

**Record (each: pass or fail, and what you saw):**
- Typed URL opens the idle screen:
- QR code opens the same address on the phone:
- Large scene drawn on Go live (seconds), pans smoothly (yes/no):
- Move, hide, reveal, ping, marker, fog on the TV:
- Ruler label readable from the players' seats (distance from the TV, in metres):
- Go idle shows the idle screen:
- TV back after a network cut (seconds), laptop back without a PIN:

## 4. The display-version size (`05` §7)

The TV is sent a display copy of each map at most 4,096 px on its long side. This run confirms that default or changes it.

- If step 3 passed with no crash, blank screen or reload on the TV, and the map looked sharp: the 4,096 px default is confirmed.
- If the TV browser crashed, reloaded, went blank or was very slow: in the DM view open **Settings**, set "Display size for the TV" to **2048**, save, wait for the resizing to finish, and repeat steps 3.3 to 3.5. If 2,048 works, that becomes the new default by a decision and its test.

**Record:**
- Display size that worked (4096 / 2048 / other):
- What happened at 4096, if it failed:

## 5. The laptop's window (confirms D-148)

A 1080p laptop at Windows' 150% scaling gives the page about 1,280 × 620. An end-to-end test checks that size (`e2e/tests/window.spec.ts`, D-148, which closed G-041); this confirms it on the real laptop, and a disagreement opens a new gap.

1. On the laptop, open `http://<address>:3000/dm` in your usual browser, window maximised, and sign in.
2. Press F12, and in the Console type `innerWidth + ' × ' + innerHeight`, Enter. Close the developer tools.
3. Choose a scene with a map, open **Scene setup**, **Calibrate grid**, then cancel; place a token with **Add token**; open **Settings** and look at the **Change the PIN** section.

**Record:**
- Browser, and the window's inner size:
- Calibrating: the whole map canvas visible without scrolling (yes/no):
- Placing a token: the canvas visible without scrolling (yes/no):
- Settings: every control, Change PIN and Close included, visible without scrolling (yes/no):

## 6. Hand back

Send the filled-in record. An agent adds the TV's model and webOS version to `docs/inputs/` with an authority entry (an unlock of that folder, which is yours to authorise), adds the results to the REL-03 row of `TRACEABILITY.md` (REL-03 is done with this run deferred, D-151), closes G-043 (this run) with them, and closes or keeps G-002, G-031 and G-040 with their evidence or a decision.
