import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { INCLUDE_LIMITS } from '../../src/core/constants';
import { parseIncludePath, parseSearchFolder } from '../../src/includes/path-policy';
import { readIncludeFile, type ReadOptions } from '../../src/includes/reader';
import { includeCandidates, isWithin, MAX_SEARCH_FOLDERS, searchFolders } from '../../src/includes/resolver';

describe('parseIncludePath', () => {
  it.each([
    ['common.puml', ['common.puml'], false],
    ['./styles/common.iuml', ['styles', 'common.iuml'], true],
    ['../shared/model.plantuml', ['..', 'shared', 'model.plantuml'], true],
    ['parts\\sub\\Part.PUML', ['parts', 'sub', 'Part.PUML'], false],
    ['.\\local.pu', ['local.pu'], true],
    ['a/./b//c.wsd', ['a', 'b', 'c.wsd'], false],
    ['defs.inc', ['defs.inc'], false],
    ['notes.txt', ['notes.txt'], false],
    ['%2e%2e%2fsecret.puml', ['%2e%2e%2fsecret.puml'], false],
    ['console.puml', ['console.puml'], false],
    ['.github/flow.puml', ['.github', 'flow.puml'], false],
  ])('accepts %j', (written, segments, anchored) => {
    expect(parseIncludePath(written)).toEqual({ ok: true, path: { segments, anchored } });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['a\u0000.puml', 'control'],
    ['a\tb.puml', 'control'],
    ['~/defs.puml', 'home'],
    ['~user/defs.puml', 'home'],
    ['/etc/defs.puml', 'absolute'],
    ['C:\\defs.puml', 'absolute'],
    ['C:defs.puml', 'absolute'],
    ['c:/defs.puml', 'absolute'],
    ['\\\\server\\share\\defs.puml', 'absolute'],
    ['\\\\?\\C:\\defs.puml', 'absolute'],
    ['//server/share/defs.puml', 'absolute'],
    ['file:///defs.puml', 'uri'],
    ['https://example.com/defs.puml', 'uri'],
    ['vscode-remote://host/defs.puml', 'uri'],
    ['dir/defs.puml:hidden', 'stream'],
    ['CON.puml', 'device'],
    ['dir/nul.txt', 'device'],
    ['com1.puml', 'device'],
    ['LPT9.iuml', 'device'],
    ['aux.tar.puml', 'device'],
    ['defs.puml.', 'trailing'],
    ['dir /defs.puml', 'trailing'],
    ['defs.puml ', 'trailing'],
    ['.git/defs.puml', 'vcs'],
    ['a/.SVN/defs.puml', 'vcs'],
    ['.hg/defs.puml', 'vcs'],
    ['defs.png', 'extension'],
    ['defs', 'extension'],
    ['dir/', 'extension'],
    ['..', 'extension'],
    ['.puml', 'extension'],
  ])('refuses %j as %s', (written, refusal) => {
    expect(parseIncludePath(written)).toEqual({ ok: false, refusal });
  });
});

describe('parseSearchFolder', () => {
  it('takes a folder without an extension, and the workspace folder itself', () => {
    expect(parseSearchFolder('styles/common')).toEqual({
      ok: true,
      path: { segments: ['styles', 'common'], anchored: false },
    });
    expect(parseSearchFolder('.')).toEqual({ ok: true, path: { segments: [], anchored: false } });
    expect(parseSearchFolder('')).toEqual({ ok: true, path: { segments: [], anchored: false } });
  });

  it('refuses what a file path refuses, but not for its extension', () => {
    expect(parseSearchFolder('/etc')).toEqual({ ok: false, refusal: 'absolute' });
    expect(parseSearchFolder('.git')).toEqual({ ok: false, refusal: 'vcs' });
    expect(parseSearchFolder('~')).toEqual({ ok: false, refusal: 'home' });
  });
});

