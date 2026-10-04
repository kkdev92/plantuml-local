import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INCLUDE_LIMITS } from '../../src/core/constants';
import type { IncludeRequestMessage } from '../../src/core/types';
import { includeAccess, type DocumentFacts } from '../../src/includes/access';
import {
  describeIncludeFailure,
  describeIncludeFailures,
  hasLocalInclude,
  withIncludeReason,
  type IncludeLabels,
} from '../../src/includes/describe';
import { INCLUDE_EXTENSIONS } from '../../src/includes/path-policy';
import { IncludeSession, type IncludeAccess, type IncludeFailureReason } from '../../src/includes/session';
import { installFileLoader } from '../../src/worker/file-loader';

describe('IncludeSession', () => {
  let temp: string;
  let root: string;
  let access: IncludeAccess;
  const closed = (): undefined => undefined;

  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-session-')));
    root = join(temp, 'ws');
    await mkdir(join(root, 'docs'), { recursive: true });
    await mkdir(join(root, 'styles'), { recursive: true });
    await writeFile(join(root, 'docs', 'common.puml'), 'Alice -> Bob\n');
    await writeFile(join(root, 'docs', 'nested.puml'), '!include common.puml\n');
    await writeFile(join(root, 'styles', 'skin.iuml'), 'skinparam shadowing false\n');
    await writeFile(join(root, 'docs', 'two.puml'), '@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml\n');
    access = {
      available: true,
      scope: { root, documentFolder: join(root, 'docs'), searchFolders: [join(root, 'styles')] },
    };
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('delivers a file next to the document, with its real path as the id', async () => {
    const session = new IncludeSession(access, closed);
    await expect(session.load('common.puml', null)).resolves.toEqual({
      id: join(root, 'docs', 'common.puml'),
      text: 'Alice -> Bob\n',
    });
    expect(session.failures).toEqual([]);
    expect([...session.dependencies]).toEqual([join(root, 'docs', 'common.puml')]);
  });

  it('looks for a bare name in the search folders after the document folder, noting where it looked', async () => {
    const session = new IncludeSession(access, closed);
    await expect(session.load('skin.iuml', null)).resolves.toMatchObject({ id: join(root, 'styles', 'skin.iuml') });
    expect([...session.dependencies]).toEqual([join(root, 'docs', 'skin.iuml'), join(root, 'styles', 'skin.iuml')]);
  });

  it('looks for the include of an included file next to that file', async () => {
    const session = new IncludeSession(access, closed);
    const outer = await session.load('nested.puml', null);
    await expect(session.load('common.puml', outer.id)).resolves.toMatchObject({
      id: join(root, 'docs', 'common.puml'),
    });
  });

  it('refuses a `from` it did not give, rather than looking next to it', async () => {
    const session = new IncludeSession(access, closed);
    await expect(session.load('common.puml', join(root, 'docs', 'common.puml'))).rejects.toThrow();
    expect(session.failures).toEqual([{ path: 'common.puml', reason: { kind: 'outside' } }]);
  });

  it('keeps why each include failed, in order', async () => {
    const session = new IncludeSession(access, closed);
    await expect(session.load('none.puml', null)).rejects.toThrow();
    await expect(session.load('./none.puml', null)).rejects.toThrow();
    await expect(session.load('/etc/passwd.txt', null)).rejects.toThrow();
    await expect(session.load('../../outside.puml', null)).rejects.toThrow();
    await expect(session.load('two.puml', null)).rejects.toThrow();
    await expect(session.load('image.png', null)).rejects.toThrow();
    expect(session.failures.map((failure) => failure.reason)).toEqual([
      { kind: 'missing', searched: true },
      { kind: 'missing', searched: false },
      { kind: 'path', refusal: 'absolute' },
      { kind: 'outside' },
      { kind: 'fragment', shape: 'several', line: 3 },
      { kind: 'path', refusal: 'extension' },
    ]);
  });

  it('refuses everything when the document gets no includes', async () => {
    const session = new IncludeSession({ available: false, why: 'untrusted' }, closed);
    await expect(session.load('common.puml', null)).rejects.toThrow();
    expect(session.failures).toEqual([{ path: 'common.puml', reason: { kind: 'unavailable', why: 'untrusted' } }]);
    expect(session.dependencies.size).toBe(0);
  });

  it('stops at the depth, the number of files and the bytes allowed', async () => {
    const shallow = new IncludeSession(access, closed, { ...INCLUDE_LIMITS, depth: 1 });
    const outer = await shallow.load('nested.puml', null);
    await expect(shallow.load('common.puml', outer.id)).rejects.toThrow();
    expect(shallow.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'depth' });

    const few = new IncludeSession(access, closed, { ...INCLUDE_LIMITS, files: 1 });
    await few.load('common.puml', null);
    await expect(few.load('common.puml', null)).rejects.toThrow();
    expect(few.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'files' });

    const small = new IncludeSession(access, closed, { ...INCLUDE_LIMITS, bytes: 20 });
    await small.load('common.puml', null);
    await expect(small.load('common.puml', null)).rejects.toThrow();
    expect(small.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'bytes' });
  });
});

