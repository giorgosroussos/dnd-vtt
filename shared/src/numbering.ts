// Automatic token numbering (specs/05-assets-and-images.md §3, D-019, Q-063, Q-091, Q-092), free
// of the database so that it is tested on its own, LIV-02's `token.add` numbers the same way, and
// the DM view's test server numbers as the real one does. Numbering is per scene and per asset.
// The first token of an asset shown on a scene carries the asset's bare name; when a second is
// shown, a token still carrying the bare name becomes "<name> 1" and the new one "<name> 2". A
// number once issued on the scene is never issued again, the highest included, so `issued` is
// stored with the scene (Q-091): after "Goblin" alone is deleted, the next Goblin is "Goblin 2". A
// token placed hidden takes the bare name and is numbered only when it is first shown to players
// (Q-092): callers number a hidden placement not at all, and pass `numberingPeers` of the scene's
// tokens of the asset.

export interface LabelledToken {
  id: string;
  label: string;
}

/**
 * The tokens of an asset on a scene that numbering counts (Q-092, Q-094): every visible token, and a
 * hidden one only when it carries a number of this name ("<name> N"), that is, one numbered when it
 * was shown and hidden again. A hidden token with the bare name or a label the DM typed ("Boss")
 * takes no part, so that no label ever depends on a token players have not seen numbered.
 */
export function numberingPeers<T extends LabelledToken & { hidden: boolean }>(name: string, tokens: readonly T[]): T[] {
  return tokens.filter((token) => !token.hidden || numberOf(name, token.label) !== undefined);
}

export interface Numbering {
  /** The new token's label. */
  label: string;
  /** The highest number issued on the scene for the asset, to store. */
  issued: number;
  /** A token whose label changes: the lone token that carried the bare name. */
  relabel: LabelledToken | undefined;
}

/** The number `label` carries as "<name> N", N a positive integer written without leading zeros. */
export function numberOf(name: string, label: string): number | undefined {
  const prefix = `${name} `;
  if (!label.startsWith(prefix)) return undefined;
  const rest = label.slice(prefix.length);
  return /^[1-9][0-9]{0,8}$/.test(rest) ? Number(rest) : undefined;
}

/**
 * The label of a new token of the asset named `name`, given the scene's tokens of that asset and
 * the highest number stored as issued. The labels are read too: a scene numbered before the
 * number was stored, or a token the DM relabelled "Goblin 7", continues after the highest one
 * shown, so two tokens never end up with one label by numbering.
 */
export function nextLabel(name: string, existing: readonly LabelledToken[], issued: number): Numbering {
  const shown = existing.map((token) => numberOf(name, token.label) ?? 0);
  const highest = Math.max(issued, existing.length > 0 ? 1 : 0, ...shown);
  if (highest === 0) return { label: name, issued: 1, relabel: undefined };
  const next = highest + 1;
  const bare = existing.filter((token) => token.label === name);
  const oneTaken = existing.some((token) => token.label === `${name} 1`);
  // Only the first token ever placed keeps a claim on number 1: once more were issued, a token the
  // DM renamed to the bare name is left alone, or a freed 1 would be issued again (Q-091).
  const first = issued <= 1 && shown.every((each) => each <= 1);
  const relabel = first && bare.length === 1 && !oneTaken ? { id: bare[0]!.id, label: `${name} 1` } : undefined;
  return { label: `${name} ${next}`, issued: next, relabel };
}
