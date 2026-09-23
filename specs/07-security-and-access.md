# 07 — Security and Access

Who can do what, how the DM proves it, and what the server never reveals or trusts.

## 1. DM PIN

- There are no accounts; the DM view MUST be protected by a PIN. [input]
- Until a PIN is set, the PIN setup MUST be reachable only from a browser on the server machine itself (loopback address); a DM view opened from the LAN before then MUST show that setup happens on the server PC and offer nothing else. [Q-007, recommendation accepted]
- The DM MUST be able to change the PIN from the DM view by entering the current one. [Q-007, recommendation accepted]
- The PIN MUST be recoverable only by a command run on the server machine, which clears it so that setup runs again from localhost. [Q-007, recommendation accepted]
- The command is `npm run reset-pin`. [D-028]
- The PIN MUST be stored only as a salted scrypt hash. [Q-042]

## 2. DM session

- Entering the correct PIN MUST give that browser a DM session that lasts until the server restarts; sessions MUST NOT be written to disk. [Q-008, recommendation accepted]
- Automatic reconnection within the same server run MUST NOT ask for the PIN again (`04` §6). [Q-008, recommendation accepted]
- Changing the PIN MUST end every other DM session at once; the device that made the change stays signed in. [Q-033, recommendation accepted]
- The DM MUST be able to sign a browser out of the DM view, ending that browser's session. [Q-058]
- The session is a random 256-bit identifier in an HttpOnly, SameSite=Strict cookie, also read by the WebSocket handshake; REST writes and handshakes whose Origin does not match the server's host MUST be refused. [Q-043]

## 3. Player view

- The player view MUST be open to any browser on the LAN, without a credential, for any number of screens at once. [Q-010, recommendation accepted]
- The player view MUST be read-only: every command from the `players` room is rejected (`04` §2). [input, Q-010]
- The player view MUST receive only visible content of the live scene (`04` §4). [input]

## 4. Transport

- The server MUST serve plain HTTP and WebSocket on the LAN. [Q-011, recommendation accepted]
- The README MUST state that the PIN and the DM session cross the Wi-Fi unencrypted, and that the server is meant for a trusted home network. [Q-011, recommendation accepted]

## 5. Image files

- A DM session MUST be able to fetch every version of every image. [Q-012, recommendation accepted]
- A request without a DM session MUST be served only for the display version of the live scene's map and of the images of its visible tokens; every other request MUST be refused as not found. [Q-012, recommendation accepted]
- Hiding a token, deactivating a scene or activating another one MUST make its images unfetchable for players from that moment. [Q-012, recommendation accepted]

## 6. Guessing protection

- The PIN MUST be numeric, 4 to 8 digits. [Q-009, recommendation accepted]
- After 5 failed attempts from one client address, PIN entry from that address MUST be refused for 1 minute, the lockout doubling on each further run of 5 failures. [Q-009, recommendation accepted]

## 7. What the server trusts

- The server MUST derive a socket's or request's role only from its DM session, never from anything the client declares. [Q-046]
- The server MUST validate every command and REST body against the shared contract before applying it. [input, D-015, D-047]
- Uploads MUST be validated by content, not extension (`05` §6). [input]

## 8. Logging

- Logs MUST NOT contain a PIN, a session identifier or a cookie. [Q-044]
- Logs record start-up, the LAN addresses served, connections by role, failed PIN attempts with the client address, lockouts and errors (`09` §6). [Q-041]
