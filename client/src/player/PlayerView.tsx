import { useLive } from '../live/useLive.js';
import { IdleScreen } from '../ui/IdleScreen.js';

// Player view at / (FND-04, LIV-01): it keeps the live connection open, reconnecting by
// itself after sleep or a network loss and resynchronising from a fresh snapshot
// (specs/04-live-sync.md §5, §6). It still shows the idle screen only: drawing the live
// scene and hiding the cursor arrive with LIV-03 (specs/08-ux-journeys.md §4, §9). While
// reconnecting it keeps its last picture and says nothing, since nobody operates the TV
// and the idle screen shows the product name only (Q-025, D-104). The data attributes
// are for the end-to-end tests: the connection state and how many snapshots arrived.
export function PlayerView() {
  const live = useLive('player');
  return (
    <main data-view="player" data-live={live.status} data-snapshots={live.snapshots}>
      <IdleScreen />
    </main>
  );
}
