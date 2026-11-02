import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveSync, stopsToTell, watchedFiles, type SyncOutcome, type SyncStop } from '../../src/export/auto-sync';
import type { InputManifest } from '../../src/export/manifest';

const DELAY = 500;
const current: SyncOutcome = { state: 'current', written: true };

/** A run that ends when the test says, by the id it was given. */
function gatedRuns(): {
  run: (id: string) => Promise<SyncOutcome>;
  started: string[];
  finish: (id: string, outcome?: SyncOutcome) => Promise<void>;
} {
  const started: string[] = [];
  const pending = new Map<string, (outcome: SyncOutcome) => void>();
  return {
    run: (id) => {
      started.push(id);
      return new Promise<SyncOutcome>((resolve) => {
        pending.set(id, resolve);
      });
    },
    started,
    finish: async (id, outcome = current) => {
      const resolve = pending.get(id);
      pending.delete(id);
      resolve?.(outcome);
      // Lets the queue take its next turn.
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

describe('SaveSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports a diagram once its files have not been saved again for the delay', async () => {
    const run = vi.fn(() => Promise.resolve(current));
    const sync = new SaveSync(DELAY, run, () => undefined, () => current);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(300);
    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(499);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('a');
  });

  it('exports one diagram at a time, in the order their turns came', async () => {
    const runs = gatedRuns();
    const sync = new SaveSync(DELAY, runs.run, () => undefined, () => current);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(100);
    sync.schedule('b');
    sync.schedule('c');
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(runs.started).toEqual(['a']);
    await runs.finish('a');
    expect(runs.started).toEqual(['a', 'b']);
    await runs.finish('b');
    await runs.finish('c');
    expect(runs.started).toEqual(['a', 'b', 'c']);
  });

  it('exports a diagram saved again while it is exported once more afterwards, however often it was saved', async () => {
    const runs = gatedRuns();
    const sync = new SaveSync(DELAY, runs.run, () => undefined, () => current);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(DELAY);
    for (let save = 0; save < 5; save += 1) {
      sync.schedule('a');
      await vi.advanceTimersByTimeAsync(DELAY);
    }
    expect(runs.started).toEqual(['a']);
    await runs.finish('a');
    expect(runs.started).toEqual(['a', 'a']);
    await runs.finish('a');
    await vi.advanceTimersByTimeAsync(DELAY * 4);
    expect(runs.started).toEqual(['a', 'a']);
  });

  it('keeps a diagram waiting once, whatever number of times its turn comes before it starts', async () => {
    const runs = gatedRuns();
    const sync = new SaveSync(DELAY, runs.run, () => undefined, () => current);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY);
    await runs.finish('a');
    await runs.finish('b');
    expect(runs.started).toEqual(['a', 'b']);
  });

  it('tries nothing again on its own, whatever came of an export', async () => {
    const run = vi.fn((): Promise<SyncOutcome> => Promise.resolve({ state: 'blocked', reason: 'export:source', name: 'a', message: 'error' }));
    const sync = new SaveSync(DELAY, run, () => undefined, () => current);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(DELAY * 20);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tells what came of the exports once none is running, waiting or due, all at once', async () => {
    const runs = gatedRuns();
    const report = vi.fn();
    const sync = new SaveSync(DELAY, runs.run, report, () => current);
    const stopped: SyncOutcome = { state: 'conflict', reason: 'output:edited', name: 'b', message: 'edited' };

    sync.schedule('a');
    sync.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY);
    await runs.finish('a');
    // Saved again before the queue is empty: told once that is done too.
    sync.schedule('a');
    await runs.finish('b', stopped);
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DELAY);
    await runs.finish('a');
    expect(report).toHaveBeenCalledTimes(1);
    expect([...(report.mock.calls[0]?.[0] as ReadonlyMap<string, SyncOutcome>)]).toEqual([
      ['a', current],
      ['b', stopped],
    ]);
  });

  it('tells what failed outright as `failed` says', async () => {
    const report = vi.fn();
    const failed: SyncOutcome = { state: 'blocked', reason: 'error', name: 'a', message: 'broke' };
    const sync = new SaveSync(DELAY, () => Promise.reject(new Error('broke')), report, () => failed);

    sync.schedule('a');
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(report).toHaveBeenCalledWith(new Map([['a', failed]]));
  });

  it('drops what was due or waiting once cancelled, and does not export one running again', async () => {
    const runs = gatedRuns();
    const report = vi.fn();
    const sync = new SaveSync(DELAY, runs.run, report, () => current);

    sync.schedule('a');
    sync.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.schedule('a');
    sync.schedule('c');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.schedule('c');
    sync.cancel('a');
    sync.cancel('b');
    sync.cancel('c');
    await runs.finish('a');
    await vi.advanceTimersByTimeAsync(DELAY * 4);
    expect(runs.started).toEqual(['a']);
    expect(report).toHaveBeenCalledWith(new Map([['a', current]]));
  });

  it('keeps only what `retain` keeps', async () => {
    const runs = gatedRuns();
    const sync = new SaveSync(DELAY, runs.run, () => undefined, () => current);

    sync.schedule('a');
    sync.schedule('b');
    sync.schedule('c');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.retain((id) => id !== 'b');
    await runs.finish('a');
    await runs.finish('c');
    expect(runs.started).toEqual(['a', 'c']);
  });

  it('tells what was noted with what the exports came to, or at once when none is running, waiting or due', async () => {
    const runs = gatedRuns();
    const report = vi.fn();
    const sync = new SaveSync(DELAY, runs.run, report, () => current);
    const ended: SyncOutcome = { state: 'disabled', reason: 'gone', name: 'b', message: 'gone' };

    sync.note('b', ended);
    expect(report).toHaveBeenLastCalledWith(new Map([['b', ended]]));
    sync.schedule('a');
    sync.note('b', ended);
    expect(report).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DELAY);
    await runs.finish('a');
    expect(report).toHaveBeenLastCalledWith(
      new Map<string, SyncOutcome>([
        ['b', ended],
        ['a', current],
      ])
    );
  });

  it('tells of a permission noted as ended while its diagram was exported, whatever the export came to', async () => {
    const runs = gatedRuns();
    const report = vi.fn();
    const sync = new SaveSync(DELAY, runs.run, report, () => current);
    const ended: SyncOutcome = { state: 'disabled', reason: 'gone', name: 'a', message: 'gone' };
    const outcomes: SyncOutcome[] = [{ state: 'skipped' }, { state: 'stale' }, current];

    for (const outcome of outcomes) {
      const calls = report.mock.calls.length;
      sync.schedule('a');
      await vi.advanceTimersByTimeAsync(DELAY);
      // Ended as it is exported: the export goes on to its end.
      sync.cancel('a');
      sync.note('a', ended);
      expect(report).toHaveBeenCalledTimes(calls);
      await runs.finish('a', outcome);
      expect(report).toHaveBeenCalledTimes(calls + 1);
      expect(report).toHaveBeenLastCalledWith(new Map([['a', ended]]));
    }
  });

  it('runs and tells nothing once disposed', async () => {
    const runs = gatedRuns();
    const report = vi.fn();
    const sync = new SaveSync(DELAY, runs.run, report, () => current);

    sync.schedule('a');
    sync.schedule('b');
    await vi.advanceTimersByTimeAsync(DELAY);
    sync.dispose();
    await runs.finish('a');
    sync.schedule('c');
    sync.note('d', current);
    await vi.advanceTimersByTimeAsync(DELAY * 4);
    expect(runs.started).toEqual(['a']);
    expect(report).not.toHaveBeenCalled();
  });
});