describe('includeCandidates', () => {
  const root = join(tmpdir(), 'ws');
  const scope = {
    root,
    documentFolder: join(root, 'docs'),
    searchFolders: [join(root, 'styles'), join(root, 'shared')],
  };
  const parsed = (written: string) => {
    const result = parseIncludePath(written);
    if (!result.ok) {
      throw new Error(result.refusal);
    }
    return result.path;
  };

  it('looks for an include of the diagram itself next to the document, then in the search folders', () => {
    expect(includeCandidates(parsed('common.puml'), null, scope)).toEqual([
      join(root, 'docs', 'common.puml'),
      join(root, 'styles', 'common.puml'),
      join(root, 'shared', 'common.puml'),
    ]);
  });

  it('looks for an anchored path next to the including file only', () => {
    expect(includeCandidates(parsed('./common.puml'), null, scope)).toEqual([join(root, 'docs', 'common.puml')]);
    const from = join(root, 'parts', 'a.puml');
    expect(includeCandidates(parsed('../shared/b.puml'), from, scope)).toEqual([join(root, 'shared', 'b.puml')]);
  });

  it('looks for an include of an included file next to that file', () => {
    const from = join(root, 'parts', 'a.puml');
    expect(includeCandidates(parsed('b.puml'), from, scope)[0]).toBe(join(root, 'parts', 'b.puml'));
  });

  it('can name a place outside the root, which the caller refuses', () => {
    const [candidate] = includeCandidates(parsed('../../outside.puml'), null, scope);
    expect(candidate).toBe(join(root, '..', 'outside.puml'));
    expect(isWithin(root, candidate ?? '')).toBe(false);
  });
});

describe('isWithin', () => {
  const root = join(tmpdir(), 'ws');

  it('takes the root and what is under it', () => {
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(root, join(root, 'a', 'b.puml'))).toBe(true);
    expect(isWithin(root, join(root, '..foo', 'b.puml'))).toBe(true);
  });

  it('refuses a sibling whose name starts with the root', () => {
    expect(isWithin(root, `${root}2`)).toBe(false);
    expect(isWithin(root, join(root, '..', 'other'))).toBe(false);
  });

  it.runIf(process.platform === 'win32')('ignores case on Windows', () => {
    expect(isWithin('C:\\Work\\Repo', 'c:\\work\\repo\\a.puml')).toBe(true);
  });
});

describe('searchFolders', () => {
  const root = join(tmpdir(), 'ws');

  it('lists the folders under the root, in order', () => {
    expect(searchFolders(root, ['styles', '.', 'a/../shared'])).toEqual([
      join(root, 'styles'),
      root,
      join(root, 'shared'),
    ]);
    expect(searchFolders(root, [])).toEqual([]);
  });

  it('refuses the whole setting for one bad entry', () => {
    expect(searchFolders(root, ['styles', '../outside'])).toEqual({
      problem: 'refused',
      folder: '../outside',
      refusal: 'outside',
    });
    expect(searchFolders(root, ['styles', 'C:\\x'])).toEqual({
      problem: 'refused',
      folder: 'C:\\x',
      refusal: 'absolute',
    });
  });

  it('refuses what is not a list of strings, and more than the most folders', () => {
    expect(searchFolders(root, 'styles')).toEqual({ problem: 'not-a-list' });
    expect(searchFolders(root, ['styles', 1])).toEqual({ problem: 'not-a-list' });
    const many = Array.from({ length: MAX_SEARCH_FOLDERS + 1 }, (_, index) => `f${String(index)}`);
    expect(searchFolders(root, many)).toEqual({ problem: 'too-many', count: MAX_SEARCH_FOLDERS + 1 });
  });
});

