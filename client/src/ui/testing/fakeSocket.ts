import { SOCKET_CHANNELS, type EventEnvelope, type SceneSnapshot } from '@emberglass/shared';
import { setSocketFactory, type LiveSocketLike } from '../../live/connection.js';

// Test tooling only, never bundled: a scripted stand-in for the Socket.io client socket, for the
// component tests of the live connection (LIV-01). A test drives it as the server would: open it,
// deliver events, drop it. The real transport is proven by server/src/ws/live.test.ts and the
// end-to-end tests.

type Listener = (...args: never[]) => void;

export class FakeSocket implements LiveSocketLike {
  connected = false;
  connects = 0;
  readonly emitted: { event: string; args: unknown[] }[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    this.emitted.push({ event, args });
    return this;
  }

  connect(): this {
    this.connects++;
    return this;
  }

  disconnect(): this {
    const was = this.connected;
    this.connected = false;
    if (was) this.fire('disconnect', 'io client disconnect');
    return this;
  }

  // --- driven by the test, as the server would ---

  /** The connection opened, and the server sent the snapshot every connection starts with. */
  open(snapshot?: SceneSnapshot, version = 1): void {
    this.connected = true;
    this.fire('connect');
    if (snapshot) this.deliver({ type: 'scene.snapshot', version, payload: snapshot });
  }

  deliver(event: EventEnvelope): void {
    this.fire(SOCKET_CHANNELS.event, event);
  }

  drop(reason = 'transport close'): void {
    this.connected = false;
    this.fire('disconnect', reason);
  }

  /** The snapshot requests sent so far. */
  snapshotRequests(): number {
    return this.emitted.filter(({ event }) => event === SOCKET_CHANNELS.snapshot).length;
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (...a: unknown[]) => void)(...args);
  }
}

/** Every socket the views open until `restore` is called goes into `sockets`. */
export function installFakeSockets(): { sockets: FakeSocket[]; restore: () => void } {
  const sockets: FakeSocket[] = [];
  const restore = setSocketFactory(() => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  return { sockets, restore };
}