describe('what is told of exports on save', () => {
  const stop = (state: SyncStop['state'], reason: string, name = 'orders'): SyncStop => ({ state, reason, name, message: `${name}: ${reason}` });

  it('tells each diagram stopped once, until it is exported again or stops for another reason', () => {
    const told = new Map<string, string>();
    const edited = stop('conflict', 'output:edited');

    expect(stopsToTell(new Map([['a', edited]]), told)).toEqual([edited]);
    expect(stopsToTell(new Map([['a', edited]]), told)).toEqual([]);
    const error = stop('blocked', 'export:source');
    expect(stopsToTell(new Map([['a', error]]), told)).toEqual([error]);
    expect(stopsToTell(new Map<string, SyncOutcome>([['a', { state: 'current', written: false }]]), told)).toEqual([]);
    expect(stopsToTell(new Map([['a', error]]), told)).toEqual([error]);
  });

  it('tells nothing of an export not tried, nor of one a save takes care of', () => {
    const told = new Map<string, string>();
    const quiet = new Map<string, SyncOutcome>([
      ['a', { state: 'skipped' }],
      ['b', { state: 'stale' }],
      ['c', { state: 'current', written: true }],
    ]);

    expect(stopsToTell(quiet, told)).toEqual([]);
    expect(told.size).toBe(0);
  });

  it('tells of a permission ended, and forgets it, as it does not come back', () => {
    const told = new Map<string, string>();
    const gone = stop('disabled', 'gone');

    expect(stopsToTell(new Map([['a', stop('blocked', 'output:missing')]]), told)).toHaveLength(1);
    expect(stopsToTell(new Map([['a', gone]]), told)).toEqual([gone]);
    expect(told.has('a')).toBe(false);
  });

  it('tells each diagram of many in the order they came', () => {
    const told = new Map<string, string>();
    const outcomes = new Map<string, SyncOutcome>([
      ['a', stop('conflict', 'output:edited', 'orders')],
      ['b', { state: 'current', written: true }],
      ['c', stop('blocked', 'incomplete', 'billing')],
    ]);

    expect(stopsToTell(outcomes, told).map(({ name }) => name)).toEqual(['orders', 'billing']);
  });
});

describe('the files whose saving exports a diagram again', () => {
  const manifest = (requests: { file: string | null; looked: string[] }[]): InputManifest =>
    ({
      resources: {
        requests: requests.map(({ file, looked }) => ({ path: 'x', from: null, kind: 'include', outcome: file === null ? 'missing' : 'read', file, looked })),
        files: [],
        libraries: [],
      },
    }) as unknown as InputManifest;
  const lower = (path: string): string => path.toLowerCase();

  it('are where its last export looked for the files it includes, a file read there or not', () => {
    const input = manifest([
      { file: 'C:\\ws\\Common.puml', looked: ['C:\\ws\\docs\\Common.puml'] },
      { file: null, looked: ['C:\\ws\\docs\\later.puml', 'C:\\ws\\lib\\later.puml'] },
    ]);

    expect([...watchedFiles(input, [], lower)]).toEqual([
      'c:\\ws\\docs\\common.puml',
      'c:\\ws\\common.puml',
      'c:\\ws\\docs\\later.puml',
      'c:\\ws\\lib\\later.puml',
    ]);
  });

  it('take in where an export since that wrote nothing looked, and are none without either', () => {
    const input = manifest([{ file: '/ws/common.puml', looked: [] }]);

    expect([...watchedFiles(input, ['/ws/new.puml', '/ws/common.puml'], lower)]).toEqual(['/ws/common.puml', '/ws/new.puml']);
    expect([...watchedFiles(undefined, ['/ws/new.puml'], lower)]).toEqual(['/ws/new.puml']);
    expect(watchedFiles(undefined, [], lower).size).toBe(0);
  });
});
