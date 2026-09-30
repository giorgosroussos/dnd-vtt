// The redesign's palette for what the canvas draws (UIX-01, specs/08-ux-journeys.md §11). Konva paints
// on a canvas and cannot read CSS variables, so the values of ui/tokens.css the canvas needs are repeated
// here, each named after its variable; theme.test.ts fails when the two disagree, so the palette is still
// defined once in effect.

export const THEME = {
  bg: '#13100d',
  panel: '#1a1612',
  canvas: '#0e0c0a',
  text: '#ede3cf',
  textMuted: '#c9bba4',
  accent: '#e8913a',
  onAccent: '#1a120a',
  live: '#f2826b',
  hidden: '#8fb3d9',
  hiddenText: '#bfd2e6',
  playerBg: '#0a0806',
  playerText: '#f4ecdc',
  tokenPc: '#f0cd86',
  tokenPcFill: '#2a2119',
  tokenMonster: '#e0533d',
  tokenMonsterFill: '#2a1712',
  tokenOther: '#c9bba4',
  tokenOtherFill: '#221d18',
  bloodied: '#c8402c',
  concentrating: '#c7aef5',
  ping: '#ffb35c',
} as const;

/** Which CSS variable of tokens.css each value of THEME repeats. */
export const THEME_VARIABLES: Record<keyof typeof THEME, string> = {
  bg: '--color-bg',
  panel: '--color-panel',
  canvas: '--color-canvas',
  text: '--color-text',
  textMuted: '--color-text-muted',
  accent: '--color-accent',
  onAccent: '--color-on-accent',
  live: '--color-live',
  hidden: '--color-hidden',
  hiddenText: '--color-hidden-text',
  playerBg: '--color-player-bg',
  playerText: '--color-player-text',
  tokenPc: '--color-token-pc',
  tokenPcFill: '--color-token-pc-fill',
  tokenMonster: '--color-token-monster',
  tokenMonsterFill: '--color-token-monster-fill',
  tokenOther: '--color-token-other',
  tokenOtherFill: '--color-token-other-fill',
  bloodied: '--color-bloodied',
  concentrating: '--color-concentrating',
  ping: '--color-ping',
};

/** The fonts the canvas writes with: the same bundled families as the page (tokens.css). */
export const CANVAS_FONT = "'Alegreya Sans', 'Segoe UI', sans-serif";
export const TITLE_FONT = "'Alegreya', Georgia, serif";