describe('readIncludeFile', () => {
  let temp: string;
  let root: string;
  let outside: string;
  const options = (overrides?: Partial<ReadOptions>): ReadOptions => ({
    openText: () => undefined,
    maxBytes: INCLUDE_LIMITS.bytes,
    ...overrides,
  });

  beforeEach(async () => {
    // The temporary folder may itself be reached through a link (macOS's
    // /var), as a workspace folder can be: the root is its real path.
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-include-')));
    root = join(temp, 'ws');
    outside = join(temp, 'outside');
    await mkdir(join(root, 'parts'), { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(root, 'parts', 'common.puml'), 'Alice -> Bob\n');
    await writeFile(join(outside, 'secret.puml'), 'Eve -> Bob\n');
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('reads a file under the root, with its real path as its identity', async () => {
    const outcome = await readIncludeFile(root, join(root, 'parts', 'common.puml'), options());
    expect(outcome).toEqual({ kind: 'file', id: join(root, 'parts', 'common.puml'), text: 'Alice -> Bob\n' });
  });

  it('reports a missing file, and a missing folder on the way, as missing', async () => {
    expect(await readIncludeFile(root, join(root, 'parts', 'none.puml'), options())).toEqual({ kind: 'missing' });
    expect(await readIncludeFile(root, join(root, 'none', 'a.puml'), options())).toEqual({ kind: 'missing' });
  });

  it('refuses a folder', async () => {
    await mkdir(join(root, 'folder.puml'));
    expect(await readIncludeFile(root, join(root, 'folder.puml'), options())).toEqual({
      kind: 'refused',
      refusal: 'not-a-file',
    });
  });

  it('refuses a file reached through a linked folder, which is not a link itself', async () => {
    // A junction on Windows, which needs no privilege; a link elsewhere.
    await symlink(outside, join(root, 'linked'), 'junction');
    expect(await readIncludeFile(root, join(root, 'linked', 'secret.puml'), options())).toEqual({
      kind: 'refused',
      refusal: 'link',
    });
  });

  it('refuses a linked file', async (context) => {
    try {
      await symlink(join(outside, 'secret.puml'), join(root, 'secret.puml'), 'file');
    } catch {
      // Windows without the privilege to create file links.
      context.skip();
    }
    expect(await readIncludeFile(root, join(root, 'secret.puml'), options())).toEqual({
      kind: 'refused',
      refusal: 'link',
    });
  });

  it('prefers the text of an open document, unsaved changes and all', async () => {
    const id = join(root, 'parts', 'common.puml');
    const openText = (path: string): string | undefined => (path === id ? 'Carol -> Dave' : undefined);
    const outcome = await readIncludeFile(root, id, options({ openText }));
    expect(outcome).toEqual({ kind: 'file', id, text: 'Carol -> Dave' });
  });

  it('drops a leading BOM', async () => {
    await writeFile(join(root, 'bom.puml'), '\uFEFFAlice -> Bob');
    expect(await readIncludeFile(root, join(root, 'bom.puml'), options())).toMatchObject({ text: 'Alice -> Bob' });
  });

  it('refuses text that is not UTF-8, or holds a NUL', async () => {
    await writeFile(join(root, 'latin1.puml'), Buffer.from([0x41, 0xe9, 0x42]));
    expect(await readIncludeFile(root, join(root, 'latin1.puml'), options())).toEqual({
      kind: 'refused',
      refusal: 'encoding',
    });
    await writeFile(join(root, 'nul.puml'), 'Alice\u0000');
    expect(await readIncludeFile(root, join(root, 'nul.puml'), options())).toEqual({ kind: 'refused', refusal: 'nul' });
  });

  it('refuses a file larger than the bytes left, on disk or open', async () => {
    const id = join(root, 'parts', 'common.puml');
    expect(await readIncludeFile(root, id, options({ maxBytes: 4 }))).toEqual({ kind: 'refused', refusal: 'too-large' });
    expect(await readIncludeFile(root, id, options({ maxBytes: 4, openText: () => 'é'.repeat(3) }))).toEqual({
      kind: 'refused',
      refusal: 'too-large',
    });
  });
});
