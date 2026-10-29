import { describe, expect, it } from 'vitest';

import { libraryLines } from '../../src/includes/included-lines';
import { callAt, type Call } from '../../src/language/calls';
import { declarationsOf } from '../../src/language/declarations';
import {
  declarationOf,
  diagramLinesAt,
  libraryFile,
  macroPlace,
  macroSuggestions,
  nameAround,
  signaturesFor,
  type MacroLabels,
} from '../../src/language/macro-help';
import { macrosAt, readingOf, type MacroEntry, type Macros, type MacroSources } from '../../src/language/macros';

/** Words that say what each one stands for. */
const labels: MacroLabels = {
  kinds: {
    procedure: 'procedure',
    function: 'function',
    define: 'macro',
    definelong: 'multi-line macro',
    constant: 'constant',
    variable: 'variable',
    parameter: 'parameter',
  },
  diagram: 'this diagram',
  file: (id) => `file ${id}`,
  library: (library, key) => libraryFile(library, key),
  conditional: 'conditional',
  ambiguous: 'ambiguous',
  unresolved: 'unresolved',
  definitions: (count) => `${String(count)} definitions`,
  line: (place, line) => `${place}, line ${String(line)}`,
};

/** What the includes of a diagram may read: local files by path, whose id is the path under `/w/`, and the files of bundled libraries by library and key. */
interface World {
  files?: Record<string, string[]>;
  libraries?: Record<string, Record<string, string[]>>;
}

function sourcesOf(world: World): MacroSources {
  return {
    file: (path) => {
      const lines = world.files?.[path];
      return Promise.resolve(lines === undefined ? null : { id: `/w/${path}`, text: lines.join('\n') });
    },
    library: (library, key) => {
      const files = world.libraries?.[library];
      const lines = files?.[key];
      if (files === undefined || lines === undefined) {
        return Promise.resolve(files === undefined ? undefined : null);
      }
      const read = libraryLines(lines.join('\n'));
      return Promise.resolve(declarationsOf(read.lines, read.numbers));
    },
    cancelled: () => false,
  };
}

/**
 * What is defined at the line marked `‸` (the mark taken out), or after the
 * last line without one, in a diagram whose start line is line 0.
 */
function definedAt(marked: readonly string[], world: World = {}): Promise<Macros> {
  const row = marked.findIndex((line) => line.includes('‸'));
  const lines = marked.map((line) => line.replace('‸', ''));
  return macrosAt(
    { lines, numbers: lines.map((_, index) => index + 1) },
    row === -1 ? lines.length + 1 : row + 1,
    sourcesOf(world)
  );
}

/** Each entry, by its key. */
function entries(macros: Macros): Map<string, MacroEntry> {
  return new Map([...macros.callables, ...macros.variables]);
}

describe('diagramLinesAt', () => {
  it('gives the lines of the diagram after its start line, numbered as lines of the document', () => {
    const source = ['@startuml', 'A -> B', '@enduml', '@startuml', '!$x = 1', 'B -> C', '@enduml'].join('\n');

    expect(diagramLinesAt(source, 5, { bare: false, first: 10 })).toEqual({
      diagram: { lines: ['!$x = 1', 'B -> C'], numbers: [14, 15] },
      cursor: 15,
    });
  });

  it('reads a Markdown block without a start line as one diagram', () => {
    expect(diagramLinesAt('!$x = 1\nA -> B', 1, { bare: true, first: 3 })).toEqual({
      diagram: { lines: ['!$x = 1', 'A -> B'], numbers: [3, 4] },
      cursor: 4,
    });
  });

  it('gives nothing on a start or end line, between diagrams, or in a JSON or YAML diagram', () => {
    const source = [
      '@startuml',
      'A -> B',
      '@enduml',
      'between',
      '@startjson',
      '{"a": 1}',
      '@endjson',
      '@startyaml',
      'a: 1',
      '@endyaml',
    ].join('\n');

    for (const line of [0, 2, 3, 5, 8]) {
      expect(diagramLinesAt(source, line, { bare: false, first: 0 }), String(line)).toBeNull();
    }
    expect(diagramLinesAt(source, 1, { bare: false, first: 0 })).not.toBeNull();
  });
});

