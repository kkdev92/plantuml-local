import { describe, expect, it } from 'vitest';

import { ANALYSIS_LIMITS } from '../../src/core/constants';
import { libraryLines } from '../../src/includes/included-lines';
import { declarationsOf } from '../../src/language/declarations';
import {
  covers,
  definitionsFor,
  macrosAt,
  readingOf,
  type AnalysisLimits,
  type MacroEntry,
  type Macros,
  type MacroSources,
} from '../../src/language/macros';

const BOM = String.fromCharCode(0xfeff);

/** What the includes of a diagram may read. */
interface World {
  /** Local files by path, wherever they are named from; a file's id is its path under `/w/`. */
  files?: Record<string, string[]>;
  /** Bundled libraries' files, by library and key. */
  libraries?: Record<string, Record<string, string[]>>;
  /** What the bundled libraries declare cannot be read. */
  brokenIndex?: boolean;
  /** The answer stops being wanted once this many files were asked for. */
  cancelAfter?: number;
  limits?: AnalysisLimits;
}

/** Sources for `world`, which note in `asked` each file asked for. */
function sourcesOf(world: World, asked: string[]): MacroSources {
  return {
    file(path, from, kind) {
      asked.push(`${kind} ${path} from ${from ?? 'diagram'}`);
      const lines = world.files?.[path];
      return Promise.resolve(lines === undefined ? null : { id: `/w/${path}`, text: lines.join('\n') });
    },
    library(library, key) {
      asked.push(`library ${library}/${key}`);
      if (world.brokenIndex === true) {
        return Promise.reject(new Error('unreadable'));
      }
      const files = world.libraries?.[library];
      if (files === undefined) {
        return Promise.resolve(undefined);
      }
      const lines = files[key];
      if (lines === undefined) {
        return Promise.resolve(null);
      }
      const read = libraryLines(lines.join('\n'));
      return Promise.resolve(declarationsOf(read.lines, read.numbers));
    },
    cancelled: () => world.cancelAfter !== undefined && asked.length >= world.cancelAfter,
  };
}

/**
 * What is defined at the line marked `‸` (the mark taken out), or after the
 * last line without one, in a diagram whose start line is line 0.
 */
function at(marked: readonly string[], world: World = {}, asked: string[] = []): Promise<Macros> {
  const row = marked.findIndex((line) => line.includes('‸'));
  const lines = marked.map((line) => line.replace('‸', ''));
  const numbers = lines.map((_, index) => index + 1);
  return macrosAt({ lines, numbers }, row === -1 ? lines.length + 1 : row + 1, sourcesOf(world, asked), world.limits);
}

/** Each name, with how sure it is, and how many candidates when more than one. */
function summary(macros: Macros): string[] {
  const list = (table: ReadonlyMap<string, MacroEntry>): string[] =>
    [...table]
      .map(([key, entry]) => {
        const count = entry.candidates.length > 1 ? ` ×${entry.candidates.length}` : '';
        return `${key} ${entry.certainty}${count}`;
      })
      .sort();
  return [...list(macros.callables), ...list(macros.variables)];
}

/** Where the candidates are written: `document:line`, `id:line` or `library/key:line`. */
function where(entry: MacroEntry | null | undefined): string[] {
  return (entry?.candidates ?? []).map(({ macro: { origin } }) => {
    const source =
      origin.source === 'document'
        ? 'document'
        : origin.source === 'file'
          ? origin.id
          : `${origin.library}/${origin.key}`;
    return `${source}:${origin.line}`;
  });
}

const values = (entry: MacroEntry | undefined): (string | undefined)[] =>
  (entry?.candidates ?? []).map(({ macro }) => macro.value);

const reasons = (macros: Macros): string[] => macros.shortfalls.map(({ reason, path }) => `${reason} ${path}`);

const PROCEDURE_A = ['!procedure A()', '!endprocedure'];
const PROCEDURE_P = ['!procedure P()', '!endprocedure'];

