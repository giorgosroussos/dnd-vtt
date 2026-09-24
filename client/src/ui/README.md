# ui

Shared components, design tokens and the message catalogue (`specs/02-architecture.md` §1, `specs/08-ux-journeys.md` §6, §8). FND-04; D-069, D-073, D-071, D-072.

- `tokens.css`: the palette, type, spacing and the one focus ring; imports the bundled font.
- `messages/en.json` and `messages.ts`: every UI string, read through `t(key, params)`. Writing UI text anywhere else fails `messages.test.tsx`.
- `Button`, `TextField`, `Notice`, `SkipLink`, `ErrorBoundary`: native elements first, so the keyboard works without extra code. `DmErrorScreen` and `IdleScreen` are the views' fallbacks.
- `testing/`: test tooling only (the UI text scanner and a jsdom render helper); never bundled.
