// The redesign's icons (UIX-01, specs/08-ux-journeys.md §11), drawn from the design's own paths. Each is
// decoration: the control that carries it is named by its text or its aria-label, so every icon is
// hidden from assistive technology.

type IconName =
  | 'chevron'
  | 'stop'
  | 'screen'
  | 'settings'
  | 'plus'
  | 'minus'
  | 'onTv'
  | 'lock'
  | 'unlock'
  | 'select'
  | 'ruler'
  | 'ping'
  | 'fog'
  | 'brush'
  | 'eraser'
  | 'addToken'
  | 'undo'
  | 'redo'
  | 'fit'
  | 'eye'
  | 'eyeOff'
  | 'more'
  | 'drop'
  | 'setup'
  | 'grip'
  | 'info'
  | 'swords'
  | 'shield'
  | 'follow'
  | 'note'
  | 'download'
  | 'upload'
  | 'pencil'
  | 'trash'
  | 'arrowUp'
  | 'arrowDown'
  | 'maximize'
  | 'minimize'
  | 'pin'
  | 'sidebar'
  | 'reset';

const STROKED: Record<Exclude<IconName, 'stop' | 'more' | 'drop'>, readonly string[]> = {
  chevron: ['M6 9l6 6 6-6'],
  screen: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 21h8'],
  settings: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M14 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M8 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  onTv: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M8 21h8M10 9l4 2-4 2z'],
  lock: ['M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  select: ['M5 3l14 7-6 2-2 6z'],
  ruler: ['M3 17L17 3l4 4L7 21z', 'M7 13l2 2M10 10l2 2M13 7l2 2'],
  ping: ['M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0', 'M5.5 12a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0'],
  fog: ['M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.5 3.5 0 0 0 7 18z'],
  brush: ['M20 4L10 14', 'M10 14c-2-1-4 0-4.5 2S4 20 3 20c3 1 6 0 7-2.5s1-2.5 0-3.5z'],
  eraser: ['M8 20l-4-4L14 6l6 6-8 8z', 'M8 20h12M9 11l6 6'],
  addToken: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 8v8M8 12h8'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  fit: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  eyeOff: [
    'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  setup: ['M4 6h16M4 12h16M4 18h16', 'M9 4v4M15 10v4M7 16v4'],
  grip: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  info: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 11v5M12 8h.01'],
  // A crosshair: Follow my view, the TV keeping on the DM's view (DMT-03).
  follow: [
    'M12 2v4M12 18v4M2 12h4M18 12h4',
    'M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  // A page with lines: DM notes (DMT-04).
  note: ['M6 3h9l4 4v14H6z', 'M15 3v4h4', 'M9 12h6M9 16h6'],
  // The UI/UX refinements (UXR-01, UXR-04, UXR-05).
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 15V4', 'M7 9l5-5 5 5', 'M5 20h14'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14', 'M6 13l6 6 6-6'],
  maximize: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', 'M9 9l-5-5M15 9l5-5M9 15l-5 5M15 15l5 5'],
  minimize: ['M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'],
  pin: ['M9 4h6l-1 6 4 4H6l4-4z', 'M12 14v7'],
  sidebar: ['M4 5h16v14H4z', 'M9 5v14'],
  reset: ['M4 12a8 8 0 1 0 2.5-5.8', 'M4 4v4h4'],
  // A shield: a token's armour class (DMT-01).
  shield: ['M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z'],
  // Two crossed blades: the Enemies entry of the initiative order (TBL-06).
  swords: [
    'M14.5 17.5L3 6V3h3l11.5 11.5',
    'M13 19l6-6M16 16l4 4M19 21l2-2',
    'M9.5 6.5L13 3h3v3l-3.5 3.5',
    'M5 14l4 4M7 17l-3 3M3 19l2 2',
  ],
};

export function Icon({ name, size = 16, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false } as const;
  if (name === 'stop') {
    return (
      <svg {...common} fill="currentColor">
        <rect x="6" y="6" width="12" height="12" rx="1.5" />
      </svg>
    );
  }
  if (name === 'more') {
    return (
      <svg {...common} fill="currentColor">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    );
  }
  if (name === 'drop') {
    return (
      <svg {...common} fill="currentColor">
        <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
      </svg>
    );
  }
  return (
    <svg
      {...common}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'grip' ? 3 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {STROKED[name].map((d) => (
        <path key={d} d={d} />
      ))}
      {name === 'ping' ? <circle cx="12" cy="12" r="10" strokeDasharray="3 3" /> : null}
    </svg>
  );
}

export type { IconName };
