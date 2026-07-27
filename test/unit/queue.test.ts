import { describe, expect, it } from 'vitest';

import { createSerialQueue } from '../../src/worker/queue';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createSerialQueue', () => {
  it('runs tasks one at a time, in order', async () => {
    const queue = createSerialQueue();
    const started: number[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        queue.enqueue(async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          started.push(n);
          await wait(5);
          concurrent -= 1;
          return n * 10;
        })
      )
    );

    expect(maxConcurrent).toBe(1);
    expect(started).toEqual([1, 2, 3, 4, 5]);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('keeps running after a task rejects', async () => {
    const queue = createSerialQueue();

    const settled = await Promise.allSettled([
      queue.enqueue(async () => 'first'),
      queue.enqueue(async () => {
        await wait(1);
        throw new Error('boom');
      }),
      queue.enqueue(async () => 'last'),
    ]);

    expect(settled.map((s) => s.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((settled[2] as PromiseFulfilledResult<string>).value).toBe('last');
  });

  it('propagates the rejection to the enqueuer', async () => {
    const queue = createSerialQueue();
    await expect(
      queue.enqueue(() => Promise.reject(new Error('render failed')))
    ).rejects.toThrow('render failed');
  });
});