describe('macrosAt', () => {
  describe('in the diagram', () => {
    it('takes what is declared before the line of the cursor, by name and number of parameters', async () => {
      const macros = await at([
        '!procedure P($a)',
        'Alice -> Bob : $a',
        '!endprocedure',
        '!procedure P($a, $b)',
        '!endprocedure',
        '!function $f() return 1',
        '!$v = 1',
        '‸!procedure Q($q)',
        '!endprocedure',
      ]);
      expect(summary(macros)).toEqual(['$f/0 resolved', 'P/1 resolved', 'P/2 resolved', '$v resolved']);
      expect(macros.status).toBe('complete');
      expect(where(macros.callables.get('P/2'))).toEqual(['document:4']);
      expect(summary(await at(['!$v = 1', '‸!$w = 2']))).toEqual(['$v resolved']);
    });

    it('lets a later definition with the same name and number of parameters stand for an earlier one', async () => {
      const macros = await at(['!procedure P()', '!endprocedure', '!procedure P()', '!endprocedure', '‸']);
      expect(summary(macros)).toEqual(['P/0 resolved']);
      expect(where(macros.callables.get('P/0'))).toEqual(['document:3']);
    });

    it('keeps what `!if`, `!while` and `!foreach` may leave out along with what it may stand for', async () => {
      const branches = [
        '!if $c',
        '!procedure P()',
        '!endprocedure',
        '!else',
        '!procedure P()',
        '!endprocedure',
        '!endif',
      ];
      expect(summary(await at([...branches, '‸']))).toEqual(['P/0 ambiguous ×2']);
      expect(summary(await at([...branches, ...['!procedure P()', '!endprocedure'], '‸']))).toEqual(['P/0 resolved']);
      expect(summary(await at(['!if 0', '!define F(x) [x]', '!endif', '‸']))).toEqual(['F/1 ambiguous']);
      const loops = ['!foreach $i in [1, 2]', '!$x = $i', '!endfor', '!while $w', '!$y = 1', '!endwhile', '‸'];
      expect(summary(await at(loops))).toEqual(['$i ambiguous', '$x ambiguous', '$y ambiguous']);
    });

    it('lets `!undef` remove a variable, and leaves procedures, functions and macros', async () => {
      const macros = await at([
        '!$x = 1',
        '!define FOO hello',
        '!define F(a) [a]',
        '!procedure P()',
        '!endprocedure',
        '!undef $x',
        '!undef FOO',
        '!undef F',
        '!undef P',
        '‸',
      ]);
      expect(summary(macros)).toEqual(['F/1 resolved', 'P/0 resolved']);
      expect(summary(await at(['!$x = 1', '!if $c', '!undef $x', '!endif', '‸']))).toEqual(['$x ambiguous']);
    });

    it('lets `?=` give a value only to a variable without one', async () => {
      const macros = await at(['!$x = 1', '!$x ?= 2', '!$y ?= 3', '!if $c', '!$z = 4', '!endif', '!$z ?= 5', '‸']);
      expect(summary(macros)).toEqual(['$x resolved', '$y resolved', '$z ambiguous ×2']);
      expect(values(macros.variables.get('$x'))).toEqual(['1']);
      expect(values(macros.variables.get('$y'))).toEqual(['3']);
      // Text that was not read may have given it one.
      expect(summary(await at(['!$d = 1', '!include $d/x.iuml', '!$y ?= 3', '‸']))).toEqual([
        '$d unresolved',
        '$y ambiguous',
      ]);
    });

    it('tells a `!define` with parameters, a macro, from one without, a variable', async () => {
      const macros = await at(['!define FOO hello', '!define F(x) [x]', '‸']);
      expect(summary(macros)).toEqual(['F/1 resolved', 'FOO resolved']);
      expect(macros.callables.get('F/1')?.candidates[0]?.macro.kind).toBe('define');
      expect(macros.variables.get('FOO')?.candidates[0]?.macro.kind).toBe('constant');
    });

    it('keeps the comment above a definition', async () => {
      const macros = await at(["' Says hello.", '!procedure H()', '!endprocedure', '‸']);
      expect(macros.callables.get('H/0')?.candidates[0]?.macro.comment).toBe('Says hello.');
    });

    it('keeps a `!final` definition when another follows', async () => {
      const macros = await at(['!final procedure P()', '!endprocedure', '!procedure P()', '!endprocedure', '‸']);
      expect(summary(macros)).toEqual(['P/0 resolved']);
      expect(where(macros.callables.get('P/0'))).toEqual(['document:1']);
    });

    it('takes, in the body the cursor is in, its parameters and what it declares before, and not the body', async () => {
      const macros = await at([
        '!$g = 0',
        '!procedure P($a, $b="1")',
        '!local $l = 2',
        '‸',
        '!$after = 3',
        '!endprocedure',
      ]);
      expect(summary(macros)).toEqual(['$a resolved', '$b resolved', '$g resolved', '$l resolved']);
      expect(values(macros.variables.get('$b'))).toEqual(['"1"']);
      expect(macros.variables.get('$a')?.candidates[0]?.macro).toMatchObject({
        kind: 'parameter',
        origin: { line: 2 },
      });
      expect(summary(await at(['!procedure P($a)', '‸!endprocedure']))).toEqual(['$a resolved']);
      expect(summary(await at(['!procedure P($a)', 'Alice -> Bob', '‸']))).toEqual(['$a resolved']);
      expect(summary(await at(['!procedure P($a)', '!local $l = 2', '!endprocedure', '‸']))).toEqual(['P/1 resolved']);
    });

    it('takes nothing a comment holds', async () => {
      expect(summary(await at(["/'", '!procedure P()', '!endprocedure', "'/", "' !procedure Q()", '‸']))).toEqual([]);
    });
  });

  describe('through includes', () => {
    const world: World = { files: { 'a.iuml': ['!procedure P()', '!endprocedure', '!$v = 1'] } };
    const redefined = ['!procedure P()', '!endprocedure'];

    it('takes what a file declares at the line of its include', async () => {
      const macros = await at(['!include a.iuml', '‸'], world);
      expect(summary(macros)).toEqual(['P/0 resolved', '$v resolved']);
      expect(where(macros.callables.get('P/0'))).toEqual(['/w/a.iuml:0']);
      expect(where((await at(['!include a.iuml', ...redefined, '‸'], world)).callables.get('P/0'))).toEqual([
        'document:2',
      ]);
      const asked: string[] = [];
      expect(summary(await at(['‸', '!include a.iuml'], world, asked))).toEqual([]);
      expect(asked).toEqual([]);
    });

    it('reads the diagram an include names, with its lines as the file has them', async () => {
      const two = {
        files: {
          'm.puml': [
            '@startuml',
            ...PROCEDURE_A,
            '@enduml',
            '@startuml(id=SECOND)',
            '!procedure B()',
            '!endprocedure',
            '@enduml',
          ],
        },
      };
      expect(summary(await at(['!include m.puml', '‸'], two))).toEqual(['A/0 resolved']);
      expect(where((await at(['!include m.puml!1', '‸'], two)).callables.get('B/0'))).toEqual(['/w/m.puml:5']);
      expect(summary(await at(['!include m.puml!SECOND', '‸'], two))).toEqual(['B/0 resolved']);
      const missing = await at(['!include m.puml!5', '‸'], two);
      expect(summary(missing)).toEqual([]);
      expect(reasons(missing)).toEqual(['no-part m.puml!5']);
      expect(missing.status).toBe('partial');
    });

    it('reads a file whose first line starts with a byte order mark', async () => {
      const marked = { files: { 'b.iuml': [`${BOM}!procedure P()`, '!endprocedure'] } };
      expect(summary(await at(['!include b.iuml', '‸'], marked))).toEqual(['P/0 resolved']);
    });

    it('skips a file `!include` read, stops on one for `!include_once`, and reads it again for `!include_many`', async () => {
      const asked: string[] = [];
      const again = await at(['!include a.iuml', ...redefined, '!include a.iuml', '‸'], world, asked);
      expect(where(again.callables.get('P/0'))).toEqual(['document:2']);
      expect(again.status).toBe('complete');
      expect(asked).toEqual(['include a.iuml from diagram']);
      const once = await at(['!include a.iuml', ...redefined, '!include_once a.iuml', '‸'], world);
      expect(where(once.callables.get('P/0'))).toEqual(['document:2']);
      expect(reasons(once)).toEqual(['once a.iuml']);
      const many = await at(['!include a.iuml', ...redefined, '!include_many a.iuml', '‸'], world);
      expect(where(many.callables.get('P/0'))).toEqual(['/w/a.iuml:0']);
      const manyFirst = await at(['!include_many a.iuml', ...redefined, '!include a.iuml', '‸'], world);
      expect(where(manyFirst.callables.get('P/0'))).toEqual(['document:2']);
    });

    it('keeps what an include the text may not run reads as conditional', async () => {
      const inside = { files: { 'i.iuml': ['!if $c', ...PROCEDURE_P, '!endif'] } };
      expect(summary(await at(['!include i.iuml', '‸'], inside))).toEqual(['P/0 ambiguous']);
      expect(summary(await at(['!if $c', '!include a.iuml', '!endif', '‸'], world))).toEqual([
        'P/0 ambiguous',
        '$v ambiguous',
      ]);
      // Read again or not, as the first one was read or not.
      const then = await at(['!if $c', '!include a.iuml', '!endif', '!include a.iuml', '‸'], world);
      expect(summary(then)).toEqual(['P/0 ambiguous', '$v ambiguous']);
      // The same definitions, read again or not, change nothing.
      const read = await at(['!include a.iuml', '!if $c', '!include_many a.iuml', '!endif', '‸'], world);
      expect(summary(read)).toEqual(['P/0 resolved', '$v resolved']);
      const between = await at(['!if $c', '!include a.iuml', '!endif', ...redefined, '!include a.iuml', '‸'], world);
      expect(summary(between)).toEqual(['P/0 ambiguous ×2', '$v ambiguous']);
      // A file every run reads stays read, whatever reads it again under a condition.
      const kept = [
        '!include a.iuml',
        '!if $c',
        '!include_many a.iuml',
        '!endif',
        ...redefined,
        '!include a.iuml',
        '‸',
      ];
      expect(summary(await at(kept, world))).toEqual(['P/0 resolved', '$v resolved']);
    });

    it('tells definitions apart by the text and the line they are written on', async () => {
      const files = { 'a.iuml': PROCEDURE_P, 'b.iuml': PROCEDURE_P, 'c.iuml': ['', '', ...PROCEDURE_P] };
      const libraries = { c4: { x: PROCEDURE_P, y: PROCEDURE_P } };
      const includes = ['!include a.iuml', '!include b.iuml', '!include c.iuml', '!include <C4/x>', '!include <C4/y>'];
      const macros = await at(['!if $c', ...PROCEDURE_P, ...includes, '!endif', '‸'], { files, libraries });
      expect(summary(macros)).toEqual(['P/0 ambiguous ×6']);
    });

    it('reads the section `!includesub` names', async () => {
      const sections = {
        files: {
          's.iuml': ['!startsub PART', '!procedure S()', '!endprocedure', '!endsub', '!procedure T()', '!endprocedure'],
        },
      };
      const asked: string[] = [];
      const macros = await at(['!includesub s.iuml!PART', '‸'], sections, asked);
      expect(summary(macros)).toEqual(['S/0 resolved']);
      expect(where(macros.callables.get('S/0'))).toEqual(['/w/s.iuml:1']);
      expect(asked).toEqual(['includesub s.iuml from diagram']);
      expect(reasons(await at(['!includesub s.iuml!OTHER', '‸'], sections))).toEqual(['no-part s.iuml!OTHER']);
      expect(summary(await at(['!if $c', '!includesub s.iuml!PART', '!endif', '‸'], sections))).toEqual([
        'S/0 ambiguous',
      ]);
      expect((await at(['!includesub !PART', '‸'], sections)).status).toBe('complete');
    });

    it('does not take a body an included file never closes', async () => {
      const open = { files: { 'o.iuml': ['!procedure P()', 'Alice -> Bob'] } };
      expect(summary(await at(['!include o.iuml', '‸'], open))).toEqual([]);
    });

    it('follows includes 32 deep, as the render does', async () => {
      const files: Record<string, string[]> = {};
      for (let depth = 1; depth <= 33; depth += 1) {
        files[`f${depth}.iuml`] = [`!include f${depth + 1}.iuml`, `!procedure P${depth}()`, '!endprocedure'];
      }
      const macros = await at(['!include f1.iuml', '‸'], { files });
      expect([macros.callables.has('P32/0'), macros.callables.has('P33/0')]).toEqual([true, false]);
      expect(reasons(macros)).toEqual(['depth f33.iuml']);
    });

    it('reads the includes of an included file from that file, and ends a loop of them', async () => {
      const nested = {
        files: { 'a.iuml': ['!include b.iuml', ...PROCEDURE_A], 'b.iuml': ['!procedure B()', '!endprocedure'] },
      };
      const asked: string[] = [];
      expect(summary(await at(['!include a.iuml', '‸'], nested, asked))).toEqual(['A/0 resolved', 'B/0 resolved']);
      expect(asked).toEqual(['include a.iuml from diagram', 'include b.iuml from /w/a.iuml']);
      const loop = {
        files: {
          'a.iuml': ['!include b.iuml', ...PROCEDURE_A],
          'b.iuml': ['!include a.iuml', '!procedure B()', '!endprocedure'],
        },
      };
      expect(summary(await at(['!include a.iuml', '‸'], loop))).toEqual(['A/0 resolved', 'B/0 resolved']);
      const deep = await at(['!include a.iuml', '‸'], { files: { 'a.iuml': ['!include_many a.iuml'] } });
      expect(reasons(deep)).toEqual(['depth a.iuml']);
    });

    it('does not read an include in a body, which runs when the body does, unless the cursor is in that body', async () => {
      const asked: string[] = [];
      const macros = await at(['!procedure Q()', '!include a.iuml', '!endprocedure', '‸'], world, asked);
      expect(summary(macros)).toEqual(['Q/0 resolved']);
      expect(reasons(macros)).toEqual(['in-body a.iuml']);
      expect(asked).toEqual([]);
      expect(summary(await at(['!procedure Q()', '!include a.iuml', '‸', '!endprocedure'], world))).toEqual([
        'P/0 resolved',
        '$v resolved',
      ]);
      const file = { files: { 'q.iuml': ['!procedure Q()', '!include a.iuml', '!endprocedure'], ...world.files } };
      expect(reasons(await at(['!include q.iuml', '‸'], file))).toEqual(['in-body a.iuml']);
    });

    it('leaves the definitions before a file that cannot be read as they are', async () => {
      const macros = await at([...redefined, '!include missing.iuml', '‸']);
      expect(summary(macros)).toEqual(['P/0 resolved']);
      expect(reasons(macros)).toEqual(['unreadable missing.iuml']);
      expect(macros.status).toBe('partial');
    });
  });

  describe('past what is not read', () => {
    const world: World = { files: { 'a.iuml': PROCEDURE_A, 'lib/a.iuml': PROCEDURE_A } };

    it('does not read an include whose path takes a value when the text runs, and leaves what is before unresolved', async () => {
      const asked: string[] = [];
      const macros = await at(
        [
          '!procedure P()',
          '!endprocedure',
          '!$dir = "lib"',
          '!include $dir/a.iuml',
          '!procedure Q()',
          '!endprocedure',
          '‸',
        ],
        world,
        asked
      );
      expect(summary(macros)).toEqual(['P/0 unresolved', 'Q/0 resolved', '$dir unresolved']);
      expect(reasons(macros)).toEqual(['dynamic $dir/a.iuml']);
      expect(asked).toEqual([]);
    });

    it('reads a variable or a call in a path as the engine finds them in text', async () => {
      const constant = '!define ROOT lib';
      expect(reasons(await at([constant, '!include ROOT/a.iuml', '‸'], world))).toEqual(['dynamic ROOT/a.iuml']);
      expect(reasons(await at([constant, '!include ROOTS/a.iuml', '‸'], world))).toEqual(['unreadable ROOTS/a.iuml']);
      expect(reasons(await at([constant, '!include xROOT/a.iuml', '‸'], world))).toEqual(['unreadable xROOT/a.iuml']);
      // Right after a written `\n`, a name starts.
      expect(reasons(await at([constant, '!include x\\nROOT/a.iuml', '‸'], world))).toEqual([
        'dynamic x\\nROOT/a.iuml',
      ]);
      expect(reasons(await at(['!$d = 1', '!include x$d/a.iuml', '‸'], world))).toEqual(['dynamic x$d/a.iuml']);
      const call = ['!function lib() return "lib"', '!include lib()/a.iuml', '‸'];
      expect(reasons(await at(call, world))).toEqual(['dynamic lib()/a.iuml']);
      expect(reasons(await at(['!include %getenv("D")/a.iuml', '‸'], world))).toEqual(['dynamic %getenv("D")/a.iuml']);
      // A variable nothing defines stays in the path, unless text that was not read may define it.
      expect(reasons(await at(['!include $other/a.iuml', '‸'], world))).toEqual(['unreadable $other/a.iuml']);
      expect(reasons(await at(['!$part = 1', '!include m.puml!$part', '‸'], world))).toEqual(['dynamic m.puml!$part']);
      expect(reasons(await at(['!$d = 1', '!include $d/a.iuml', '!include $other/a.iuml', '‸'], world))).toEqual([
        'dynamic $d/a.iuml',
        'dynamic $other/a.iuml',
      ]);
    });

    it('does not read a diagram the engine looks for by a pattern', async () => {
      const two = { files: { 'm.puml': ['@startuml', ...PROCEDURE_A, '@enduml'] } };
      const macros = await at(['!procedure P()', '!endprocedure', '!include m.puml!A.*', '‸'], two);
      expect(summary(macros)).toEqual(['P/0 unresolved']);
      expect(reasons(macros)).toEqual(['pattern m.puml!A.*']);
    });

    it('does not read a file past the analysis limits', async () => {
      const files = { 'big.iuml': [...PROCEDURE_A, "' 3", "' 4"], 'small.iuml': ['!procedure S()', '!endprocedure'] };
      const included = ['!procedure P()', '!endprocedure', '!include big.iuml', '!include small.iuml', '‸'];
      const lines = await at(included, { files, limits: { ...ANALYSIS_LIMITS, fileLines: 3 } });
      expect(summary(lines)).toEqual(['P/0 unresolved', 'S/0 resolved']);
      expect(reasons(lines)).toEqual(['too-large big.iuml']);
      const bytes = await at(included, { files, limits: { ...ANALYSIS_LIMITS, fileBytes: 28 } });
      expect(reasons(bytes)).toEqual(['too-large big.iuml']);
      // 32 bytes of the diagram, then 28 of a.iuml: b.iuml's 28 more are past 70.
      const two = { 'a.iuml': PROCEDURE_A, 'b.iuml': ['!procedure B()', '!endprocedure'] };
      const total = await at(['!include a.iuml', '!include b.iuml', '‸'], {
        files: two,
        limits: { ...ANALYSIS_LIMITS, totalBytes: 70 },
      });
      expect(summary(total)).toEqual(['A/0 unresolved']);
      expect(reasons(total)).toEqual(['too-large b.iuml']);
    });
  });

  describe('from the bundled libraries', () => {
    const libraries = {
      c4: {
        c4: ['!procedure Base($a)', '!endprocedure'],
        c4_context: ['!include <C4/C4>', '!procedure Person($alias, $label = "")', '!endprocedure'],
      },
    };

    it('reads a library file by its name in lower case, and what it includes', async () => {
      const asked: string[] = [];
      const macros = await at(['!include <C4/C4_Context>', '‸'], { libraries }, asked);
      expect(summary(macros)).toEqual(['Base/1 resolved', 'Person/2 resolved']);
      expect(where(macros.callables.get('Person/2'))).toEqual(['c4/c4_context:1']);
      expect(asked).toEqual(['library c4/c4_context', 'library c4/c4']);
      expect(summary(await at(['!include <c4/c4_context>', '‸'], { libraries }))).toEqual([
        'Base/1 resolved',
        'Person/2 resolved',
      ]);
      const azure = { azure: { 'compute/azurefunction': ['!procedure AzureFunction($alias)', '!endprocedure'] } };
      expect(summary(await at(['!include <azure/Compute/AzureFunction>', '‸'], { libraries: azure }))).toEqual([
        'AzureFunction/1 resolved',
      ]);
    });

    it('does not read a local file a library names', async () => {
      const asked: string[] = [];
      const local = { libraries: { c4: { local: ['!include x.iuml'] } }, files: { 'x.iuml': PROCEDURE_A } };
      const macros = await at(['!include <C4/local>', '‸'], local, asked);
      expect(summary(macros)).toEqual([]);
      expect(reasons(macros)).toEqual(['unreadable x.iuml']);
      expect(asked).toEqual(['library c4/local']);
    });

    it('reads a library file whole, whatever follows its `!`', async () => {
      const macros = await at(['!include <C4/C4>!1', '‸'], { libraries });
      expect(summary(macros)).toEqual(['Base/1 resolved']);
      expect(macros.status).toBe('complete');
    });

    it('reads a library file each time it is included', async () => {
      const twice = await at(['!include_once <C4/C4>', '!include_once <C4/C4>', '‸'], { libraries });
      expect(twice.status).toBe('complete');
      expect(summary(await at(['!include <C4/C4_Context>', '!include <C4/C4>', '‸'], { libraries }))).toEqual([
        'Base/1 resolved',
        'Person/2 resolved',
      ]);
    });

    it('says when no bundled library has the file, its extension written or not', async () => {
      expect(reasons(await at(['!include <C4/C4_Context.puml>', '‸'], { libraries }))).toEqual([
        'not-bundled <C4/C4_Context.puml>',
      ]);
      expect(reasons(await at(['!include <aws/Compute>', '‸'], { libraries }))).toEqual(['not-bundled <aws/Compute>']);
      expect(reasons(await at(['!include <C4>', '‸'], { libraries }))).toEqual(['not-bundled <C4>']);
      // Without its `!` and what follows, the path is not between `<` and `>`: a local file's.
      const asked: string[] = [];
      expect(reasons(await at(['!include <C4/C4!1>', '‸'], { libraries }, asked))).toEqual(['unreadable <C4/C4!1>']);
      expect(asked).toEqual(['include <C4/C4 from diagram']);
    });

    it('leaves what is before unresolved when what a library declares cannot be read', async () => {
      const broken = await at(['!procedure P()', '!endprocedure', '!include <C4/C4>', '‸'], {
        libraries,
        brokenIndex: true,
      });
      expect(summary(broken)).toEqual(['P/0 unresolved']);
      expect(reasons(broken)).toEqual(['index <C4/C4>']);
    });

    it('does not read an include a library puts together when it runs', async () => {
      const azure = {
        azure: {
          all: [
            '!procedure Common()',
            '!endprocedure',
            "!$azure = %load_json('<azure/all.json>')",
            '!foreach $item in $azure',
            '!include <azure/$item/all>',
            '!endfor',
          ],
        },
      };
      const macros = await at(['!include <azure/all>', '‸'], { libraries: azure });
      expect(reasons(macros)).toEqual(['dynamic <azure/$item/all>']);
      expect(summary(macros)).toEqual(['Common/0 unresolved', '$azure unresolved', '$item unresolved']);
    });
  });

  it('gives nothing once the answer is no longer wanted', async () => {
    const macros = await at(['!procedure P()', '!endprocedure', '!include a.iuml', '‸'], {
      files: { 'a.iuml': PROCEDURE_A },
      cancelAfter: 1,
    });
    expect(macros).toEqual({ status: 'cancelled', shortfalls: [], callables: new Map(), variables: new Map() });
  });
});