describe('nameAround', () => {
  it('takes the name the cursor is in or after, from its `$`, as the engine reads a name', () => {
    expect(nameAround('A -> $tar', 7)).toEqual({ start: 5, end: 9 });
    expect(nameAround('Box(1)', 2)).toEqual({ start: 0, end: 3 });
    expect(nameAround('x = $', 5)).toEqual({ start: 4, end: 5 });
    expect(nameAround('!$名前 = 1', 3)).toEqual({ start: 1, end: 4 });
    expect(nameAround('a b', 1)).toEqual({ start: 0, end: 1 });
    expect(nameAround('a b', 2)).toEqual({ start: 2, end: 3 });
  });
});

describe('macroPlace', () => {
  /** The place at the `‸` of a diagram written in a PlantUML file. */
  const placeAt = (marked: readonly string[]): ReturnType<typeof macroPlace> => {
    const row = marked.findIndex((line) => line.includes('‸'));
    const column = marked[row]?.indexOf('‸') ?? -1;
    return macroPlace(marked.map((line) => line.replace('‸', '')).join('\n'), row, column, { bare: false, first: 0 });
  };

  it('offers definitions on a line the preprocessor reads, replacing the name at the cursor', () => {
    expect(placeAt(['@startuml', '!procedure Box($a)', '!endprocedure', 'Bo‸x(1)', '@enduml'])).toEqual({
      diagram: { lines: ['!procedure Box($a)', '!endprocedure', 'Box(1)'], numbers: [1, 2, 3] },
      cursor: 3,
      start: 0,
      end: 3,
      dollarOnly: false,
      callOpen: true,
    });
    expect(placeAt(['@startuml', '!$x = 1', '!$y = $‸', '@enduml'])).toMatchObject({
      start: 6,
      end: 7,
      dollarOnly: false,
      callOpen: false,
    });
  });

  it('offers nothing on the name a line declares, as it is typed', () => {
    expect(placeAt(['@startuml', '!procedure Box‸($a)', '!endprocedure', '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', '!procedure Bo‸x($a)', '!endprocedure', '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', '!define WIDTH‸(w) w * 2', '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', '!procedure Box(‸', '@enduml'])).toMatchObject({ start: 15, end: 15 });
    expect(placeAt(['@startuml', '!define WIDTH(w) w * $‸', '@enduml'])).toMatchObject({ start: 21, end: 22 });
  });

  it('offers nothing before where the preprocessor reads, in a comment, or where it reads nothing', () => {
    expect(placeAt(['@startuml', '!$y‸ = 1', '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', "' Box(‸", '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', "/'", 'Bo‸x', "'/", '@enduml'])).toBeNull();
    expect(placeAt(['@startuml', '!ifdef $x‸', '!endif', '@enduml'])).toBeNull();
    expect(placeAt(['@startjson', '{"a": "$x‸"}', '@endjson'])).toBeNull();
  });

  it('offers only names that start with `$` in the path of an include and in quoted text and notes', () => {
    expect(placeAt(['@startuml', '!include $di‸r/a.puml', '@enduml'])).toMatchObject({
      start: 9,
      end: 13,
      dollarOnly: true,
    });
    expect(placeAt(['@startuml', '!includesub x.puml!$pa‸rt', '@enduml'])).toMatchObject({ dollarOnly: true });
    expect(placeAt(['@startuml', 'A -> B : "hello $na‸"', '@enduml'])).toMatchObject({ dollarOnly: true });
    expect(placeAt(['@startuml', 'note over A', '  te‸xt', 'end note', '@enduml'])).toMatchObject({ dollarOnly: true });
    expect(placeAt(['@startuml', 'A -> B : $na‸', '@enduml'])).toMatchObject({ dollarOnly: false });
  });

  it('numbers the lines of a Markdown block as lines of the document', () => {
    expect(macroPlace('!$x = 1\n!$y = $', 1, 7, { bare: true, first: 5 })).toMatchObject({
      diagram: { lines: ['!$x = 1', '!$y = $'], numbers: [5, 6] },
      cursor: 6,
      start: 6,
      end: 7,
    });
  });
});

describe('libraryFile', () => {
  it('names a file of a bundled library as an include does, in the case of its files where it is known', () => {
    expect(libraryFile('c4', 'c4_context')).toBe('<C4/C4_Context>');
    expect(libraryFile('C4', 'c4')).toBe('<C4/C4>');
    expect(libraryFile('azure', 'aimachinelearning/azurebotservice')).toBe('<azure/aimachinelearning/azurebotservice>');
    expect(libraryFile('other', 'x')).toBe('<other/x>');
  });
});

