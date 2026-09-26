import { describe, expect, it } from 'vitest';
import { nextLabel, numberingPeers, numberOf, type LabelledToken } from './numbering.js';

// Automatic numbering (specs/05-assets-and-images.md §3, D-019, Q-063, Q-091), as a pure rule.

const tokens = (...labels: string[]): LabelledToken[] => labels.map((label, index) => ({ id: `t${index}`, label }));

describe('numberOf', () => {
  it('reads "<name> N" for a positive whole N only', () => {
    expect(numberOf('Goblin', 'Goblin 4')).toBe(4);
    expect(numberOf('Goblin', 'Goblin 12')).toBe(12);
    for (const label of [
      'Goblin',
      'Goblin 0',
      'Goblin 04',
      'Goblin 2.5',
      'Goblin -1',
      'Goblin 3 ',
      'Goblins 3',
      'Boss',
    ]) {
      expect(numberOf('Goblin', label), label).toBeUndefined();
    }
  });

  it('takes the name literally, whatever characters it holds', () => {
    expect(numberOf('Orc (big)', 'Orc (big) 2')).toBe(2);
    expect(numberOf('Orc.*', 'Orcxx 2')).toBeUndefined();
  });
});

describe('nextLabel', () => {
  it('gives the first token of an asset on a scene the bare name', () => {
    expect(nextLabel('Goblin', [], 0)).toEqual({ label: 'Goblin', issued: 1, relabel: undefined });
  });

  it('numbers the second as 2 and renames the lone bare token to 1', () => {
    expect(nextLabel('Goblin', tokens('Goblin'), 1)).toEqual({
      label: 'Goblin 2',
      issued: 2,
      relabel: { id: 't0', label: 'Goblin 1' },
    });
  });

  it('continues after the highest number: four goblins are Goblin 1 to Goblin 4', () => {
    const labels: string[] = [];
    let issued = 0;
    for (let each = 0; each < 4; each++) {
      const next = nextLabel('Goblin', tokens(...labels), issued);
      if (next.relabel) labels[Number(next.relabel.id.slice(1))] = next.relabel.label;
      labels.push(next.label);
      issued = next.issued;
    }
    expect(labels).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3', 'Goblin 4']);
  });

  it('never reuses a freed number, the highest included (Q-063, Q-091)', () => {
    // Goblin 2 and Goblin 4 were deleted; 4 was issued.
    expect(nextLabel('Goblin', tokens('Goblin 1', 'Goblin 3'), 4).label).toBe('Goblin 5');
    // Every goblin was deleted.
    expect(nextLabel('Goblin', [], 4)).toEqual({ label: 'Goblin 5', issued: 5, relabel: undefined });
  });

  it('numbers a new token after a deleted lone one, which had the bare name (Q-091)', () => {
    expect(nextLabel('Goblin', [], 1)).toEqual({ label: 'Goblin 2', issued: 2, relabel: undefined });
  });

  it('continues after the labels of a scene numbered before the number was stored', () => {
    expect(nextLabel('Goblin', tokens('Goblin 1', 'Goblin 2', 'Goblin 3'), 0)).toMatchObject({
      label: 'Goblin 4',
      issued: 4,
    });
    expect(nextLabel('Goblin', tokens('Goblin'), 0)).toEqual({
      label: 'Goblin 2',
      issued: 2,
      relabel: { id: 't0', label: 'Goblin 1' },
    });
  });

  it('continues after a number the DM typed, so numbering never gives two tokens one label', () => {
    expect(nextLabel('Goblin', tokens('Goblin 1', 'Goblin 9'), 2).label).toBe('Goblin 10');
  });

  it('leaves a token the DM relabelled alone', () => {
    expect(nextLabel('Goblin', tokens('Boss'), 1)).toEqual({ label: 'Goblin 2', issued: 2, relabel: undefined });
  });

  it('never gives a freed 1 again: a token renamed to the bare name after the first was deleted keeps it (review)', () => {
    // "Goblin" was deleted, "Goblin 2" placed and renamed "Goblin" by the DM.
    expect(nextLabel('Goblin', tokens('Goblin'), 2)).toEqual({ label: 'Goblin 3', issued: 3, relabel: undefined });
  });

  it('renames the bare token only when it is the one bare token and "<name> 1" is free', () => {
    expect(nextLabel('Goblin', tokens('Goblin', 'Goblin 1'), 1).relabel).toBeUndefined();
    expect(nextLabel('Goblin', tokens('Goblin', 'Goblin'), 1).relabel).toBeUndefined();
  });
});

describe('numberingPeers (Q-092)', () => {
  it('counts every visible token and a hidden one only when it carries a number of the name (Q-094)', () => {
    const all = [
      { id: 'a', label: 'Goblin', hidden: true },
      { id: 'b', label: 'Goblin', hidden: false },
      { id: 'c', label: 'Goblin 2', hidden: true },
      { id: 'd', label: 'Boss', hidden: true },
      { id: 'e', label: 'Boss', hidden: false },
      { id: 'f', label: 'Hobgoblin 3', hidden: true },
    ];
    expect(numberingPeers('Goblin', all).map((token) => token.id)).toEqual(['b', 'c', 'e']);
  });

  it('gives the first goblin shown the bare name beside a hidden one the DM relabelled (Q-094)', () => {
    const peers = numberingPeers('Goblin', [{ id: 'd', label: 'Boss', hidden: true }]);
    expect(nextLabel('Goblin', peers, 0).label).toBe('Goblin');
  });
});
