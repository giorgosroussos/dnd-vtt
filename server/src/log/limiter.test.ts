import { describe, expect, it } from 'vitest';
import { createLineLimiter } from './limiter.js';

describe('rejected-request line limit (G-006)', () => {
  const setup = (perAddress: number, total: number) => {
    let time = 0;
    const timers: { run: () => void; ms: number }[] = [];
    const summaries: { dropped: number; addresses: { address: string; dropped: number }[] }[] = [];
    const limiter = createLineLimiter({
      perAddress,
      total,
      windowMs: 60_000,
      onDropped: (dropped, addresses) => summaries.push({ dropped, addresses }),
      now: () => time,
      schedule: (run, ms) => timers.push({ run, ms }),
    });
    return { limiter, timers, summaries, advance: (ms: number) => (time += ms) };
  };

  it('admits a number of lines per address and in total within a window, and reports the rest once', () => {
    const { limiter, timers, summaries } = setup(3, 5);
    const admitted = ['a', 'a', 'a', 'a', 'a', 'b', 'b', 'c', 'c'].map((address) => limiter.admit(address));
    expect(admitted).toEqual([true, true, true, false, false, true, true, false, false]);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(60_000);
    timers[0]!.run();
    expect(summaries).toEqual([
      {
        dropped: 4,
        addresses: [
          { address: 'a', dropped: 2 },
          { address: 'c', dropped: 2 },
        ],
      },
    ]);
  });

  it('starts afresh in the next window, reporting the last one first', () => {
    const { limiter, timers, summaries, advance } = setup(1, 10);
    expect([limiter.admit('a'), limiter.admit('a')]).toEqual([true, false]);
    advance(60_000);
    expect(limiter.admit('a')).toBe(true);
    expect(summaries).toEqual([{ dropped: 1, addresses: [{ address: 'a', dropped: 1 }] }]);
    // The timer of the finished window does not report it twice.
    timers[0]!.run();
    expect(summaries).toHaveLength(1);
  });

  it('writes no summary for a window that dropped nothing', () => {
    const { limiter, timers, summaries } = setup(5, 5);
    limiter.admit('a');
    limiter.flush();
    expect([timers.length, summaries.length]).toEqual([0, 0]);
  });
});
