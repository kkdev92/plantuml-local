import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IncludeScope } from '../../src/includes/resolver';
import { IncludeSession } from '../../src/includes/session';
import { includeEntries, includeTarget, type IncludeEntry } from '../../src/includes/targets';

let temp: string;
let root: string;
let docs: string;
let scope: IncludeScope;

beforeAll(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-targets-')));
  root = join(temp, 'ws');
  docs = join(root, 'docs');
  const files: Record<string, string> = {
    'docs/common.puml': 'A -> B',
    'docs/Shadow.puml': 'A -> B',
    'docs/sub/a.puml': 'A -> B',
    'docs/notes.md': '# notes',
    'docs/.git/x.puml': 'A -> B',
    'lib/common.puml': 'A -> B',
    'lib/only-lib.puml': 'A -> B',
    'lib/shadow.puml': 'A -> B',
    'lib/folder.puml': 'A -> B',
    'lib/sub/b.puml': 'A -> B',
    'more/only-lib.puml': 'A -> B',
    'more/only-more.iuml': 'A -> B',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), text);
  }
  await mkdir(join(docs, 'folder.puml'));
  await mkdir(join(temp, 'outside'));
  await writeFile(join(temp, 'outside', 'secret.puml'), 'Eve -> Bob');
  // A junction on Windows, which needs no privilege; a link elsewhere.
  await symlink(join(temp, 'outside'), join(docs, 'linked'), 'junction');
  scope = { root, documentFolder: docs, searchFolders: [join(root, 'lib'), join(root, 'more')] };
});

afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('includeTarget', () => {
  it.each([
    ['common.puml', 'docs/common.puml'],
    ['only-lib.puml', 'lib/only-lib.puml'],
    ['only-more.iuml', 'more/only-more.iuml'],
    ['sub/b.puml', 'lib/sub/b.puml'],
    ['sub\\a.puml', 'docs/sub/a.puml'],
    ['./sub/../common.puml', 'docs/common.puml'],
  ])('finds %j where the render reads it', async (path, found) => {
    await expect(includeTarget(path, scope)).resolves.toBe(join(root, found));
  });

  it.each([
    ['./only-lib.puml', 'written next to the document only'],
    ['none.puml', 'missing everywhere'],
    ['folder.puml', 'a folder first, which stops the render'],
    ['linked/secret.puml', 'through a link'],
    ['../../outside/secret.puml', 'out of the root'],
    ['notes.md', 'not a kind read'],
    ['.git/x.puml', 'in version control'],
    ['/etc/hosts.txt', 'not relative'],
  ])('finds nothing for %j: %s', async (path) => {
    await expect(includeTarget(path, scope)).resolves.toBeNull();
  });

  it('looks in the search folders in their order', async () => {
    const swapped = { ...scope, searchFolders: [join(root, 'more'), join(root, 'lib')] };
    await expect(includeTarget('only-lib.puml', swapped)).resolves.toBe(join(root, 'more', 'only-lib.puml'));
  });

  it('leads to the file the render reads, or to none when it reads none', async () => {
    const access = { available: true as const, scope };
    for (const path of [
      'common.puml',
      'only-lib.puml',
      'only-more.iuml',
      'sub/a.puml',
      'sub/b.puml',
      './only-lib.puml',
      'none.puml',
      'folder.puml',
      'linked/secret.puml',
      '../outside.puml',
    ]) {
      const session = new IncludeSession(access, () => undefined);
      const read = await session.load(path, null).then(
        (file) => file.id,
        () => null
      );
      await expect(includeTarget(path, scope), path).resolves.toBe(read);
    }
  });
});

describe('includeEntries', () => {
  const entry = (name: string, folder: boolean, searchFolder: string | null = null): IncludeEntry => ({
    name,
    folder,
    searchFolder,
  });
  const caseBlind = process.platform === 'win32' || process.platform === 'darwin';
  const sorted = (entries: IncludeEntry[]): IncludeEntry[] =>
    [...entries].sort((a, b) => `${String(a.folder)}${a.name}`.localeCompare(`${String(b.folder)}${b.name}`));

  it('offers each name from the first place that has it, as the render finds it', async () => {
    const expected = [
      entry('common.puml', false),
      entry('Shadow.puml', false),
      entry('folder.puml', true),
      entry('sub', true),
      entry('only-lib.puml', false, 'lib'),
      ...(caseBlind ? [] : [entry('shadow.puml', false, 'lib')]),
      entry('only-more.iuml', false, 'more'),
    ];
    expect(sorted(await includeEntries('', scope))).toEqual(sorted(expected));
  });

  it('goes on into a folder in every place that has it', async () => {
    expect(sorted(await includeEntries('sub/', scope))).toEqual(
      sorted([entry('a.puml', false), entry('b.puml', false, 'lib')])
    );
    expect(await includeEntries('sub\\', scope)).toHaveLength(2);
  });

  it('looks next to the document only for a path written as ./ or ../', async () => {
    expect(sorted(await includeEntries('./', scope))).toEqual(
      sorted([entry('common.puml', false), entry('Shadow.puml', false), entry('folder.puml', true), entry('sub', true)])
    );
    expect(sorted(await includeEntries('../', scope))).toEqual(
      sorted([entry('docs', true), entry('lib', true), entry('more', true)])
    );
  });

  it.each([
    ['../../', 'out of the root'],
    ['linked/', 'through a link'],
    ['.git/', 'version control'],
    ['none/', 'missing'],
    ['C:/', 'not relative'],
  ])('offers nothing after %j: %s', async (typed) => {
    await expect(includeEntries(typed, scope)).resolves.toEqual([]);
  });
});
