import { describe, expect, it } from 'vitest';

import {
  declaredAt,
  definitionsOfName,
  elementDeclaredAt,
  elementsNamed,
  labelStart,
  libraryIncludeAt,
  nameAt,
  occurrencesIn,
  parameterAt,
  type NameAt,
} from '../../src/language/definitions';
import { readDiagram } from '../../src/language/macro-help';
import { macrosAt, type MacroSources } from '../../src/language/macros';

/** No include reads anything. */
const nothing: MacroSources = {
  file: () => Promise.resolve(null),
  library: () => Promise.resolve(undefined),
  cancelled: () => false,
};

/** The name at the `‸` of `marked` (a `.puml` file, the mark taken out), and the text of its line. */
function at(marked: readonly string[]): { found: NameAt | null; text: string } {
  const line = marked.findIndex((text) => text.includes('‸'));
  const column = (marked[line] ?? '').indexOf('‸');
  const lines = marked.map((text) => text.replace('‸', ''));
  return { found: nameAt(lines.join('\n'), line, column, { bare: false, first: 0 }), text: lines[line] ?? '' };
}

/** The lines of the document the definitions of the name at the `‸` are on, by what is defined before it. */
async function definedOn(marked: readonly string[]): Promise<{ lines: number[]; certainty: string } | null> {
  const { found, text } = at(marked);
  if (found === null) {
    return null;
  }
  const macros = await macrosAt(found.diagram, found.cursor, nothing);
  const entry = definitionsOfName(macros, found, text);
  return entry === null
    ? null
    : { lines: entry.candidates.map(({ macro }) => macro.origin.line), certainty: entry.certainty };
}

const TWO_DIAGRAMS = [
  '@startuml(id=first)',
  'participant "注文係" as A',
  'participant Server as B',
  'A -> B : hello A',
  '@enduml',
  '@startuml(id=second)',
  'participant "Other" as A',
  'A -> A : ping',
  '@enduml',
];

describe('labelStart', () => {
  it('finds the `:` a label follows, outside brackets', () => {
    expect(labelStart('A -> B : hello A')).toBe(7);
    expect(labelStart('A->B:hello')).toBe(4);
    expect(labelStart('[A:1] -> B : x')).toBe(11);
    expect(labelStart('A -> B')).toBe(Infinity);
  });

  it('passes over `::` and an actor written `:name:` where a line starts with it, or after `actor`', () => {
    expect(labelStart('A::b -> C')).toBe(Infinity);
    expect(labelStart(':Main Admin: --> (Use) : label')).toBe(23);
    expect(labelStart('actor :User: as U')).toBe(Infinity);
    // An activity is all label.
    expect(labelStart(':action;')).toBe(0);
  });
});

describe('nameAt', () => {
  it('reads a name on a line of the diagram as one that may be an element’s, before the label', () => {
    expect(at(['@startuml', '‸A -> B : hello A', '@enduml']).found).toMatchObject({
      name: 'A',
      start: 0,
      end: 1,
      call: false,
      element: { name: 'A', start: 0, end: 1 },
    });
    expect(at(['@startuml', 'A -> B : hello ‸A', '@enduml']).found?.element).toBeNull();
    expect(at(['@startuml', 'class com.‸foo.Bar', '@enduml']).found?.element).toEqual({
      name: 'com.foo.Bar',
      start: 6,
      end: 17,
    });
  });

  it('reads a call, and a name starting with `$` in quoted text and in the path of an include', () => {
    expect(at(['@startuml', '!procedure P($a)', '!endprocedure', '‸P(1)', '@enduml']).found).toMatchObject({
      name: 'P',
      call: true,
    });
    expect(at(['@startuml', 'A -> B : "‸$x"', '@enduml']).found).toMatchObject({ name: '$x', element: null });
    expect(at(['@startuml', '!include ‸$dir/a.puml', '@enduml']).found).toMatchObject({ name: '$dir', element: null });
  });

  it('reads nothing in a comment, quoted text or the path of an include, but a `$` name', () => {
    expect(at(['@startuml', "' ‸P(1)", '@enduml']).found).toBeNull();
    expect(at(['@startuml', 'A -> B : "‸x"', '@enduml']).found).toBeNull();
    expect(at(['@startuml', 'note over A : ‸x', '@enduml']).found).toBeNull();
    expect(at(['@startuml', '!include $dir/‸a.puml', '@enduml']).found).toBeNull();
    expect(at(['‸A -> B']).found).toBeNull();
  });

  it('does not read a preprocessor line as naming an element', () => {
    expect(at(['@startuml', '!$x = ‸A', '@enduml']).found).toMatchObject({ name: 'A', element: null });
  });

  it('reads nothing on the name or a parameter a line declares, and reads the names in a default', async () => {
    expect(at(['@startuml', '!procedure ‸P($a)', '!endprocedure', '@enduml']).found).toBeNull();
    expect(at(['@startuml', '!procedure P(‸$a)', '!endprocedure', '@enduml']).found).toBeNull();
    expect(at(['@startuml', '!function $f($a, ‸$b = 1)', '!endfunction', '@enduml']).found).toBeNull();
    expect(at(['@startuml', '!define F(‸x) [x]', '@enduml']).found).toBeNull();
    expect(at(['@startuml', '!procedure P($a = ‸$x)', '!endprocedure', '@enduml']).found).toMatchObject({ name: '$x' });
    // Not the variable of the same name defined before it.
    expect(await definedOn(['@startuml', '!$a = 1', '!procedure P(‸$a)', '!endprocedure', '@enduml'])).toBeNull();
  });
});

