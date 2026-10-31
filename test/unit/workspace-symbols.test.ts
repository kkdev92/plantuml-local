import { describe, expect, it } from 'vitest';

import { WORKSPACE_SYMBOL_LIMITS } from '../../src/core/constants';
import {
  compileExclude,
  fileSymbols,
  matchesQuery,
  walkRoots,
  type EntryKind,
  type ExcludeTest,
  type FileSymbol,
  type WalkDeps,
  type WalkRoot,
} from '../../src/language/workspace-symbols';

/** A folder as nested objects: a file is 'file', a link 'link', a device or a pipe 'other'; 'unlistable' cannot be listed. */
interface Tree {
  [name: string]: Tree | 'file' | 'link' | 'other' | 'unlistable';
}

/** Lists the folders of `trees`, by the path of each root, one entry at a time. */
function depsOf(
  trees: Record<string, Tree>,
  options: { now?: () => number; stopped?: () => boolean } = {}
): WalkDeps & { listed: string[]; given: number } {
  const deps = {
    listed: [] as string[],
    given: 0,
    list: (path: string): AsyncIterable<{ name: string; kind: EntryKind }> => {
      deps.listed.push(path);
      const [first = '', ...rest] = path.split('/');
      const node = rest.reduce<Tree[string] | undefined>((at, name) => (typeof at === 'object' ? at[name] : undefined), trees[first]);
      return (async function* (): AsyncGenerator<{ name: string; kind: EntryKind }> {
        if (typeof node !== 'object') {
          throw new Error(`cannot list ${path}`);
        }
        for (const [name, entry] of Object.entries(node)) {
          deps.given += 1;
          yield { name, kind: entry === 'file' || entry === 'link' || entry === 'other' ? entry : 'directory' };
        }
      })();
    },
    join: (path: string, name: string): string => `${path}/${name}`,
    now: options.now ?? ((): number => 0),
    stopped: options.stopped ?? ((): boolean => false),
  };
  return deps;
}

const root = (path: string, exclude: ExcludeTest = () => false, inner: string[] = []): WalkRoot => ({
  path,
  exclude,
  inner: (segments) => inner.includes(segments.join('/')),
});

/** The test a valid setting compiles to. */
function excludeOf(patterns: unknown): ExcludeTest {
  const compiled = compileExclude(patterns);
  if (typeof compiled !== 'function') {
    throw new Error(`refused: ${JSON.stringify(compiled)}`);
  }
  return compiled;
}

/** `count` files named in order. */
function files(count: number, extension = 'puml'): Tree {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`f${String(index).padStart(4, '0')}.${extension}`, 'file' as const]));
}