describe('includeAccess', () => {
  const facts = (overrides: Partial<DocumentFacts>): DocumentFacts => ({
    trusted: true,
    untitled: false,
    scheme: 'file',
    path: join('/ws', 'docs', 'a.md'),
    folder: '/ws',
    includePaths: [],
    ...overrides,
  });
  const identity = (path: string): Promise<string> => Promise.resolve(path);

  it('gives a trusted file in a workspace folder its folder as the root', async () => {
    expect(await includeAccess(facts({ includePaths: ['styles'] }), identity)).toEqual({
      available: true,
      scope: { root: '/ws', documentFolder: join('/ws', 'docs'), searchFolders: [join('/ws', 'styles')] },
    });
  });

  it('places the document under the real path of its folder', async () => {
    const realpath = (path: string): Promise<string> => Promise.resolve(path === '/ws' ? '/real/ws' : path);
    expect(await includeAccess(facts({}), realpath)).toMatchObject({
      scope: { root: '/real/ws', documentFolder: join('/real/ws', 'docs') },
    });
  });

  it.each([
    [{ trusted: false }, 'untrusted'],
    [{ untitled: true }, 'untitled'],
    [{ scheme: 'vscode-vfs' }, 'not-on-disk'],
    [{ folder: undefined }, 'outside-workspace'],
    [{ path: join('/other', 'a.md') }, 'outside-workspace'],
  ])('refuses %j as %s', async (overrides, why) => {
    expect(await includeAccess(facts(overrides), identity)).toEqual({ available: false, why });
  });

  it('refuses all includes of a document whose search folders cannot be used', async () => {
    expect(await includeAccess(facts({ includePaths: 'styles' }), identity)).toEqual({
      available: false,
      why: 'setting',
      problem: { problem: 'not-a-list' },
    });
  });

  it('refuses a folder whose real path cannot be read', async () => {
    const failing = (): Promise<string> => Promise.reject(new Error('ENOENT'));
    expect(await includeAccess(facts({}), failing)).toEqual({ available: false, why: 'outside-workspace' });
  });
});

describe('hasLocalInclude', () => {
  it.each([
    ['!include common.puml', true],
    ['  !include_once ./a.puml', true],
    ['!include_many $file', true],
    ['!INCLUDE common.puml', true],
    ['!include <azure/AzureCommon>', false],
    ['!include https://example.com/a.puml', false],
    ['!includesub a.puml!PART', false],
    ['!includeurl a.puml', false],
    ["' !include common.puml", false],
    ['A -> B : !include', false],
  ])('%j → %s', (line, expected) => {
    expect(hasLocalInclude(`@startuml\n${line}\n@enduml`)).toBe(expected);
  });
});

