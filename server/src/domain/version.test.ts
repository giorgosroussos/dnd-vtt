import { describe, expect, it } from 'vitest';
import { createVersionCounter, createVersionCounters, liveVersions } from './version.js';

describe('the live version counter', () => {
  it('starts at 1 and strictly ascends by one', () => {
    const counter = createVersionCounter();
    expect(counter.current()).toBe(0);
    const versions = Array.from({ length: 1_000 }, () => counter.next());
    expect(versions[0]).toBe(1);
    for (let index = 1; index < versions.length; index++) {
      expect(versions[index]).toBe(versions[index - 1]! + 1);
    }
    expect(counter.current()).toBe(1_000);
  });

  it('reading the current version never advances it', () => {
    const counter = createVersionCounter();
    counter.current();
    counter.current();
    expect(counter.next()).toBe(1);
  });

  it('starts every counter at 1, as a server restart does (specs/04-live-sync.md §5, Q-056)', () => {
    const before = createVersionCounter();
    before.next();
    before.next();
    expect(createVersionCounter().next()).toBe(1);
  });

  it('has one counter per room that no import has advanced (Q-093)', () => {
    expect(Object.keys(liveVersions).sort()).toEqual(['dm', 'players']);
    expect(liveVersions.dm.current()).toBe(0);
    expect(liveVersions.players.current()).toBe(0);
  });

  it('keeps the rooms apart: an event counted for dm leaves the players sequence unbroken (Q-093)', () => {
    const counters = createVersionCounters();
    counters.dm.next(); // seen by both rooms
    counters.players.next();
    counters.dm.next(); // a hidden token moved: dm only
    counters.dm.next(); // seen by both rooms
    counters.players.next();
    expect([counters.dm.current(), counters.players.current()]).toEqual([3, 2]);
  });
});