describe('declarationOf', () => {
  it('shows each definition on one line as it is declared, its defaults and values as written', async () => {
    const macros = await definedAt([
      '!procedure Box($a, $b = "x")',
      '!endprocedure',
      '!unquoted procedure Say($text)',
      '!endprocedure',
      '!final function $twice($n) !return $n * 2',
      '!function $three()',
      '!return 3',
      '!endfunction',
      '!define WIDTH(w) w * 2',
      '!definelong LONG(a)',
      'a',
      '!enddefinelong',
      '!define SIZE 10',
      '!$x = 1',
      '!$c ?= 2',
      '!global $g = "a"',
      '!foreach $item in ["a", "b"]',
      '!endfor',
    ]);

    expect(
      Object.fromEntries([...entries(macros)].map(([key, entry]) => [key, entry.candidates.map(({ macro }) => declarationOf(macro))]))
    ).toEqual({
      'Box/2': ['!procedure Box($a, $b = "x")'],
      'Say/1': ['!unquoted procedure Say($text)'],
      '$twice/1': ['!final function $twice($n) !return $n * 2'],
      '$three/0': ['!function $three()'],
      'WIDTH/1': ['!define WIDTH(w) w * 2'],
      'LONG/1': ['!definelong LONG(a)'],
      SIZE: ['!define SIZE 10'],
      $x: ['!$x = 1'],
      $c: ['!$c ?= 2'],
      $g: ['!global $g = "a"'],
      $item: ['!foreach $item in ["a", "b"]'],
    });
  });

  it('shows the parameters of the body the cursor is in with their defaults', async () => {
    const macros = await definedAt(['!procedure Box($a, $b = "x")', '‸', '!endprocedure']);

    expect(macros.variables.get('$a')?.candidates.map(({ macro }) => declarationOf(macro))).toEqual(['$a']);
    expect(macros.variables.get('$b')?.candidates.map(({ macro }) => declarationOf(macro))).toEqual(['$b = "x"']);
  });
});