describe('describing a failed include', () => {
  const labels: IncludeLabels = {
    untrusted: 'untrusted',
    untitled: 'untitled',
    notOnDisk: 'not on disk',
    outsideWorkspace: 'outside workspace',
    settingNotAList: 'not a list',
    settingTooMany: (count, most) => `too many ${String(count)}/${String(most)}`,
    settingRefused: (folder) => `refused ${folder}`,
    notRelative: 'not relative',
    badName: 'bad name',
    versionControl: 'vcs',
    extension: (extensions) => `extensions ${extensions}`,
    outside: 'outside',
    missing: 'missing',
    missingAnywhere: 'missing anywhere',
    link: 'link',
    notAFile: 'not a file',
    encoding: 'encoding',
    nul: 'nul',
    unreadable: 'unreadable',
    severalDiagrams: (line) => `several ${String(line)}`,
    outsideDiagram: (line) => `outside diagram ${String(line)}`,
    tooDeep: (most) => `deep ${String(most)}`,
    tooMany: (most) => `many ${String(most)}`,
    tooLarge: (mebibytes) => `large ${String(mebibytes)}`,
  };
  const describe_ = (reason: IncludeFailureReason): string =>
    describeIncludeFailure(reason, labels, INCLUDE_EXTENSIONS, INCLUDE_LIMITS);

  it.each<[IncludeFailureReason, string]>([
    [{ kind: 'unavailable', why: 'untrusted' }, 'untrusted'],
    [{ kind: 'unavailable', why: 'setting', problem: { problem: 'too-many', count: 17 } }, 'too many 17/16'],
    [{ kind: 'unavailable', why: 'setting', problem: { problem: 'refused', folder: '..', refusal: 'outside' } }, 'refused ..'],
    [{ kind: 'path', refusal: 'uri' }, 'not relative'],
    [{ kind: 'path', refusal: 'device' }, 'bad name'],
    [{ kind: 'path', refusal: 'extension' }, `extensions ${INCLUDE_EXTENSIONS.join(', ')}`],
    [{ kind: 'missing', searched: false }, 'missing'],
    [{ kind: 'missing', searched: true }, 'missing anywhere'],
    [{ kind: 'read', refusal: 'link' }, 'link'],
    [{ kind: 'fragment', shape: 'several', line: 3 }, 'several 4'],
    [{ kind: 'fragment', shape: 'outside', line: 0 }, 'outside diagram 1'],
    [{ kind: 'limit', limit: 'bytes' }, 'large 16'],
  ])('%j', (reason, text) => {
    expect(describe_(reason)).toBe(text);
  });

  it('keeps the first failure of each path', () => {
    const described = describeIncludeFailures(
      [
        { path: 'a.puml', reason: { kind: 'missing', searched: false } },
        { path: 'b.puml', reason: { kind: 'outside' } },
        { path: 'a.puml', reason: { kind: 'outside' } },
      ],
      describe_
    );
    expect([...described]).toEqual([
      ['a.puml', 'missing'],
      ['b.puml', 'outside'],
    ]);
  });

  it("adds the reason to the engine's own words, for the path it names", () => {
    const failed = new Map([['a.puml', 'missing']]);
    expect(withIncludeReason('cannot include a.puml', failed)).toBe('cannot include a.puml: missing');
    expect(withIncludeReason('cannot include b.puml', failed)).toBe('cannot include b.puml');
    expect(withIncludeReason('Syntax Error?', failed)).toBe('Syntax Error?');
  });
});

describe('installFileLoader', () => {
  type Loader = (
    path: string,
    from: string | null,
    ok: (id: string, text: string) => void,
    fail: (reason: string) => void
  ) => false | undefined;
  const loader = (): Loader => (globalThis as unknown as { PLANTUML_FILE_LOADER: Loader }).PLANTUML_FILE_LOADER;

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).PLANTUML_FILE_LOADER;
  });

  it('declines outside a render, and in one the host does not answer', () => {
    const post = vi.fn();
    const bridge = installFileLoader(post);
    expect(loader()('a.puml', null, vi.fn(), vi.fn())).toBe(false);
    bridge.begin(1, false);
    expect(loader()('a.puml', null, vi.fn(), vi.fn())).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('passes a request to the host and its answer back', () => {
    const posted: IncludeRequestMessage[] = [];
    const bridge = installFileLoader((message) => posted.push(message));
    const ok = vi.fn();
    const fail = vi.fn();
    bridge.begin(7, true);

    expect(loader()('a.puml', null, ok, fail)).toBeUndefined();
    expect(loader()('b.puml', '/ws/a.puml', vi.fn(), fail)).toBeUndefined();
    expect(posted).toEqual([
      { type: 'include', render: 7, request: 1, path: 'a.puml', from: null },
      { type: 'include', render: 7, request: 2, path: 'b.puml', from: '/ws/a.puml' },
    ]);

    bridge.answer({ type: 'include', request: 1, file: { id: '/ws/a.puml', text: 'A -> B' } });
    bridge.answer({ type: 'include', request: 2, error: 'missing' });
    expect(ok).toHaveBeenCalledWith('/ws/a.puml', 'A -> B');
    expect(fail).toHaveBeenCalledWith('missing');
  });

  it('fails what is still waiting when the render ends, and ignores a late answer', () => {
    const bridge = installFileLoader(vi.fn());
    const ok = vi.fn();
    const fail = vi.fn();
    bridge.begin(1, true);
    loader()('a.puml', null, ok, fail);
    bridge.end();
    expect(fail).toHaveBeenCalledTimes(1);

    bridge.answer({ type: 'include', request: 1, file: { id: '/ws/a.puml', text: '' } });
    expect(ok).not.toHaveBeenCalled();
    expect(loader()('a.puml', null, vi.fn(), vi.fn())).toBe(false);
  });
});
