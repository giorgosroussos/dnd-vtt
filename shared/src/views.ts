// The two views and where they are served (specs/02-architecture.md §2, D-014).
export const VIEW_PATHS = {
  player: '/',
  dm: '/dm',
} as const;

export type View = keyof typeof VIEW_PATHS;

// `/dm` and anything below it is the DM view; every other path the server
// serves the client for is the player view.
export function viewForPath(pathname: string): View {
  const dm = VIEW_PATHS.dm;
  return pathname === dm || pathname.startsWith(`${dm}/`) ? 'dm' : 'player';
}
