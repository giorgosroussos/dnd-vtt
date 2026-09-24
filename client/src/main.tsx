import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import { loadGuardedView } from './views.js';

// One build serves both views; each view is its own chunk, so the player view
// never loads the DM view's code (specs/02-architecture.md §2, D-014). No
// top-level await: the TV's browser version is not known yet (GAPS.md G-002).
const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

void loadGuardedView(window.location.pathname).then((View) => {
  createRoot(root).render(
    <StrictMode>
      <View />
    </StrictMode>,
  );
});
