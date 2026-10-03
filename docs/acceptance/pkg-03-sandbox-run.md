# PKG-03 — The owner's install in Windows Sandbox

The manual install of the Windows package on a Windows with no Node installed (`specs/10-testing-acceptance.md` §4, `specs/13-implementation-plan.md` §11 PKG-03, D-176), and the warnings Windows shows for a downloaded, unsigned file (G-046). CI installs a package it built itself, and Windows does not mark that package as downloaded, so only a real download shows what a DM sees. Fill in the **Record** lines as you go and hand the file back, or paste them into a message. An agent then writes them into `TRACEABILITY.md`, `GAPS.md`, the README and the release notes.

Allow about 30 minutes. You need a Windows 10 or 11 Pro, Enterprise or Education PC (Windows Sandbox is not in Home) and a release-candidate release, for example `v1.0.0-rc.1`, published by the release workflow on the repository's Releases page.

## 0. Before you start

1. If Windows Sandbox is not on yet: Start, type "Turn Windows features on or off", tick **Windows Sandbox**, OK, restart. It also needs virtualisation turned on in the PC's BIOS or UEFI settings; Windows says so if it is off.
2. Start **Windows Sandbox** from the Start Menu. It is a clean Windows that forgets everything when you close it. Do every step below inside it.
3. In the Sandbox, open Command Prompt and run `where node`. It must say that it could not find the file: this Windows has no Node.

**Record:**
- Your Windows version (`winver` on the PC, and in the Sandbox):
- The release you test (its tag):
- `where node` in the Sandbox says:

## 1. Download

1. In the Sandbox, open Edge and go to the release's page: `https://github.com/giorgosroussos/dnd-vtt/releases`.
2. Download the four files: `Emberglass-<version>-win-x64-setup.exe`, `Emberglass-<version>-win-x64.zip` and their two `.sha256` files.
3. In Command Prompt: `cd %USERPROFILE%\Downloads`, then `certutil -hashfile Emberglass-<version>-win-x64-setup.exe SHA256`, and the same for the zip. Compare each with its `.sha256` file (open it in Notepad).
4. **If either checksum does not match, stop**: do not open the file, and report it.

**Record:**
- Did Edge warn about any download? Its exact words, and what you clicked:
- Both checksums match (yes / no):

## 2. The portable zip

1. In File Explorer, right-click the zip, **Properties**. Is there a **Security** line with an **Unblock** box at the bottom of the General tab? Do not tick it.
2. Close Properties. Right-click the zip, **Extract All…**, into `Documents\Emberglass`.
3. Open the extracted folder and double-click `Emberglass.cmd`.

**Record:**
- The Unblock box was there (yes / no):
- Each warning before Emberglass started, in order, with its exact title and words (for example "Windows protected your PC", or "Open File - Security Warning", "The publisher could not be verified"), and what you clicked on each:
- Did the console window open and show the TV address and the QR code (yes / no)?
- Did the DM view open in Edge at `http://127.0.0.1:3000/dm`, offering to set the PIN (yes / no)?
- Did Windows ask about the firewall? Its exact words, which boxes it had ticked, and the network's profile in the Sandbox (Settings, Network & internet). Tick **Private networks** only, as the README says:

4. Set a PIN, then close the console window. The DM view stops answering.

**Record:**
- The PIN was set and the workspace opened (yes / no):

## 3. The installer

1. Double-click `Emberglass-<version>-win-x64-setup.exe` in Downloads.
2. Go through the installer with its defaults, then leave **Start Emberglass** ticked on its last page.

**Record:**
- Each warning before the installer's first page, in order, with its exact title and words, and what you clicked:
- The administrator prompt (UAC), if one appeared: the publisher it names (an unsigned file shows "Unknown"). If none appeared, write "none": Windows Sandbox may run as administrator without asking:
- Did Emberglass start at the end, with its console window and the DM view in Edge (yes / no)?
- Did Windows ask about the firewall this time (yes / no)? The installer adds its rules, so it should not.
- The DM view asks for the PIN you set in step 2 (yes / no): the zip and the installer share the data in `%APPDATA%\Emberglass`.

## 4. A short session

1. In the DM view: create a campaign, a session and a scene. Give the scene a map: any PNG or JPEG, for example a screenshot (Win+Shift+S, paste into Paint, save it as PNG).
2. Add a token from a new asset, then **Go live**.
3. Open a second Edge window (InPrivate, Ctrl+Shift+N) at `http://127.0.0.1:3000/`: the player view shows the map and the token.
4. Hide the token in the DM view: it goes from the player view.

**Record:**
- Each step worked (yes / no; what went wrong if not):

## 5. Uninstall

1. Close the Emberglass console window.
2. Start, **All apps** (on Windows 11), **Emberglass**, **Uninstall Emberglass**, and confirm. Typing "Uninstall Emberglass" in Start finds it too.
3. In File Explorer, open `%APPDATA%\Emberglass`.

**Record:**
- The uninstaller said your data is kept (yes / no):
- `%APPDATA%\Emberglass` is still there, with `emberglass.db` (yes / no):
- The Emberglass folder is gone from the Start Menu, and `C:\Program Files\Emberglass` is gone (yes / no):

Close Windows Sandbox when you are done; it keeps nothing.
