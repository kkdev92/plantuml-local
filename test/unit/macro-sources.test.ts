import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IncludeSession, type IncludeAccess } from '../../src/includes/session';
import { LibraryDeclarations, macroSources } from '../../src/language/macro-sources';
import { callablesNamed, macrosAt, type Macros } from '../../src/language/macros';

const assets = join(__dirname, '../../assets/declarations');

describe('LibraryDeclarations', () => {
  it('reads what a file of a bundled library declares, by its library in any case and its key', async () => {
    const libraries = new LibraryDeclarations(assets);
    const written = JSON.parse(readFileSync(join(assets, 'c4.json'), 'utf8')) as { declarations: Record<string, unknown> };

    await expect(libraries.declared('C4', 'c4_context')).resolves.toEqual(written.declarations['c4_context']);
    await expect(libraries.declared('c4', 'c4_nothing')).resolves.toBeNull();
    // Keys every object has name no file.
    await expect(libraries.declared('c4', 'constructor')).resolves.toBeNull();
    await expect(libraries.declared('c4', '__proto__')).resolves.toBeNull();
    await expect(libraries.declared('other', 'x')).resolves.toBeUndefined();
  });

  describe('with its files in a folder of their own', () => {
    let folder: string;

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), 'plantuml-local-declarations-'));
    });

    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    it('reads the file of a library once', async () => {
      await copyFile(join(assets, 'c4.json'), join(folder, 'c4.json'));
      const libraries = new LibraryDeclarations(folder);

      await expect(libraries.declared('c4', 'c4')).resolves.not.toBeNull();
      await rm(join(folder, 'c4.json'));
      await expect(libraries.declared('c4', 'c4_context')).resolves.not.toBeNull();
    });

    it('rejects while the file of a library cannot be read, and reads it again when next asked', async () => {
      const libraries = new LibraryDeclarations(folder);

      await expect(libraries.declared('c4', 'c4')).rejects.toThrow();
      await writeFile(join(folder, 'c4.json'), '{');
      await expect(libraries.declared('c4', 'c4')).rejects.toThrow();
      await writeFile(join(folder, 'c4.json'), '{}');
      await expect(libraries.declared('c4', 'c4')).rejects.toThrow('c4.json holds no declarations');
      await copyFile(join(assets, 'c4.json'), join(folder, 'c4.json'));
      await expect(libraries.declared('c4', 'c4')).resolves.not.toBeNull();
    });
  });
});