describe('readingOf', () => {
  it('reads the arguments of a name as its definitions say', async () => {
    const macros = await at([
      '!define F(x) [x]',
      '!procedure F($a, $b)',
      '!endprocedure',
      '!unquoted procedure U($a)',
      '!endprocedure',
      '!procedure U($a, $b)',
      '!endprocedure',
      '!procedure Q()',
      '!endprocedure',
      '!definelong G($a)',
      'x',
      '!enddefinelong',
      '‸',
    ]);
    expect(readingOf(macros, 'F')).toBe('legacy');
    expect(readingOf(macros, 'G')).toBe('legacy');
    expect(readingOf(macros, 'U')).toBe('unquoted');
    expect(readingOf(macros, 'Q')).toBe('quoted');
    expect(readingOf(macros, 'R')).toBeNull();
  });
});

describe('covers', () => {
  const parameters = [{ name: '$a' }, { name: '$b', default: '1' }];

  it('takes as many arguments by position as there are parameters, and as few as those without a default', () => {
    expect([0, 1, 2, 3].map((count) => covers(parameters, count, []))).toEqual([false, true, true, false]);
  });

  it('takes arguments named as the parameters are, `$` and all', () => {
    expect(covers(parameters, 0, ['$a'])).toBe(true);
    expect(covers(parameters, 1, ['$c'])).toBe(false);
    expect(covers(parameters, 0, ['a'])).toBe(false);
  });
});