describe('definitionsOfName', () => {
  const OVERLOADS = ['@startuml', '!procedure P($a)', '!endprocedure', '!procedure P($a, $b = 2)', '!endprocedure'];

  it('picks a call’s definition by the arguments it is given, read whole', async () => {
    expect(await definedOn([...OVERLOADS, '‸P(1, "a, b")', '@enduml'])).toEqual({ lines: [3], certainty: 'resolved' });
    expect(await definedOn([...OVERLOADS, '‸P(1)', '@enduml'])).toEqual({ lines: [1], certainty: 'resolved' });
    expect(await definedOn([...OVERLOADS, '‸P(1, 2, 3)', '@enduml'])).toBeNull();
  });

  it('picks as the engine does, by the arguments given by position, else by one that takes those given by name', async () => {
    // TFunctionSignature counts the arguments by position alone, and compares no names.
    expect(await definedOn([...OVERLOADS, '‸P($b = 3, 1)', '@enduml'])).toEqual({ lines: [1], certainty: 'resolved' });
    const defaults = ['!procedure Q($a)', '!endprocedure', '!procedure Q($a = 1, $b = 2)', '!endprocedure'];
    expect(await definedOn(['@startuml', ...defaults, '‸Q($b = 3)', '@enduml'])).toEqual({
      lines: [3],
      certainty: 'resolved',
    });
  });

  it('takes only what is defined before the cursor, and finds a variable by its name', async () => {
    expect(await definedOn(['@startuml', '‸P()', '!procedure P()', '!endprocedure', '@enduml'])).toBeNull();
    expect(await definedOn(['@startuml', '!$x = 1', '!$x = 2', 'A -> B : ‸$x', '@enduml'])).toEqual({
      lines: [2],
      certainty: 'resolved',
    });
    expect(await definedOn(['@startuml', '!define WHO Bob', 'Alice -> ‸WHO', '@enduml'])).toEqual({
      lines: [1],
      certainty: 'resolved',
    });
  });

  it('gives each definition a call may stand for when several may', async () => {
    const branches = ['!if %true()', '!procedure P()', '!endprocedure', '!else', '!procedure P()', '!endprocedure', '!endif'];
    expect(await definedOn(['@startuml', ...branches, '‸P()', '@enduml'])).toEqual({
      lines: [2, 5],
      certainty: 'ambiguous',
    });
  });
});

describe('occurrencesIn', () => {
  /** Each place the diagram of `lines` reads `name` at: `line:start-end`, `()` for a call, `@` for what may name an element. */
  const found = (lines: readonly string[], name: string): string[] =>
    occurrencesIn(readDiagram({ lines, numbers: lines.map((_, index) => index) }), name).map(
      ({ index, start, end, call, element }) =>
        `${String(index)}:${String(start)}-${String(end)}${call ? '()' : ''}${element === null ? '' : '@'}`
    );

  it('finds each call and variable written whole, and not in a comment, quoted text or what a line declares', () => {
    const lines = [
      '!procedure P($a)',
      '  A -> B : $a "$a"',
      '!endprocedure',
      'P(1) P(2)',
      "' P(3) $a",
      'A -> B : "P(4)"',
      'PP(5) $ab',
    ];
    expect(found(lines, 'P')).toEqual(['3:0-1()@', '3:5-6()@']);
    expect(found(lines, '$a')).toEqual(['1:11-13', '1:15-17']);
  });

  it('finds a name as an element before the label of its line, and as a name only after it', () => {
    const lines = ['participant "Order" as A', 'A -> B : hello A', 'B -> A'];
    expect(found(lines, 'A')).toEqual(['0:23-24@', '1:0-1@', '1:15-16', '2:5-6@']);
  });
});