describe('macroSources', () => {
  let temp: string;
  let root: string;
  let access: IncludeAccess;
  const closed = (): undefined => undefined;

  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-sources-')));
    root = join(temp, 'ws');
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'common.puml'), ['!procedure Shared($x)', '!endprocedure', '!$color = "red"'].join('\n'));
    await writeFile(
      join(root, 'docs', 'parts.puml'),
      ['!startsub PART', '!procedure InPart()', '!endprocedure', '!endsub', '!procedure Outside()', '!endprocedure'].join('\n')
    );
    access = { available: true, scope: { root, documentFolder: join(root, 'docs'), searchFolders: [] } };
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  /** What is defined after `lines`, a diagram whose start line is line 0. */
  const after = (
    lines: readonly string[],
    session: IncludeSession,
    libraries = new LibraryDeclarations(assets),
    cancelled = (): boolean => false
  ): Promise<Macros> =>
    macrosAt(
      { lines, numbers: lines.map((_, index) => index + 1) },
      lines.length + 1,
      macroSources(session, libraries, cancelled)
    );
  const reasons = (macros: Macros): string[] => macros.shortfalls.map(({ reason, path }) => `${reason} ${path}`);

  it('reads a local file through the include session, as a render reads it', async () => {
    const session = new IncludeSession(access, closed);
    const macros = await after(['!include common.puml', '!includesub parts.puml!PART'], session);

    expect(macros.status).toBe('complete');
    expect([...macros.callables.keys()]).toEqual(['Shared/1', 'InPart/0']);
    expect(macros.variables.get('$color')?.candidates[0]?.macro.origin).toEqual({
      source: 'file',
      id: join(root, 'docs', 'common.puml'),
      line: 2,
      start: 1,
      end: 7,
      last: 2,
    });
    expect([...session.dependencies]).toEqual([join(root, 'docs', 'common.puml'), join(root, 'docs', 'parts.puml')]);
  });

  it('looks for what a file includes next to that file', async () => {
    await mkdir(join(root, 'docs', 'parts'));
    await writeFile(join(root, 'docs', 'parts', 'outer.puml'), '!include inner.puml');
    await writeFile(join(root, 'docs', 'parts', 'inner.puml'), '!procedure Inner()\n!endprocedure');
    const session = new IncludeSession(access, closed);
    const macros = await after(['!include parts/outer.puml'], session);

    expect(reasons(macros)).toEqual([]);
    expect(macros.callables.get('Inner/0')?.candidates[0]?.macro.origin).toMatchObject({
      source: 'file',
      id: join(root, 'docs', 'parts', 'inner.puml'),
    });
  });

  it('reads a file open in the editor as it is edited', async () => {
    const edited = join(root, 'docs', 'common.puml');
    const session = new IncludeSession(access, (path) => (path === edited ? '!procedure Edited()\n!endprocedure' : undefined));

    expect([...(await after(['!include common.puml'], session)).callables.keys()]).toEqual(['Edited/0']);
  });

  it('leaves why a local file could not be read with the session, and reads on', async () => {
    const session = new IncludeSession(access, closed);
    const macros = await after(['!include missing.puml', '!include common.puml'], session);

    expect(reasons(macros)).toEqual(['unreadable missing.puml']);
    expect(session.failures).toEqual([{ path: 'missing.puml', reason: { kind: 'missing', searched: false } }]);
    expect([...macros.callables.keys()]).toEqual(['Shared/1']);

    const closedWorkspace = new IncludeSession({ available: false, why: 'untrusted' }, closed);
    expect(reasons(await after(['!include common.puml'], closedWorkspace))).toEqual(['unreadable common.puml']);
    expect(closedWorkspace.failures).toEqual([
      { path: 'common.puml', reason: { kind: 'unavailable', why: 'untrusted' } },
    ]);
  });

  it('reads what the files of a bundled library declare, and the files they include', async () => {
    const session = new IncludeSession(access, closed);
    const macros = await after(['!include <C4/C4_Context>'], session);

    expect(macros.status).toBe('complete');
    expect(callablesNamed(macros, 'Person')).not.toEqual([]);
    const files = new Set(
      [...macros.callables.values()].flatMap((entry) =>
        entry.candidates.map(({ macro }) => (macro.origin.source === 'library' ? macro.origin.key : macro.origin.source))
      )
    );
    expect(files).toEqual(new Set(['c4', 'c4_context']));
    expect(session.dependencies.size).toBe(0);
  });

  it('says when no bundled library has a file, and when what it declares cannot be read', async () => {
    const session = new IncludeSession(access, closed);

    expect(reasons(await after(['!include <c4/constructor>', '!include <c4/nothing>', '!include <nolib/x>'], session))).toEqual([
      'not-bundled <c4/constructor>',
      'not-bundled <c4/nothing>',
      'not-bundled <nolib/x>',
    ]);

    const folder = await mkdtemp(join(tmpdir(), 'plantuml-local-declarations-'));
    try {
      await writeFile(join(folder, 'c4.json'), '{');
      expect(reasons(await after(['!include <C4/C4_Context>'], session, new LibraryDeclarations(folder)))).toEqual([
        'index <C4/C4_Context>',
      ]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('stops when the answer is no longer wanted', async () => {
    const session = new IncludeSession(access, closed);

    expect((await after(['!include common.puml'], session, undefined, () => true)).status).toBe('cancelled');
  });
});
