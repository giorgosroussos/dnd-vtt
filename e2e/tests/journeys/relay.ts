import net from 'node:net';

// A network between a view and the server that the Recover journey can kill (specs/10-testing-acceptance.md
// §5, REL-02, D-127): a TCP relay on this PC that the view's browser uses instead of the server's own
// port. Cut, it goes silent as a Wi-Fi that dropped does: open connections stay open but carry nothing,
// and new ones are accepted and never answered, so each end learns of the loss only from its heartbeat
// (G-026). Restored, the connections held through the cut are gone, as after a real outage, and new
// ones pass again.

export interface Relay {
  /** The origin a view opens to go through this relay. */
  origin: string;
  cut: () => void;
  restore: () => void;
  close: () => Promise<void>;
}

export function startRelay(target: { host: string; port: number }): Promise<Relay> {
  let cut = false;
  const sockets = new Set<net.Socket>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  };
  const server = net.createServer((client) => {
    track(client);
    // During the cut: accepted, then silence.
    if (cut) {
      client.pause();
      return;
    }
    const upstream = net.connect(target.port, target.host);
    track(upstream);
    const pass = (from: net.Socket, to: net.Socket) =>
      from.on('data', (chunk) => {
        if (!cut) to.write(chunk);
      });
    pass(client, upstream);
    pass(upstream, client);
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, target.host, () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        origin: `http://${target.host}:${port}`,
        cut: () => {
          cut = true;
        },
        restore: () => {
          for (const socket of sockets) socket.destroy();
          cut = false;
        },
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
