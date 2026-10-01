// The redesign's icons (UIX-01, specs/08-ux-journeys.md §11), drawn from the design's own paths. Each is
// decoration: the control that carries it is named by its text or its aria-label, so every icon is
// hidden from assistive technology.

type IconName =
  | 'logo'
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
  | 'info';

const STROKED: Record<Exclude<IconName, 'stop' | 'more' | 'drop'>, readonly string[]> = {
  logo: ['M12 2l6 8-6 12-6-12z', 'M12 2v20M6 10h12'],
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