describe('macroSuggestions', () => {
  const world: World = {
    files: { 'common.puml': ['!procedure Shared($x)', '!endprocedure', "!$color = 'red'"] },
    libraries: { c4: { c4_context: ["' Someone who uses the system", '!procedure Person($alias, $label = "")', '!endprocedure'] } },
  };
  const diagram = [
    '!include common.puml',
    '!include <C4/C4_Context>',
    '!procedure Box($a, $b = "x")',
    '!endprocedure',
    '!$size = 3',
    '!function $three()',
    '!return 3',
    '!endfunction',
  ];

  it('offers the parameters, then the definitions of the diagram, of local files and of libraries, each where it is defined', async () => {
    const macros = await definedAt(['!procedure Outer($p)', '‸', '!endprocedure', ...diagram], world);
    const before = await definedAt([...diagram, '!procedure Outer($p)', '‸', '!endprocedure'], world);

    expect(macroSuggestions(macros, { dollarOnly: false, callOpen: false }, labels).items.map((item) => item.name)).toEqual([
      '$p',
    ]);
    const { items, cut } = macroSuggestions(before, { dollarOnly: false, callOpen: false }, labels);
    expect(cut).toBe(false);
    expect(items.map(({ name, description }) => `${name}: ${description}`)).toEqual([
      '$p: this diagram · parameter',
      '$size: this diagram · variable',
      '$three: this diagram · function',
      'Box: this diagram · procedure',
      '$color: file /w/common.puml · variable',
      'Shared: file /w/common.puml · procedure',
      'Person: <C4/C4_Context> · procedure',
    ]);
    expect(items.map((item) => item.sortText)).toEqual([
      '20$p 000',
      '21$size 000',
      '21$three 000',
      '21Box 002',
      '22$color 000',
      '22Shared 001',
      '23Person 002',
    ]);
  });

  it('inserts a call with a placeholder for each parameter up to the last without a default', async () => {
    const macros = await definedAt(diagram, world);
    const byName = new Map(
      macroSuggestions(macros, { dollarOnly: false, callOpen: false }, labels).items.map((item) => [item.name, item])
    );

    expect(byName.get('Box')).toMatchObject({
      kind: 'procedure',
      parameters: '($a, $b = "x")',
      snippet: 'Box(${1:\\$a})',
      call: true,
      definitions: [{ declaration: '!procedure Box($a, $b = "x")', where: 'this diagram, line 4' }],
    });
    expect(byName.get('Person')).toMatchObject({
      parameters: '($alias, $label = "")',
      snippet: 'Person(${1:\\$alias})',
      definitions: [
        {
          declaration: '!procedure Person($alias, $label = "")',
          where: '<C4/C4_Context>, line 2',
          comment: 'Someone who uses the system',
        },
      ],
    });
    expect(byName.get('$three')).toMatchObject({ parameters: '()', snippet: '\\$three()', call: true });
    expect(byName.get('$size')).toMatchObject({ snippet: '\\$size', call: false });
    expect(byName.get('$size')).not.toHaveProperty('parameters');
    expect(byName.get('$color')?.definitions).toEqual([
      { declaration: "!$color = 'red'", where: 'file /w/common.puml, line 3' },
    ]);
  });

  it('inserts the name alone before a `(` already written, and only `$` names where those alone are offered', async () => {
    const macros = await definedAt(diagram, world);

    expect(
      macroSuggestions(macros, { dollarOnly: false, callOpen: true }, labels).items.map((item) => item.snippet)
    ).toEqual(['\\$size', '\\$three', 'Box', '\\$color', 'Shared', 'Person']);
    expect(macroSuggestions(macros, { dollarOnly: true, callOpen: false }, labels).items.map((item) => item.name)).toEqual([
      '$size',
      '$three',
      '$color',
    ]);
  });

  it('places one stop when every parameter has a default, or the definitions differ in their parameters', async () => {
    const macros = await definedAt([
      '!procedure Optional($a = 1)',
      '!endprocedure',
      '!if $x',
      '!procedure Either($first)',
      '!endprocedure',
      '!else',
      '!procedure Either($second)',
      '!endprocedure',
      '!endif',
    ]);
    const byName = new Map(
      macroSuggestions(macros, { dollarOnly: false, callOpen: false }, labels).items.map((item) => [item.name, item])
    );

    expect(byName.get('Optional')).toMatchObject({ parameters: '($a = 1)', snippet: 'Optional($1)' });
    expect(byName.get('Either')).toMatchObject({
      parameters: '(…)',
      snippet: 'Either($1)',
      description: '2 definitions · procedure · ambiguous',
      definitions: [
        { declaration: '!procedure Either($first)', where: 'this diagram, line 5' },
        { declaration: '!procedure Either($second)', where: 'this diagram, line 8' },
      ],
    });
  });

  it('says how sure a definition is: one the text may leave out, one of several, or one text not read may stand for', async () => {
    const lines = [
      '!if $x',
      '!$maybe = 1',
      '!endif',
      '!if $x',
      '!procedure Mixed($a)',
      '!endprocedure',
      '!else',
      '!function Mixed($a)',
      '!return $a',
      '!endfunction',
      '!endif',
      '!$known = 1',
    ];
    const described = async (marked: readonly string[]): Promise<Record<string, string>> =>
      Object.fromEntries(
        macroSuggestions(await definedAt(marked), { dollarOnly: false, callOpen: false }, labels).items.map((item) => [
          item.name,
          item.description,
        ])
      );

    expect(await described(lines)).toEqual({
      $known: 'this diagram · variable',
      $maybe: 'this diagram · variable · conditional',
      // Of two kinds: neither is named.
      Mixed: '2 definitions · ambiguous',
    });
    // What an include whose path is put together when the text runs may define again: `$dir` is a variable there.
    expect(await described([...lines, '!include $dir/more.puml'])).toEqual(await described(lines));
    expect(await described([...lines, '!$dir = "parts"', '!include $dir/more.puml'])).toEqual({
      $dir: 'this diagram · variable · unresolved',
      $known: 'this diagram · variable · unresolved',
      $maybe: 'this diagram · variable · unresolved',
      Mixed: '2 definitions · unresolved',
    });
  });

  it('keeps to the limit of results, and says when it cut some off', async () => {
    const macros = await definedAt(diagram, world);

    expect(macroSuggestions(macros, { dollarOnly: false, callOpen: false }, labels, 2)).toMatchObject({
      items: [{ name: '$size' }, { name: '$three' }],
      cut: true,
    });
    expect(macroSuggestions(macros, { dollarOnly: false, callOpen: false }, labels, 6).cut).toBe(false);
  });
});

