import { useId } from 'react';

// The Emberglass mark: a faceted ember crystal, drawn from the brand's own logo and favicon files. Below
// 48 px it takes the favicon's eight facets, which hold up small; larger, the logo's eleven. Its colours are
// its own, not the theme's accent. Decoration: the wordmark beside it carries the name.

type Facet = readonly [points: string, fill: string];

const GRADIENTS: Record<string, readonly [x1: number, y1: number, x2: number, y2: number, from: string, to: string]> = {
  dark: [0, 0, 1, 1, '#3e0d1c', '#9b2216'],
  orange: [0, 0, 1, 1, '#c43a18', '#f58a26'],
  gold: [0, 0, 1, 1, '#ffedaa', '#ff9f2c'],
  red: [0, 0, 1, 1, '#e8681e', '#a72c18'],
  redor: [0, 0, 1, 1, '#7d1915', '#d04818'],
  amber: [0, 0, 1, 1, '#e05a1c', '#ffb540'],
  deep: [1, 0, 0, 1, '#d8581c', '#741612'],
  core: [0, 0, 0, 1, '#ffc040', '#fff4c0'],
  or2: [0, 0, 1, 1, '#e2601c', '#ffb53a'],
  right: [0, 0, 1, 1, '#f39a2c', '#c23e18'],
  gold2: [1, 0, 0, 1, '#ff962c', '#ffd458'],
};

const SMALL: readonly Facet[] = [
  ['131,0 0,198 96,262', 'redor'],
  ['131,0 96,262 150,212', 'amber'],
  ['131,0 150,212 246,212 238,150', 'gold'],
  ['0,198 44,338 96,262', 'deep'],
  ['96,262 150,212 130,440', 'core'],
  ['44,338 96,262 130,440', 'or2'],
  ['150,212 246,212 190,342', 'right'],
  ['150,212 190,342 130,440', 'gold2'],
];

const LARGE: readonly Facet[] = [
  ['131,0 0,198 78,128', 'dark'],
  ['131,0 78,128 150,212', 'orange'],
  ['131,0 150,212 238,150', 'gold'],
  ['238,150 150,212 246,212', 'red'],
  ['0,198 78,128 96,262', 'redor'],
  ['78,128 150,212 96,262', 'amber'],
  ['0,198 96,262 44,338', 'deep'],
  ['96,262 150,212 130,440', 'core'],
  ['44,338 96,262 130,440', 'or2'],
  ['150,212 246,212 190,342', 'right'],
  ['150,212 190,342 130,440', 'gold2'],
];

const OUTLINE = '131,0 238,150 246,212 190,342 130,440 44,338 0,198';

export function Logo({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  const small = size < 48;
  const facets = small ? SMALL : LARGE;
  return (
    // A square box around the 246 × 440 crystal, its outline's stroke included.
    <svg width={size} height={size} viewBox="-107 -10 460 460" aria-hidden="true" focusable="false">
      <defs>
        {[...new Set(facets.map(([, fill]) => fill))].map((name) => {
          const [x1, y1, x2, y2, from, to] = GRADIENTS[name]!;
          return (
            <linearGradient key={name} id={`${id}-${name}`} x1={x1} y1={y1} x2={x2} y2={y2}>
              <stop offset="0" stopColor={from} />
              <stop offset="1" stopColor={to} />
            </linearGradient>
          );
        })}
        <radialGradient id={`${id}-inner`} cx="0.52" cy="0.68" r="0.45">
          <stop offset="0" stopColor="#fff4c0" stopOpacity="0.2" />
          <stop offset="1" stopColor="#ffb030" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g strokeLinejoin="round">
        {facets.map(([points, fill]) => (
          <polygon key={points} points={points} fill={`url(#${id}-${fill})`} />
        ))}
        <g fill="none" stroke="#ffe7a0" strokeOpacity={small ? 0.6 : 0.45} strokeWidth={small ? 7 : 3}>
          {facets.map(([points]) => (
            <polygon key={points} points={points} />
          ))}
        </g>
        <polygon points={OUTLINE} fill={`url(#${id}-inner)`} />
        <polygon points={OUTLINE} fill="none" stroke="#ffcf6a" strokeWidth={small ? 14 : 6} />
      </g>
    </svg>
  );
}
