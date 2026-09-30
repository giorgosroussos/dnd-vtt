import type { FastifyInstance } from 'fastify';
import {
  API_CONNECT_PATH,
  API_SCREENS_PATH,
  ConnectInfoSchema,
  ScreenCountSchema,
  type ConnectInfo,
} from '@emberglass/shared';
import { DEFAULT_PORT } from '../config.js';
import { connectInfo, systemInterfaces, type NetworkInterfaces } from '../connect.js';

// GET /api/connect (LIV-03, specs/08-ux-journeys.md §5, D-112): what the DM view's "Connect a
// screen" panel shows, the player view's URL on each LAN address and the first one's QR code. It
// needs a DM session like every /api route (specs/02-architecture.md §5); the port is the one the
// server listens on, and the addresses are read at each request.
//
// GET /api/screens (UIX-01, specs/08-ux-journeys.md §11): how many player views are connected now, which
// the header's screens counter shows; the live socket counts its players room.
export function registerConnect(
  app: FastifyInstance,
  interfaces: NetworkInterfaces = systemInterfaces,
  playerViews: () => number = () => 0,
): void {
  app.get(API_SCREENS_PATH, { schema: { response: { 200: ScreenCountSchema } } }, () => ({ count: playerViews() }));
  app.get(API_CONNECT_PATH, { schema: { response: { 200: ConnectInfoSchema } } }, (_request, reply) => {
    const address = app.server.address();
    const port = address !== null && typeof address === 'object' ? address.port : DEFAULT_PORT;
    return reply.send(connectInfo(interfaces(), port) satisfies ConnectInfo);
  });
}
