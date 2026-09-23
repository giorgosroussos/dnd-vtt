import { describe, expect, it } from 'vitest';
import { createVersionCounter, liveVersion } from './version.js';

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

  it('has one process counter that no import has advanced', () => {
    expect(liveVersion.current()).toBe(0);
  });
});
