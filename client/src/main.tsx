import './ui/tokens.css';
import { boot } from './boot.js';

// One build serves both views; each view is its own chunk, so the player view
// never loads the DM view's code (specs/02-architecture.md §2, D-014). Until a
// view's chunk arrives, and if it cannot, the entry chunk shows that view's own
// loading or load-failure state (G-007, D-113). No top-level await: the TV's
// browser version is not known yet (GAPS.md G-002).
const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element.');

void boot(root, window.location.pathname);
