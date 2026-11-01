import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INCLUDE_LIMITS } from '../../src/core/constants';
import { recheckInputs, type DrawnFrom } from '../../src/export/recheck';
import { contextOf, IncludeSession, inputRequestsOf, type IncludeAccess } from '../../src/includes/session';
import { ReadSnapshot } from '../../src/includes/snapshot';

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A request of the engine: the file a directive names, and the file it is written in, or null for the diagram. */
interface Asked {
  path: string;
  from: string | null;
}

describe('recheckInputs', () => {
  let temp: string;
  let root: string;
  let docs: string;
  let lib: string;
  let access: IncludeAccess;
  const closed = (): undefined => undefined;
  const DIAGRAM = '!include part.iuml\n';

  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-recheck-')));
    root = join(temp, 'ws');
    docs = join(root, 'docs');
    lib = join(root, 'lib');
    await mkdir(docs, { recursive: true });
    await mkdir(lib, { recursive: true });
    await writeFile(join(lib, 'part.iuml'), 'Alice -> Bob\n');
    // The diagram is in docs/, and a bare name is looked for in lib/ too.
    access = { available: true, scope: { root, documentFolder: docs, searchFolders: [lib] } };
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  /**
   * What an export says a drawing of `source` was drawn from, the engine
   * asking for `asked`: each request answered as a drawing answers it,
   * through the reads of the export, an open document read as `openText`
   * gives it.
   */
  const drawnFrom = async (
    source: string,
    asked: readonly Asked[],
    openText: (path: string) => string | undefined = closed
  ): Promise<DrawnFrom> => {
    const snapshot = new ReadSnapshot(() => []);
    const session = new IncludeSession(access, openText, INCLUDE_LIMITS, snapshot.reader(openText));
    for (const { path, from } of asked) {
      // A request that fails is kept, with why, by the session.
      await session.load(path, from, 'include').catch(() => undefined);
    }
    const requests = inputRequestsOf(session.requests);
    const files = [...new Set(requests.flatMap(({ file }) => (file === null ? [] : [file])))].map((id) => snapshot.delivered(id)!);
    return { source: hash(source), context: contextOf(access), requests, files };
  };

  it('finds nothing otherwise when all a drawing was drawn from is as it was', async () => {
    await writeFile(join(lib, 'part.iuml'), '!include inner.iuml\n');
    await writeFile(join(lib, 'inner.iuml'), 'Bob -> Carol\n');
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'part.iuml', from: null },
      { path: 'inner.iuml', from: join(lib, 'part.iuml') },
      { path: 'later.iuml', from: null },
    ]);
    // Looked for next to the diagram first; one is found nowhere.
    expect(drawn.requests.map(({ outcome, looked }) => [outcome, looked])).toEqual([
      ['read', [join(docs, 'part.iuml')]],
      ['read', []],
      ['missing:searched', [join(docs, 'later.iuml'), join(lib, 'later.iuml')]],
    ]);

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([]);
  });

  it('finds the diagram otherwise when its text is, or once it is gone', async () => {
    const drawn = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }]);

    expect(await recheckInputs(drawn, `${DIAGRAM}Bob -> Alice\n`, access, closed)).toEqual([{ change: 'diagram' }]);
    expect(await recheckInputs(drawn, null, access, closed)).toEqual([{ change: 'diagram' }]);
  });

  it('looks at the includes alone of a diagram without a name of its own, which cannot be found again', async () => {
    const drawn: DrawnFrom = { ...(await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }])), source: null };

    expect(await recheckInputs(drawn, null, access, closed)).toEqual([]);
    await writeFile(join(lib, 'part.iuml'), 'Alice -> Carol\n');
    expect(await recheckInputs(drawn, null, access, closed)).toEqual([{ change: 'file', file: join(lib, 'part.iuml') }]);
  });

  it('finds a file delivered otherwise when its text is', async () => {
    const drawn = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }]);
    await writeFile(join(lib, 'part.iuml'), 'Alice -> Carol\n');

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([{ change: 'file', file: join(lib, 'part.iuml') }]);
  });

  it('reads a file open in an editor as it is edited, as a drawing does', async () => {
    const part = join(lib, 'part.iuml');
    const editing =
      (text: string) =>
      (path: string): string | undefined =>
        path === part ? text : undefined;
    const drawn = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }]);

    expect(await recheckInputs(drawn, DIAGRAM, access, editing('Alice -> Bob\n'))).toEqual([]);
    expect(await recheckInputs(drawn, DIAGRAM, access, editing('Alice -> Carol\n'))).toEqual([{ change: 'file', file: part }]);
    // Drawn from changes not saved, which were dropped since.
    const unsaved = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }], editing('Alice -> Carol\n'));
    expect(await recheckInputs(unsaved, DIAGRAM, access, closed)).toEqual([{ change: 'file', file: part }]);
  });

  it('finds a request answered otherwise once a file is found nearer, no longer, or only now', async () => {
    await writeFile(join(lib, 'gone.iuml'), 'Bob -> Carol\n');
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'part.iuml', from: null },
      { path: 'gone.iuml', from: null },
      { path: 'later.iuml', from: null },
    ]);
    // The same text, nearer: another file all the same.
    await writeFile(join(docs, 'part.iuml'), 'Alice -> Bob\n');
    await rm(join(lib, 'gone.iuml'));
    await writeFile(join(lib, 'later.iuml'), 'Carol -> Dave\n');

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([
      { change: 'answer', path: 'part.iuml' },
      { change: 'answer', path: 'gone.iuml' },
      { change: 'answer', path: 'later.iuml' },
    ]);
  });

  it('finds a request answered otherwise once a file refused is fixed, or one not found is there but refused', async () => {
    await writeFile(join(lib, 'broken.iuml'), 'A\u0000B');
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'broken.iuml', from: null },
      { path: 'later.iuml', from: null },
    ]);
    expect(drawn.requests.map(({ outcome }) => outcome)).toEqual(['read:nul', 'missing:searched']);
    await writeFile(join(lib, 'broken.iuml'), 'A -> B\n');
    // Looked at in the same places as before, and still none delivered.
    await writeFile(join(lib, 'later.iuml'), 'A\u0000B');

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([
      { change: 'answer', path: 'broken.iuml' },
      { change: 'answer', path: 'later.iuml' },
    ]);
  });

  it('finds a request answered otherwise once a place found empty is reached through a link', async () => {
    await mkdir(join(lib, 'parts'));
    await writeFile(join(lib, 'parts', 'part.iuml'), 'Alice -> Bob\n');
    // A junction on Windows, which needs no privilege; a link elsewhere.
    await symlink(join(lib, 'parts'), join(lib, 'linked'), 'junction');
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'parts/part.iuml', from: null },
      { path: 'linked/part.iuml', from: null },
    ]);
    expect(drawn.requests.map(({ outcome }) => outcome)).toEqual(['read', 'read:link']);
    // Both lead to the same file; the second is refused nearer now, and still none delivered.
    await symlink(join(lib, 'parts'), join(docs, 'parts'), 'junction');
    await symlink(join(lib, 'parts'), join(docs, 'linked'), 'junction');

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([
      { change: 'answer', path: 'parts/part.iuml' },
      { change: 'answer', path: 'linked/part.iuml' },
    ]);
  });

  it('finds a request answered otherwise once its file is another, though found in the same place', async () => {
    const drawn = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }]);
    // The same name in another case: the same place on Windows, which gives the file its new name.
    await rename(join(lib, 'part.iuml'), join(lib, 'Part.iuml'));

    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([{ change: 'answer', path: 'part.iuml' }]);
  });

  it('answers a request from a file next to that file, and none from a file not delivered now', async () => {
    await writeFile(join(lib, 'part.iuml'), '!include inner.iuml\n');
    await writeFile(join(lib, 'inner.iuml'), 'Bob -> Carol\n');
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'part.iuml', from: null },
      { path: 'inner.iuml', from: join(lib, 'part.iuml') },
    ]);

    await writeFile(join(lib, 'inner.iuml'), 'Bob -> Dave\n');
    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([{ change: 'file', file: join(lib, 'inner.iuml') }]);
    // Another file answers the diagram's include now, and what the one before asked for is asked from it no more.
    await writeFile(join(docs, 'part.iuml'), '!include inner.iuml\n');
    expect(await recheckInputs(drawn, DIAGRAM, access, closed)).toEqual([
      { change: 'answer', path: 'part.iuml' },
      { change: 'answer', path: 'inner.iuml' },
    ]);
  });

  it('takes a request whose read ends in an error for one answered otherwise, and answers the rest', async () => {
    const drawn = await drawnFrom(DIAGRAM, [
      { path: 'part.iuml', from: null },
      { path: 'later.iuml', from: null },
    ]);
    const failing = (path: string): string | undefined => {
      if (path === join(lib, 'part.iuml')) {
        throw new Error('the editor could not say');
      }
      return undefined;
    };

    expect(await recheckInputs(drawn, DIAGRAM, access, failing)).toEqual([{ change: 'answer', path: 'part.iuml' }]);
  });

  it('finds where the includes are looked for otherwise, though each request is answered as it was', async () => {
    const drawn = await drawnFrom(DIAGRAM, [{ path: 'part.iuml', from: null }]);
    await mkdir(join(root, 'shared'));
    const more: IncludeAccess = { available: true, scope: { root, documentFolder: docs, searchFolders: [lib, join(root, 'shared')] } };
    const none: IncludeAccess = { available: true, scope: { root, documentFolder: docs, searchFolders: [] } };

    expect(await recheckInputs(drawn, DIAGRAM, more, closed)).toEqual([{ change: 'context' }]);
    expect(await recheckInputs(drawn, DIAGRAM, none, closed)).toEqual([{ change: 'context' }, { change: 'answer', path: 'part.iuml' }]);
    // In the order found: the diagram, where its includes are looked for, then each request.
    expect(await recheckInputs(drawn, 'Bob -> Alice\n', { available: false, why: 'untrusted' }, closed)).toEqual([
      { change: 'diagram' },
      { change: 'context' },
      { change: 'answer', path: 'part.iuml' },
    ]);
  });

  it('does not look at where the includes are looked for, for a diagram drawn without one', async () => {
    const drawn: DrawnFrom = { source: hash('Alice -> Bob\n'), context: null, requests: [], files: [] };
    const untrusted: IncludeAccess = { available: false, why: 'untrusted' };

    expect(await recheckInputs(drawn, 'Alice -> Bob\n', untrusted, closed)).toEqual([]);
    expect(await recheckInputs(drawn, 'Alice -> Carol\n', untrusted, closed)).toEqual([{ change: 'diagram' }]);
  });

  // Reading a chain of files as deep as a drawing goes, twice, takes seconds under coverage.
  it('answers the requests again within what one drawing may read', { timeout: 30_000 }, async () => {
    // Each file includes the next, one more than a drawing goes deep.
    const chain = Array.from({ length: INCLUDE_LIMITS.depth + 1 }, (_, index) => join(lib, `c${String(index)}.iuml`));
    for (const [index, file] of chain.entries()) {
      await writeFile(file, `!include c${String(index + 1)}.iuml\n`);
    }
    const source = '!include c0.iuml\n';
    const drawn = await drawnFrom(
      source,
      chain.map((_, index) => ({ path: `c${String(index)}.iuml`, from: index === 0 ? null : chain[index - 1]! }))
    );
    expect(drawn.requests.at(-1)?.outcome).toBe('limit:depth');

    expect(await recheckInputs(drawn, source, access, closed)).toEqual([]);
  });
});