describe('definitionsFor', () => {
  const picked = (entry: MacroEntry | null): { lines: number[]; certainty: string } | null =>
    entry === null
      ? null
      : { lines: entry.candidates.map(({ macro }) => macro.origin.line), certainty: entry.certainty };

  it('picks the definition with as many parameters as there are arguments by position, or the one that takes the call', async () => {
    const macros = await at([
      '!procedure Q($a, $b="1")',
      '!endprocedure',
      '!procedure Q($a, $b="2", $c="3")',
      '!endprocedure',
      '!procedure R($a, $b="1")',
      '!endprocedure',
      '‸',
    ]);
    expect(picked(definitionsFor(macros, 'Q', 2, []))).toEqual({ lines: [1], certainty: 'resolved' });
    expect(picked(definitionsFor(macros, 'R', 1, []))).toEqual({ lines: [5], certainty: 'resolved' });
    expect(picked(definitionsFor(macros, 'Q', 1, ['$c']))).toEqual({ lines: [3], certainty: 'resolved' });
    expect(picked(definitionsFor(macros, 'R', 3, []))).toBeNull();
  });

  it('does not pick one of two that take the call', async () => {
    // Written with more parameters first, they come fewest first.
    const macros = await at([
      '!procedure Q($a, $b="2", $c="3")',
      '!endprocedure',
      '!procedure Q($a, $b="1")',
      '!endprocedure',
    ]);
    expect(picked(definitionsFor(macros, 'Q', 1, []))).toEqual({ lines: [3, 1], certainty: 'ambiguous' });
  });

  it('keeps one that takes the call along with one with as many parameters the text may leave out', async () => {
    const macros = await at([
      '!if $x',
      '!procedure S($a)',
      '!endprocedure',
      '!endif',
      '!procedure S($a, $b="1")',
      '!endprocedure',
    ]);
    expect(picked(definitionsFor(macros, 'S', 1, []))).toEqual({ lines: [2, 5], certainty: 'ambiguous' });
    expect(picked(definitionsFor(macros, 'S', 1, ['$b']))).toEqual({ lines: [2, 5], certainty: 'ambiguous' });
  });

  it('says a definition that text that was not read may stand for is unresolved', async () => {
    const macros = await at([
      '!procedure T($a, $b="1")',
      '!endprocedure',
      '!procedure T($a, $b="1", $c="2")',
      '!endprocedure',
      '!procedure U($a, $b="1")',
      '!endprocedure',
      '!$d = 1',
      '!include $d/x.iuml',
    ]);
    expect(picked(definitionsFor(macros, 'T', 2, []))).toEqual({ lines: [1], certainty: 'unresolved' });
    expect(picked(definitionsFor(macros, 'T', 1, []))).toEqual({ lines: [1, 3], certainty: 'unresolved' });
    expect(picked(definitionsFor(macros, 'U', 1, []))).toEqual({ lines: [5], certainty: 'unresolved' });
  });
});
