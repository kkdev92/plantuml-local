import { describe, expect, it } from 'vitest';

import { foldingRanges } from '../../src/language/folding';

/** The ranges of a file given as lines, as [start, end] pairs and comments marked. */
function folds(lines: readonly string[]): (readonly [number, number] | readonly [number, number, 'comment'])[] {
  return foldingRanges(lines.join('\n')).map((fold) =>
    fold.comment ? ([fold.start, fold.end, 'comment'] as const) : ([fold.start, fold.end] as const)
  );
}

describe('foldingRanges', () => {
  it('folds each diagram of a file on its own, keeping its end line in view', () => {
    expect(
      folds(['@startuml(id=one)', 'A -> B', '@enduml', '', '@startuml(id=two)', 'C -> D', 'E -> F', '@enduml'])
    ).toEqual([
      [0, 1],
      [4, 6],
    ]);
  });

  it('folds a block comment with its last line, and reads nothing in it', () => {
    expect(
      folds(["/'", '@enduml', 'class X {', "'/", '@startuml', "/' one line '/", 'A -> B', '@enduml'])
    ).toEqual([
      [0, 3, 'comment'],
      [4, 6],
    ]);
  });

  it('folds multi-line notes and texts without reading them, and no one-line note', () => {
    expect(
      folds([
        '@startuml',
        'note left of A',
        '  end',
        '  alt inside the note',
        'end note',
        'note right of A : one line',
        'note "floating" as N1',
        'legend right',
        '  text',
        'endlegend',
        'title',
        '  text',
        'end title',
        'ref over A, B',
        '  text',
        'end',
        'note top of A {',
        '  text',
        '}',
        '@enduml',
      ])
    ).toEqual([
      [0, 18],
      [1, 3],
      [7, 8],
      [10, 11],
      [13, 14],
      [16, 17],
    ]);
  });

  it('folds { … } bodies, and not a member that starts with a brace', () => {
    expect(
      folds(['@startuml', 'package P {', '  class A {', '    {static} count : int', '  }', '}', '@enduml'])
    ).toEqual([
      [0, 5],
      [1, 4],
      [2, 3],
    ]);
  });

  it('folds preprocessor sections, but not a function written on one line', () => {
    expect(
      folds([
        '!function $double($a) !return $a + $a',
        '!procedure $box($name)',
        '  rectangle $name',
        '!endprocedure',
        '@startuml',
        '!if %true()',
        '  A -> B',
        '!else',
        '  B -> A',
        '!endif',
        '!foreach $i in [1, 2]',
        '  C -> D',
        '!endfor',
        '@enduml',
      ])
    ).toEqual([
      [1, 2],
      [4, 12],
      [5, 8],
      [10, 11],
    ]);
  });

  it('folds sequence groups, nested', () => {
    expect(
      folds(['@startuml', 'alt ok', '  A -> B', 'else', '  loop 3 times', '    A -> C', '  end', 'end', '@enduml'])
    ).toEqual([
      [0, 7],
      [1, 6],
      [4, 5],
    ]);
  });

  it('folds activity blocks, matching each kind on its own', () => {
    // The `end` inside the if ends the flow; it closes no block.
    expect(
      folds([
        '@startuml',
        'start',
        'if (ok?) then',
        '  :a;',
        '  end',
        'endif',
        'while (more?)',
        '  :b;',
        'endwhile',
        'fork',
        '  :c;',
        'fork again',
        '  :d;',
        'end fork',
        'stop',
        '@enduml',
      ])
    ).toEqual([
      [0, 14],
      [2, 4],
      [6, 7],
      [9, 12],
    ]);
  });

  it('takes no end in a label, and no brace in a comment', () => {
    expect(folds(['@startuml', 'A -> B : end', "' class X {", 'alt', '  A -> B', 'end', '@enduml'])).toEqual([
      [0, 5],
      [3, 4],
    ]);
  });

  it('folds nothing for a block left open, and nothing across the end of a diagram', () => {
    expect(
      folds(['@startuml', 'alt never closed', '  A -> B', '@enduml', '@startuml', 'A -> B', 'end', '@enduml'])
    ).toEqual([
      [0, 2],
      [4, 6],
    ]);
    expect(folds(['@startuml', 'alt', '  A -> B'])).toEqual([]);
  });

  it('does not read the data of a JSON diagram', () => {
    expect(folds(['@startjson', '{', '  "a": {', '    "b": 1', '  }', '}', '@endjson'])).toEqual([[0, 5]]);
  });

  it('lets no line taken for a note hide the diagrams after it', () => {
    // A class member named note reads like the start of a note.
    expect(
      folds(['@startuml', 'class A {', '  note', '}', '@enduml', '@startuml', 'B -> C', 'C -> D', '@enduml'])
    ).toEqual([
      [0, 3],
      [5, 7],
    ]);
  });

  it('folds nothing that opens and closes on adjacent lines, and finds nothing in plain text', () => {
    expect(folds(['@startuml', '@enduml', 'alt', 'end'])).toEqual([]);
    expect(folds(['A -> B', 'B -> C'])).toEqual([]);
  });
});
