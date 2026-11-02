import { describe, expect, it } from 'vitest';

import { RETRY_FOR, replaceFile, type ReplaceDeps } from '../../src/export/rename';

/** An error as Node's file system gives it. */
function failure(code: string): Error {
  return Object.assign(new Error(`${code}: rename failed`), { code });
}

/**
 * Deps whose own rename gives `outcomes` in turn, an error rejecting and
 * undefined resolving, then the last one again; whose clock moves only by
 * the waits; and that say what was done, in order.
 */
function makeDeps(
  outcomes: readonly (Error | string | undefined)[],
  windows = true
): ReplaceDeps & { log: string[]; waits: number[] } {
  const log: string[] = [];
  const waits: number[] = [];
  let time = 0;
  let tries = 0;
  return {
    log,
    waits,
    windows,
    rename: () => {
      const outcome = outcomes[Math.min(tries, outcomes.length - 1)];
      tries += 1;
      log.push('rename');
      return outcome === undefined ? Promise.resolve() : Promise.reject(outcome);
    },
    wait: (ms) => {
      waits.push(ms);
      time += ms;
      return Promise.resolve();
    },
    now: () => time,
    refuseFolder: () => {
      log.push('refuseFolder');
      return Promise.resolve();
    },
    fallback: () => {
      log.push('fallback');
      return Promise.resolve();
    },
  };
}

describe('replaceFile', () => {
  it("renames with the file system's own rename, and nothing else, when that works", async () => {
    const deps = makeDeps([undefined]);

    await replaceFile(deps);

    expect(deps.log).toEqual(['rename']);
    expect(deps.waits).toEqual([]);
  });

  it.each(['EACCES', 'EBUSY', 'EPERM'])('tries again on Windows while %s says a file is in use', async (code) => {
    const deps = makeDeps([failure(code), failure(code), undefined]);

    await replaceFile(deps);

    expect(deps.log).toEqual(['rename', 'rename', 'rename']);
    expect(deps.waits).toEqual([0, 10]);
  });

  it("waits 10 ms longer each time, up to 100 ms, and leaves the file to VS Code's rename after a second", async () => {
    const deps = makeDeps([failure('EPERM')]);

    await replaceFile(deps);

    expect(deps.waits).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 100, 100, 100, 100, 100]);
    expect(deps.waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(RETRY_FOR);
    expect(deps.log.filter((step) => step === 'rename')).toHaveLength(17);
    // Asked about a folder only once the file system's rename gave up, and
    // before VS Code's rename, which would delete one.
    expect(deps.log.slice(-2)).toEqual(['refuseFolder', 'fallback']);
  });

  it('gives up once the time to try again for has passed, not after it', async () => {
    const deps = makeDeps([failure('EBUSY')]);
    const times = [0, RETRY_FOR - 1, RETRY_FOR];
    deps.now = () => times.shift() ?? RETRY_FOR;

    await replaceFile(deps);

    expect(deps.log).toEqual(['rename', 'rename', 'refuseFolder', 'fallback']);
    expect(deps.waits).toEqual([0]);
  });

  it("tries no more than once elsewhere than on Windows, where a file in use does not stop a rename", async () => {
    const deps = makeDeps([failure('EPERM')], false);

    await replaceFile(deps);

    expect(deps.log).toEqual(['rename', 'refuseFolder', 'fallback']);
    expect(deps.waits).toEqual([]);
  });

  it.each([
    ['ENOENT', failure('ENOENT')],
    ['EISDIR', failure('EISDIR')],
    ['EXDEV', failure('EXDEV')],
    ['an error without a code', new Error('rename failed')],
    ['something not an error', 'rename failed'],
  ])("leaves the file to VS Code's rename at once after %s", async (_name, outcome) => {
    const deps = makeDeps([outcome]);

    await replaceFile(deps);

    expect(deps.log).toEqual(['rename', 'refuseFolder', 'fallback']);
    expect(deps.waits).toEqual([]);
  });

  it("does not leave the file to VS Code's rename when a folder has taken its place", async () => {
    const deps = makeDeps([failure('EPERM')], false);
    const refusal = new Error('Cannot save to images/orders.svg because a folder with that name already exists.');
    deps.refuseFolder = () => {
      deps.log.push('refuseFolder');
      return Promise.reject(refusal);
    };

    await expect(replaceFile(deps)).rejects.toBe(refusal);
    expect(deps.log).toEqual(['rename', 'refuseFolder']);
  });

  it("rejects with VS Code's reason when its rename fails too, as before", async () => {
    const deps = makeDeps([failure('ENOENT')]);
    const reason = new Error('Unable to move');
    deps.fallback = () => Promise.reject(reason);

    await expect(replaceFile(deps)).rejects.toBe(reason);
  });
});