describe('declaredAt', () => {
  const diagram = { lines: ['!procedure P($a, $b = 1)', '!endprocedure', '!$v = 2', 'P(1)'], numbers: [1, 2, 3, 4] };
  const place = { source: 'document' } as const;

  it('reads the definition whose name or parameter the cursor is on, as the walk of what is defined takes it', () => {
    expect(declaredAt(diagram, 0, 11, place)).toMatchObject({
      kind: 'procedure',
      name: 'P',
      origin: { source: 'document', line: 1, start: 11, end: 12, last: 2 },
    });
    expect(declaredAt(diagram, 0, 12, place)?.name).toBe('P');
    expect(declaredAt(diagram, 0, 14, place)).toMatchObject({ kind: 'parameter', name: '$a', origin: { line: 1, start: 11 } });
    expect(declaredAt(diagram, 0, 18, place)).toMatchObject({ kind: 'parameter', name: '$b', value: '1' });
    expect(declaredAt(diagram, 2, 2, place)).toMatchObject({ kind: 'variable', name: '$v', origin: { line: 3 } });
  });

  it('reads nothing on the keyword, on a call or off the lines of the diagram', () => {
    expect(declaredAt(diagram, 0, 3, place)).toBeNull();
    expect(declaredAt(diagram, 3, 0, place)).toBeNull();
    expect(declaredAt(diagram, 9, 0, place)).toBeNull();
  });
});

describe('elementDeclaredAt', () => {
  it('reads the name of the element a line declares with its keyword, where the cursor is on that name', () => {
    const diagram = { lines: ['participant "Order" as A', 'class C {', '}', 'A -> C'], numbers: [1, 2, 3, 4] };
    expect(elementDeclaredAt(diagram, 0, 23)).toBe('A');
    expect(elementDeclaredAt(diagram, 0, 24)).toBe('A');
    expect(elementDeclaredAt(diagram, 1, 6)).toBe('C');
    // Its display name, and a line that only uses it.
    expect(elementDeclaredAt(diagram, 0, 14)).toBeNull();
    expect(elementDeclaredAt(diagram, 3, 0)).toBeNull();
  });
});

describe('parameterAt', () => {
  it('finds a parameter by its whole name after the name the line declares', () => {
    expect(parameterAt('!procedure P($a, $ab)', 12, '$ab')).toBe(17);
    expect(parameterAt('!procedure P($ab, $a)', 12, '$a')).toBe(18);
    expect(parameterAt('!function $a($a)', 12, '$a')).toBe(13);
    expect(parameterAt('!procedure P($a)', 12, '$b')).toBe(-1);
  });
});

describe('elementsNamed', () => {
  it('finds what the diagram the cursor is in declares, and not the other diagram', () => {
    const first = at(TWO_DIAGRAMS.map((line, index) => (index === 3 ? `‸${line}` : line))).found;
    const second = at(TWO_DIAGRAMS.map((line, index) => (index === 7 ? `‸${line}` : line))).found;
    if (first === null || second === null) {
      throw new Error('no name');
    }
    const firstA = elementsNamed(first.diagram, 'A');
    expect(firstA).toEqual([{ line: 1, start: 21, end: 22, last: 1 }]);
    expect((TWO_DIAGRAMS[1] ?? '').slice(21, 22)).toBe('A');
    expect(elementsNamed(second.diagram, 'A')).toEqual([{ line: 6, start: 23, end: 24, last: 6 }]);
    expect(elementsNamed(first.diagram, 'Server')).toEqual([]);
    expect(elementsNamed(first.diagram, 'B')).toEqual([{ line: 2, start: 22, end: 23, last: 2 }]);
  });

  it('finds each declaration of the name, a body to its end', () => {
    const lines = ['@startuml', 'package P {', '  class C', '}', 'class C', '‸C -> P', '@enduml'];
    const found = at(lines).found;
    if (found === null) {
      throw new Error('no name');
    }
    expect(elementsNamed(found.diagram, 'C')).toEqual([
      { line: 2, start: 8, end: 9, last: 2 },
      { line: 4, start: 6, end: 7, last: 4 },
    ]);
    expect(elementsNamed(found.diagram, 'P')).toEqual([{ line: 1, start: 8, end: 9, last: 3 }]);
  });
});

describe('libraryIncludeAt', () => {
  it('reads the bundled library’s file an include names, in lower case, where the cursor is on its path', () => {
    expect(libraryIncludeAt('!include <C4/C4_Context>', 12)).toEqual({
      library: 'c4',
      key: 'c4_context',
      start: 9,
      end: 24,
    });
    expect(libraryIncludeAt('  !include_once <azure/Compute/AzureFunction>', 20)).toMatchObject({
      library: 'azure',
      key: 'compute/azurefunction',
    });
  });

  it('reads nothing off the path, for a path put together, a section, a local file or a line that is no include', () => {
    expect(libraryIncludeAt('!include <C4/C4_Context>', 3)).toBeNull();
    expect(libraryIncludeAt('!include <C4/$name>', 12)).toBeNull();
    expect(libraryIncludeAt('!includesub <C4/C4>!PART', 14)).toBeNull();
    expect(libraryIncludeAt('!include common.puml', 12)).toBeNull();
    expect(libraryIncludeAt('!include <C4>', 10)).toBeNull();
    expect(libraryIncludeAt('A -> B', 1)).toBeNull();
  });
});
