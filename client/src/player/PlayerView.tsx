import { IdleScreen } from '../ui/IdleScreen.js';

// Player view shell at / (FND-04): the idle screen. Switching to the live scene
// and hiding the cursor arrive with LIV-03 (specs/08-ux-journeys.md §4, §9).
export function PlayerView() {
  return (
    <main data-view="player">
      <IdleScreen />
    </main>
  );
}
