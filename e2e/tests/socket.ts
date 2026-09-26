import type { Page } from '@playwright/test';

// Live commands from a DM page's browser over the real socket (LIV-02, LIV-03). The DM view has no
// Go live control until LIV-04, so the page speaks the Socket.io wire protocol itself: its
// WebSocket carries the page's DM cookie and Origin, as the view's own does (D-109).

/** Sends one command from inside `page` over a WebSocket of its own and answers the acknowledgement. */
export function commandFromPage(page: Page, type: string, payload: object): Promise<unknown> {
  return page.evaluate(
    ([type, payload]) =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/socket.io/?EIO=4&transport=websocket`);
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error('no acknowledgement'));
        }, 10_000);
        socket.onmessage = ({ data }) => {
          const frame = String(data);
          if (frame === '2') socket.send('3');
          else if (frame.startsWith('0')) socket.send('40');
          else if (frame.startsWith('40')) socket.send(`421${JSON.stringify(['command', { type, payload }])}`);
          else if (frame.startsWith('431')) {
            clearTimeout(timer);
            socket.close();
            resolve((JSON.parse(frame.slice(3)) as unknown[])[0]);
          }
        };
        socket.onerror = () => {
          clearTimeout(timer);
          socket.close();
          reject(new Error('socket error'));
        };
      }),
    [type, payload] as const,
  );
}

/** The `scene.snapshot` payloads a page receives over its WebSocket, in order. */
export function snapshotsOf(page: Page): unknown[] {
  const snapshots: unknown[] = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', ({ payload }) => {
      const frame = String(payload);
      if (!frame.startsWith('42')) return;
      const [, event] = JSON.parse(frame.slice(2)) as [string, { type: string; payload: unknown }];
      if (event.type === 'scene.snapshot') snapshots.push(event.payload);
    });
  });
  return snapshots;
}