describe('compileExclude', () => {
  it('reads `**` as any number of folders, none included, and the rest of a pattern as one segment of the path each', () => {
    const docs = excludeOf(['docs/**']);
    expect(docs(['docs'])).toBe(true);
    expect(docs(['docs', 'a.md'])).toBe(true);
    expect(docs(['docs', 'x', 'y.puml'])).toBe(true);
    expect(docs(['docs2'])).toBe(false);
    expect(docs(['a', 'docs'])).toBe(false);

    const puml = excludeOf(['**/*.puml']);
    expect(puml(['a.puml'])).toBe(true);
    expect(puml(['x', 'y', 'a.puml'])).toBe(true);
    expect(puml(['a.pumlx'])).toBe(false);
    expect(puml(['a.md'])).toBe(false);

    const middle = excludeOf(['a/**/b.md']);
    expect(middle(['a', 'b.md'])).toBe(true);
    expect(middle(['a', 'x', 'y', 'b.md'])).toBe(true);
    expect(middle(['a', 'x', 'c.md'])).toBe(false);
  });

  it('keeps `*` and `?` in a segment, `?` standing for one code point, and compares case by case', () => {
    const star = excludeOf(['docs/*.md']);
    expect(star(['docs', 'a.md'])).toBe(true);
    expect(star(['docs', '.md'])).toBe(true);
    expect(star(['docs', 'x', 'a.md'])).toBe(false);

    const one = excludeOf(['a?.md']);
    expect(one(['ab.md'])).toBe(true);
    expect(one(['a😀.md'])).toBe(true);
    expect(one(['a.md'])).toBe(false);
    expect(one(['abc.md'])).toBe(false);

    expect(excludeOf(['Docs/**'])(['docs', 'a.md'])).toBe(false);
    expect(excludeOf(['docs/**'])(['Docs', 'a.md'])).toBe(false);
  });

  it('neither trims nor expands a pattern, and matches any of the patterns', () => {
    const spaced = excludeOf([' docs/**']);
    expect(spaced([' docs', 'a.md'])).toBe(true);
    expect(spaced(['docs', 'a.md'])).toBe(false);
    expect(excludeOf(['$HOME/**'])(['$HOME', 'a.md'])).toBe(true);
    expect(excludeOf(['~/**'])(['~', 'a.md'])).toBe(true);

    const either = excludeOf(['a/**', 'b/*.md']);
    expect(either(['a', 'x.puml'])).toBe(true);
    expect(either(['b', 'x.md'])).toBe(true);
    expect(either(['c', 'x.md'])).toBe(false);
    expect(excludeOf([])(['a.md'])).toBe(false);
  });

  it('refuses the whole setting for a pattern its grammar does not read, saying which and why', () => {
    const cases: [unknown, string][] = [
      ['', 'empty'],
      ['!docs/**', 'negation'],
      ['docs\\x', 'backslash'],
      ['C:/x', 'colon'],
      ['file:///x', 'colon'],
      ['{a,b}/**', 'brackets'],
      ['[ab].md', 'brackets'],
      ['/docs', 'absolute'],
      ['docs/', 'trailing-slash'],
      ['a//b', 'empty-segment'],
      ['./a', 'dot-segment'],
      ['a/../b', 'dot-segment'],
      ['a/.', 'dot-segment'],
      ['a**', 'double-star'],
      ['***', 'double-star'],
      ['**b/c', 'double-star'],
      [3, 'not-text'],
      [null, 'not-text'],
      ['x'.repeat(WORKSPACE_SYMBOL_LIMITS.patternLength + 1), 'too-long'],
    ];
    for (const [pattern, problem] of cases) {
      expect(compileExclude(['docs/**', pattern]), JSON.stringify(pattern)).toEqual({ kind: 'pattern', index: 1, pattern, problem });
    }
    expect(typeof compileExclude(['x'.repeat(WORKSPACE_SYMBOL_LIMITS.patternLength)])).toBe('function');
  });

  it('refuses a value that is not a list, and a list longer than the limit', () => {
    expect(compileExclude('docs/**')).toEqual({ kind: 'not-a-list' });
    expect(compileExclude(null)).toEqual({ kind: 'not-a-list' });
    expect(compileExclude({ 'docs/**': true })).toEqual({ kind: 'not-a-list' });
    const many = Array.from({ length: WORKSPACE_SYMBOL_LIMITS.patterns + 1 }, (_, index) => `d${index}/**`);
    expect(compileExclude(many)).toEqual({ kind: 'too-many', count: WORKSPACE_SYMBOL_LIMITS.patterns + 1 });
    expect(typeof compileExclude(many.slice(1))).toBe('function');
  });

  it('matches without going back more than the patterns allow', () => {
    const name = 'a'.repeat(250);
    const started = performance.now();
    expect(excludeOf(['*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b'])([name])).toBe(false);
    expect(excludeOf(['**/**/**/**/**/**/**/**/x'])(Array.from({ length: 64 }, () => 'a'))).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('walkRoots', () => {
  it('finds the Markdown and PlantUML files directory by directory in name order, each with its path from its root', async () => {
    const deps = depsOf({
      ws: {
        'b.md': 'file',
        'a.puml': 'file',
        'notes.txt': 'file',
        'c.inc': 'file',
        sub: { 'c.markdown': 'file', 'd.iuml': 'file', deeper: { 'e.wsd': 'file' } },
        'z.plantuml': 'file',
      },
    });
    const walk = await walkRoots([root('ws')], deps);
    expect(walk.files).toEqual([
      { root: 0, path: 'ws/a.puml', segments: ['a.puml'], markdown: false },
      { root: 0, path: 'ws/b.md', segments: ['b.md'], markdown: true },
      { root: 0, path: 'ws/z.plantuml', segments: ['z.plantuml'], markdown: false },
      { root: 0, path: 'ws/sub/c.markdown', segments: ['sub', 'c.markdown'], markdown: true },
      { root: 0, path: 'ws/sub/d.iuml', segments: ['sub', 'd.iuml'], markdown: false },
      { root: 0, path: 'ws/sub/deeper/e.wsd', segments: ['sub', 'deeper', 'e.wsd'], markdown: false },
    ]);
    expect(walk.shortfalls).toEqual(new Set());
    expect(walk.stopped).toBe(false);
  });

  it('skips version control and build folders, links and what is neither a file nor a folder, without saying it fell short', async () => {
    const deps = depsOf({
      ws: {
        '.git': { 'a.md': 'file' },
        '.hg': { 'a.md': 'file' },
        '.svn': { 'a.md': 'file' },
        node_modules: { 'a.md': 'file' },
        dist: { 'a.md': 'file' },
        build: { 'a.md': 'file' },
        linked: 'link',
        'linked.md': 'link',
        'pipe.puml': 'other',
        docs: { 'kept.md': 'file' },
      },
    });
    const walk = await walkRoots([root('ws')], deps);
    expect(walk.files.map(({ path }) => path)).toEqual(['ws/docs/kept.md']);
    expect(deps.listed).toEqual(['ws', 'ws/docs']);
    expect(walk.shortfalls).toEqual(new Set());
  });

  it('leaves out what the setting names, and does not list a folder it leaves out', async () => {
    const deps = depsOf({
      ws: {
        docs: { 'a.md': 'file', old: { 'b.md': 'file' } },
        src: { 'c.puml': 'file', 'd.wsd': 'file' },
        'e.puml': 'file',
      },
    });
    const walk = await walkRoots([root('ws', excludeOf(['docs/**', '**/*.wsd']))], deps);
    expect(walk.files.map(({ path }) => path)).toEqual(['ws/e.puml', 'ws/src/c.puml']);
    expect(deps.listed).toEqual(['ws', 'ws/src']);
    expect(walk.shortfalls).toEqual(new Set());
  });

  it('leaves a workspace folder inside another to its own walk, so that each file is found once', async () => {
    const deps = depsOf({
      outer: { 'a.md': 'file', inner: { 'b.md': 'file' } },
      inner: { 'b.md': 'file' },
    });
    const walk = await walkRoots([root('outer', undefined, ['inner']), root('inner')], deps);
    expect(walk.files.map(({ root: at, path }) => [at, path])).toEqual([
      [0, 'outer/a.md'],
      [1, 'inner/b.md'],
    ]);
  });

  it('stops at the files limit for all the roots together, rather than for each', async () => {
    const half = Math.floor(WORKSPACE_SYMBOL_LIMITS.files / 2);
    const deps = depsOf({ a: files(half), b: files(WORKSPACE_SYMBOL_LIMITS.files - half + 1) });
    const walk = await walkRoots([root('a'), root('b')], deps);
    expect(walk.files).toHaveLength(WORKSPACE_SYMBOL_LIMITS.files);
    expect(walk.files.filter(({ root: at }) => at === 1)).toHaveLength(WORKSPACE_SYMBOL_LIMITS.files - half);
    expect(walk.shortfalls).toEqual(new Set(['files']));

    const exactly = await walkRoots([root('a'), root('b')], depsOf({ a: files(half), b: files(WORKSPACE_SYMBOL_LIMITS.files - half) }));
    expect(exactly.files).toHaveLength(WORKSPACE_SYMBOL_LIMITS.files);
    expect(exactly.shortfalls).toEqual(new Set());
  });

  it('takes entries one at a time and stops listing a folder at the entries limit, keeping what it found', async () => {
    // A lower limit than the real one, which a folder of twice as many entries makes slow to build.
    const limits = { ...WORKSPACE_SYMBOL_LIMITS, entries: 1_000 };
    const huge = { ...files(3), ...files(limits.entries * 2, 'txt') };
    const deps = depsOf({ ws: { huge, later: { 'x.md': 'file' } } });
    const walk = await walkRoots([root('ws')], deps, undefined, limits);
    expect(walk.shortfalls).toEqual(new Set(['entries']));
    // The root's two entries, then the huge folder up to the limit and one more, which is not taken.
    expect(deps.given).toBe(limits.entries + 1);
    expect(walk.files.map(({ path }) => path)).toEqual(['ws/huge/f0000.puml', 'ws/huge/f0001.puml', 'ws/huge/f0002.puml']);
    expect(deps.listed).not.toContain('ws/later');
  });

  it('stops at the folders limit, and does not go deeper than the depth limit', async () => {
    const wide = Object.fromEntries(Array.from({ length: WORKSPACE_SYMBOL_LIMITS.directories }, (_, index) => [`d${index}`, {}]));
    const many = await walkRoots([root('ws')], depsOf({ ws: wide }));
    expect(many.shortfalls).toEqual(new Set(['directories']));

    let deep: Tree = { 'bottom.md': 'file' };
    for (let level = WORKSPACE_SYMBOL_LIMITS.depth + 1; level > 0; level -= 1) {
      deep = { [`l${level}`]: deep, [`at${level}.md`]: 'file' };
    }
    const walk = await walkRoots([root('ws')], depsOf({ ws: deep }));
    expect(walk.shortfalls).toEqual(new Set(['depth']));
    const found = walk.files.map(({ segments }) => segments.length);
    // The files of the folders up to the limit, in the deepest of them too; nothing below.
    expect(Math.max(...found)).toBe(WORKSPACE_SYMBOL_LIMITS.depth + 1);
    expect(walk.files).toHaveLength(WORKSPACE_SYMBOL_LIMITS.depth + 1);
  });

  it('stops when the time is up, counted from when the search started', async () => {
    let now = 0;
    const deps = depsOf({ ws: { a: { 'a.md': 'file' }, b: { 'b.md': 'file' } } }, { now: () => now });
    const list = deps.list;
    deps.list = (path) => {
      now = path === 'ws/a' ? WORKSPACE_SYMBOL_LIMITS.milliseconds + 1 : now;
      return list(path);
    };
    const walk = await walkRoots([root('ws')], deps, 0);
    expect(walk.shortfalls).toEqual(new Set(['time']));
    expect(deps.listed).toEqual(['ws', 'ws/a']);
  });

  it('says which folders it could not list, and goes on with the others', async () => {
    const deps = depsOf({ ws: { broken: 'unlistable', ok: { 'a.md': 'file' } } });
    const walk = await walkRoots([root('ws')], deps);
    expect(walk.shortfalls).toEqual(new Set(['unlisted']));
    expect(walk.unlisted).toEqual(['ws/broken']);
    expect(walk.files.map(({ path }) => path)).toEqual(['ws/ok/a.md']);
  });

  it('ends when it is no longer wanted, without saying it fell short', async () => {
    let wanted = true;
    const deps = depsOf({ ws: { a: { 'a.md': 'file' }, 'b.md': 'file' } }, { stopped: () => !wanted });
    const list = deps.list;
    deps.list = (path) => {
      wanted = false;
      return list(path);
    };
    const walk = await walkRoots([root('ws')], deps);
    expect(walk.stopped).toBe(true);
    expect(walk.shortfalls).toEqual(new Set());
    expect(deps.listed).toEqual(['ws']);
  });
});

/** The symbols as [name, kind, label, line, start, end, diagram, flags]. */
const rows = (symbols: readonly FileSymbol[]): unknown[][] =>
  symbols.map(({ name, kind, label, line, start, end, diagram, conditional, unclosed }) => [
    name,
    kind,
    label,
    line,
    start,
    end,
    diagram,
    [conditional ? 'conditional' : '', unclosed ? 'unclosed' : ''].filter((flag) => flag !== '').join(' '),
  ]);

describe('fileSymbols', () => {
  it('lists the named diagrams, the declared elements and the procedures, functions and macros of a PlantUML file', () => {
    const text = [
      '@startuml(id=orders)',
      'participant OrderService',
      '!if %true()',
      'class Billing',
      '!endif',
      '!procedure $notify($to)',
      'participant Hidden',
      '!endprocedure',
      '!function $total($a)',
      '!return $a + 1',
      '!endfunction',
      '!define MACRO(x) x',
      '!definelong LONG(x)',
      'x',
      '!enddefinelong',
      '!define COLOR #FF0000',
      '!$variable = 1',
      '@enduml',
      '@startuml',
      'actor User',
      '!procedure $open()',
      '@enduml',
      '@startjson(id=data)',
      '{ "participant": "Json" }',
      '@endjson',
      '@startuml(id=open)',
      'component Web',
    ].join('\n');
    expect(rows(fileSymbols(text, false))).toEqual([
      ['orders', 'diagram', '@startuml', 0, 13, 19, 'orders', ''],
      ['OrderService', 'participant', 'participant', 1, 12, 24, 'orders', ''],
      ['Billing', 'class', 'class', 3, 6, 13, 'orders', 'conditional'],
      ['$notify', 'procedure', '!procedure', 5, 11, 18, 'orders', ''],
      ['$total', 'function', '!function', 8, 10, 16, 'orders', ''],
      ['MACRO', 'define', '!define', 11, 8, 13, 'orders', ''],
      ['LONG', 'definelong', '!definelong', 12, 12, 16, 'orders', ''],
      ['COLOR', 'constant', '!define', 15, 8, 13, 'orders', ''],
      ['User', 'actor', 'actor', 19, 6, 10, '', ''],
      ['$open', 'procedure', '!procedure', 20, 11, 16, '', 'unclosed'],
      ['data', 'diagram', '@startjson', 22, 14, 18, 'data', ''],
      ['open', 'diagram', '@startuml', 25, 13, 17, 'open', 'unclosed'],
      ['Web', 'component', 'component', 26, 10, 13, 'open', 'unclosed'],
    ]);
  });

  it('reads a file without a start line, such as a file to include, as one diagram without a name', () => {
    const text = ['!procedure $shared()', '!endprocedure', 'participant Shared'].join('\n');
    expect(rows(fileSymbols(text, false))).toEqual([
      ['$shared', 'procedure', '!procedure', 0, 11, 18, '', ''],
      ['Shared', 'participant', 'participant', 2, 12, 18, '', ''],
    ]);
  });

  it('leaves out what lies between diagrams and in comments, and keeps declarations of one name apart', () => {
    const text = [
      'participant Before',
      '@startuml(id=a)',
      "' participant Commented",
      'participant Same',
      '@enduml',
      'participant Between',
      '@startuml(id=b)',
      'participant Same',
      '@enduml',
    ].join('\n');
    expect(rows(fileSymbols(text, false)).map(([name, , , line, , , diagram]) => [name, line, diagram])).toEqual([
      ['a', 1, 'a'],
      ['Same', 3, 'a'],
      ['b', 6, 'b'],
      ['Same', 7, 'b'],
    ]);
  });

  it('reads the blocks of a Markdown file, in quotes and list items too, at their columns in the document', () => {
    const text = [
      '# Title',
      '',
      '```plantuml orders',
      '@startuml(id=inner)',
      'participant OrderService',
      '@enduml',
      '```',
      '',
      '> ```puml quoted',
      '> participant Quoted',
      '> ```',
      '',
      '- item',
      '',
      '  ```plantuml',
      '  class Listed',
      '  ```',
      '',
      '```plantuml',
      '   participant Indented',
      '```',
      '',
      '```text',
      'participant NotADiagram',
      '```',
      '',
      '```plantuml open',
      'participant Unclosed',
    ].join('\n');
    expect(rows(fileSymbols(text, true))).toEqual([
      ['orders', 'diagram', '```plantuml', 2, 12, 18, 'orders', ''],
      ['inner', 'diagram', '@startuml', 3, 13, 18, 'inner', ''],
      ['OrderService', 'participant', 'participant', 4, 12, 24, 'inner', ''],
      ['quoted', 'diagram', '```puml', 8, 10, 16, 'quoted', ''],
      ['Quoted', 'participant', 'participant', 9, 14, 20, 'quoted', ''],
      ['Listed', 'class', 'class', 15, 8, 14, '', ''],
      ['Indented', 'participant', 'participant', 19, 15, 23, '', ''],
      ['open', 'diagram', '```plantuml', 26, 12, 16, 'open', 'unclosed'],
      ['Unclosed', 'participant', 'participant', 27, 12, 20, 'open', 'unclosed'],
    ]);
  });

  it('reads a PlantUML file with CRLF line ends at the same lines and columns', () => {
    const lines = ['@startuml(id=orders)', 'participant OrderService', '@enduml'];
    expect(fileSymbols(lines.join('\r\n'), false)).toEqual(fileSymbols(lines.join('\n'), false));
  });
});

describe('matchesQuery', () => {
  it('matches the characters of the query in their order, in any case', () => {
    expect(matchesQuery('OrderService', 'OrdSvc')).toBe(true);
    expect(matchesQuery('OrderService', 'ordsvc')).toBe(true);
    expect(matchesQuery('OrderService', 'Svc')).toBe(true);
    expect(matchesQuery('OrderService', 'service')).toBe(true);
    expect(matchesQuery('OrderService', 'cvs')).toBe(false);
    expect(matchesQuery('OrderService', 'OrderServiceX')).toBe(false);
    expect(matchesQuery('OrderService', '')).toBe(true);
    expect(matchesQuery('😀Box', '😀b')).toBe(true);
    expect(matchesQuery('$notify', 'notify')).toBe(true);
  });
});