describe('signaturesFor', () => {
  const declared = [
    "' Draws a box",
    '!procedure Box($a, $b = "x")',
    '!endprocedure',
    '!procedure P($a)',
    '!endprocedure',
    '!procedure P($a, $b)',
    '!endprocedure',
  ];

  /** The hints for the call at the `‸` of a line written after `lines`. */
  async function hintsAt(
    lines: readonly string[],
    marked: string,
    chosen?: number
  ): Promise<ReturnType<typeof signaturesFor> | 'no call'> {
    const macros = await definedAt(lines);
    const line = marked.replace('‸', '');
    const call = callAt(line, marked.indexOf('‸'), (name) => readingOf(macros, name));
    return call === null ? 'no call' : signaturesFor(macros, call, line, labels, chosen);
  }

  it('shows each definition of the name with its parameters as declared, and where each one is in the label', async () => {
    expect(await hintsAt(declared, 'Box(‸')).toEqual({
      signatures: [
        {
          label: 'Box($a, $b = "x")',
          parameters: [
            [4, 6],
            [8, 16],
          ],
          description: 'this diagram · procedure',
          comment: 'Draws a box',
          activeParameter: 0,
        },
      ],
      active: 0,
    });
  });

  it('follows the parameter the cursor is in, by position or by name', async () => {
    const active = async (marked: string): Promise<number | undefined> => {
      const hints = await hintsAt(declared, marked);
      return hints === 'no call' ? undefined : hints?.signatures[0]?.activeParameter;
    };

    expect(await active('Box(‸)')).toBe(0);
    expect(await active('Box(1, ‸')).toBe(1);
    expect(await active('Box(1, "a,b‸')).toBe(1);
    expect(await active('Box(f(1, 2), ‸')).toBe(1);
    expect(await active('Box($b=‸')).toBe(1);
    expect(await active('Box($b = 2, ‸')).toBe(0);
    // The arguments by position go to the parameters not named.
    expect(await active('Box($a = 1, ‸')).toBe(1);
    expect(await active('Box(1, 2, 3‸')).toBe(-1);
    expect(await active('Box($zz = ‸')).toBe(-1);
  });

  it('shows first the definition picked while it takes the arguments, or else the first that does', async () => {
    const pick = async (marked: string, chosen?: number): Promise<{ active: number; labels: string[] } | null> => {
      const hints = await hintsAt(declared, marked, chosen);
      return hints === 'no call' || hints === null
        ? null
        : { active: hints.active, labels: hints.signatures.map((signature) => signature.label) };
    };

    expect(await pick('P(‸')).toEqual({ active: 0, labels: ['P($a)', 'P($a, $b)'] });
    expect(await pick('P(1, ‸')).toEqual({ active: 1, labels: ['P($a)', 'P($a, $b)'] });
    expect(await pick('P(1, ‸', 0)).toMatchObject({ active: 1 });
    expect(await pick('P(‸', 1)).toMatchObject({ active: 1 });
    expect(await pick('P(1, 2, 3‸')).toMatchObject({ active: 0 });
    expect(await pick('P($b = 1‸')).toMatchObject({ active: 1 });
  });

  it('takes `name(` and `name()` for a call with no argument yet', async () => {
    const lines = ['!procedure R()', '!endprocedure', '!procedure R($a)', '!endprocedure'];
    const active = async (marked: string): Promise<number | undefined> => {
      const hints = await hintsAt(lines, marked);
      return hints === 'no call' ? undefined : hints?.active;
    };

    expect(await active('R(‸')).toBe(0);
    expect(await active('R(‸)')).toBe(0);
    expect(await active('R( ‸')).toBe(0);
    expect(await active('R(1‸')).toBe(1);
  });

  it('tells apart the definitions of one name and number of parameters by where they are', async () => {
    const hints = await hintsAt(
      ['!if $x', '!procedure Q($a)', '!endprocedure', '!else', '!procedure Q($b)', '!endprocedure', '!endif'],
      'Q(‸'
    );

    expect(hints).toMatchObject({
      signatures: [
        { label: 'Q($a)', description: '2 definitions · procedure · ambiguous · this diagram' },
        { label: 'Q($b)', description: '2 definitions · procedure · ambiguous · this diagram' },
      ],
    });
  });

  it('gives nothing for a name nothing defines', async () => {
    const macros = await definedAt(declared);
    const call: Call = { name: 'Nope', start: 0, end: 4, reading: 'quoted', arguments: [{ start: 5, end: 5 }] };

    expect(signaturesFor(macros, call, 'Nope(', labels)).toBeNull();
    expect(await hintsAt(declared, 'Nope(‸')).toBe('no call');
  });
});
