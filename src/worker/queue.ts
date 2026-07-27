/**
 * Serial task queue.
 *
 * The PlantUML engine shares internal state between renders — its own
 * GITHUB_INTEGRATION.md warns that concurrent renders silently overwrite
 * each other's results. Every render therefore goes through this queue,
 * one at a time. A failed task must not stall the tasks behind it.
 */
export interface SerialQueue {
  /** Runs `task` after all previously enqueued tasks have settled. */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      // Run on both fulfilment and rejection of the previous task so one
      // failure never blocks the rest of the queue.
      const result = tail.then(task, task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
