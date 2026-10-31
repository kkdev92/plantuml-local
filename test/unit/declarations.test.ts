import { describe, expect, it } from 'vitest';

import {
  columnIn,
  conditionalLines,
  declarationsOf,
  readUntilCommaOrClose,
  withoutInnerComment,
  type Declaration,
  type Definition,
} from '../../src/language/declarations';

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/** The names declared by `lines`, in order. */
const label = (declared: Declaration): string => (declared.type === 'include' ? declared.target : declared.name);
const names = (lines: readonly string[]): string[] => declarationsOf(lines).map(label);

/** The one definition `lines` declares. */
function only(lines: readonly string[]): Definition {
  const declared = declarationsOf(lines);
  expect(declared).toHaveLength(1);
  const [definition] = declared;
  if (definition?.type !== 'definition') {
    throw new Error('not a definition');
  }
  return definition;
}

describe('declarationsOf', () => {
  it('reads a procedure with its parameters and their default values as written', () => {
    expect(
      declarationsOf([
        "' Draws a box.",
        '!procedure $box($name, $color = "red", $size=2)',
        'rectangle $name #$color',
        '!endprocedure',
      ])
    ).toEqual([
      {
        type: 'definition',
        kind: 'procedure',
        name: '$box',
        parameters: [{ name: '$name' }, { name: '$color', default: '"red"' }, { name: '$size', default: '2' }],
        line: 1,
        conditional: false,
        start: 11,
        end: 15,
        last: 3,
        comment: 'Draws a box.',
      },
    ]);
  });

  it('reads a default value up to its comma or bracket, outside quotes and brackets', () => {
    expect(only(['!procedure $p($a = "x, y", $b = $f(1, 2), $c = \'z)\')', '!endprocedure']).parameters).toEqual([
      { name: '$a', default: '"x, y"' },
      { name: '$b', default: '$f(1, 2)' },
      { name: '$c', default: "'z)'" },
    ]);
  });

  it('reads a function that returns on its line, with `return` or `!return`, and one with a body', () => {
    const declared = declarationsOf([
      '!function $double($x) return $x * 2',
      '!function $half($x)!return $x / 2',
      '!function $same($x)',
      '!return $x',
      '!endfunction',
    ]);
    expect(declared.map((d) => (d.type === 'definition' ? [d.name, d.line, d.last, d.value] : []))).toEqual([
      ['$double', 0, 0, '$x * 2'],
      ['$half', 1, 1, '$x / 2'],
      ['$same', 2, 4, undefined],
    ]);
  });

  it('reads `!unquoted` and `!final` before the keyword, in either order', () => {
    const declared = declarationsOf([
      '!unquoted procedure Box(x)',
      '!endprocedure',
      '!final function $f() return 1',
      '!unquoted final function Pair(a, b) return a',
      '!final unquoted procedure Last()',
      '!endprocedure',
    ]);
    expect(declared.map((d) => (d.type === 'definition' ? [d.name, d.start, d.unquoted, d.final] : []))).toEqual([
      ['Box', 20, true, undefined],
      ['$f', 16, undefined, true],
      ['Pair', 25, true, true],
      ['Last', 26, true, true],
    ]);
  });

  it('reads `!define` with brackets as a macro and without them as a constant, and `!definelong`', () => {
    const declared = declarationsOf([
      '!define BOX(x, y=1) [x y]',
      '!define FOO hello world',
      '!define EMPTY',
      '!definelong LONG(a)',
      'a',
      '!enddefinelong',
      '!definelong BARE',
      '!enddefinelong',
    ]);
    expect(
      declared.map((d) => (d.type === 'definition' ? [d.kind, d.name, d.parameters, d.value, d.last] : []))
    ).toEqual([
      ['define', 'BOX', [{ name: 'x' }, { name: 'y', default: '1' }], '[x y]', 0],
      ['constant', 'FOO', undefined, 'hello world', 1],
      ['constant', 'EMPTY', undefined, '', 2],
      ['definelong', 'LONG', [{ name: 'a' }], undefined, 5],
      ['definelong', 'BARE', [], undefined, 7],
    ]);
  });

  it('reads assignments as the engine does: `local` and `global` are a scope unless `=` follows them', () => {
    const declared = declarationsOf([
      '!$x = 1',
      '!global $g = "a"',
      '!$c ?= 2',
      '!local $l = 3',
      '!local = 4',
      '! $s=5',
      '!plain = 6',
    ]);
    expect(
      declared.map((d) =>
        d.type === 'definition' ? [d.name, d.start, d.end, d.scope, d.conditional, d.ifUnset, d.value] : []
      )
    ).toEqual([
      ['$x', 1, 3, undefined, false, undefined, '1'],
      ['$g', 8, 10, 'global', false, undefined, '"a"'],
      // `?=` assigns only a variable that has no value yet.
      ['$c', 1, 3, undefined, false, true, '2'],
      // `!local $l` outside a body is refused; `!local = 4` assigns a variable named `local`.
      ['local', 1, 6, undefined, false, undefined, '4'],
      ['$s', 2, 4, undefined, false, undefined, '5'],
      ['plain', 1, 6, undefined, false, undefined, '6'],
    ]);
  });

  it('keeps what a body assigns with the line of its procedure, and ends the body at the first `!end…`', () => {
    const declared = declarationsOf([
      '!procedure $p($a)',
      '!local $tmp = $a',
      '!global $seen = 1',
      '!procedure Q()',
      '!end procedure',
      '!$after = 2',
      '!endprocedure',
      '!definelong L()',
      '!$inside = 3',
      '!enddefinelong',
    ]);
    expect(declared.map((d) => (d.type === 'definition' ? [d.name, d.line, d.last, d.body, d.scope] : []))).toEqual([
      ['$p', 0, 4, undefined, undefined],
      ['$tmp', 1, 1, 0, 'local'],
      ['$seen', 2, 2, 0, 'global'],
      // A procedure in a body is part of it, and the first `!end…` ends the outer one.
      ['$after', 5, 5, undefined, undefined],
      ['L', 7, 9, undefined, undefined],
      ['$inside', 8, 8, 7, undefined],
    ]);
  });

  it('reads `!undef`, which names a variable', () => {
    expect(declarationsOf(['!undef $x', '!undef  FOO'])).toEqual([
      { type: 'undef', name: '$x', line: 0, conditional: false },
      { type: 'undef', name: 'FOO', line: 1, conditional: false },
    ]);
  });

  it('marks what lies under `!if`, `!ifdef`, `!ifndef`, `!while` and `!foreach` as conditional', () => {
    const declared = declarationsOf([
      '!if %true()',
      // The engine declares a procedure before it reads the condition around it; which of two
      // it keeps then depends on the order it reads in, which the index does not rely on.
      '!procedure $a()',
      '!endprocedure',
      '!else',
      '!$v = 1',
      '!endif',
      '!$w = 2',
      '!ifdef X',
      '!define Y 1',
      '!endif',
      '!ifndef X',
      '!define Z(x) x',
      '!endif',
      '!while $i < 3',
      '!$i = $i + 1',
      '!endwhile',
      '!foreach $item in ["a", "b"]',
      '!$last = $item',
      '!endfor',
      '!if 1',
      '!if 2',
      '!endif',
      '!$nested = 1',
      '!endif',
      '!$done = 1',
    ]);
    expect(declared.map((d) => [d.name, d.conditional])).toEqual([
      ['$a', true],
      ['$v', true],
      ['$w', false],
      ['Y', true],
      ['Z', true],
      ['$i', true],
      ['$item', true],
      ['$last', true],
      ['$nested', true],
      ['$done', false],
    ]);
  });

  it('tells of every line whether it lies under a condition, a line of a body by the blocks of its body', () => {
    expect(
      conditionalLines([
        'participant A',
        '!if %true()',
        'participant B',
        "' a comment",
        '!endif',
        'participant C',
        '!procedure $p()',
        'participant D',
        '!if 1',
        'participant E',
        '!endif',
        '!endprocedure',
        '!while $i < 3',
        'participant F',
        '!endwhile',
        'participant G',
      ])
    ).toEqual([false, false, true, true, true, false, false, false, false, true, true, false, false, true, true, false]);
  });

  it('reads the variable of a `!foreach` with what it runs through', () => {
    expect(only(['!foreach $item in ["a", "b"]', '!endfor'])).toMatchObject({
      kind: 'variable',
      name: '$item',
      value: '["a", "b"]',
      conditional: true,
      foreach: true,
    });
    expect(only(['!$item = ["a", "b"]'])).not.toHaveProperty('foreach');
  });

  it('ends a `!foreach` only at `!endfor`', () => {
    expect(declarationsOf(['!foreach $i in [1]', '!endforeach', '!$after = 1']).map((d) => d.conditional)).toEqual([
      true,
      true,
    ]);
  });

  it('keeps the comment lines right above a definition, without their markers', () => {
    const declared = declarationsOf([
      "' Not this one.",
      '',
      "' First line.",
      "'' Second line.",
      '!$a = 1',
      "/' A block",
      "   comment. '/",
      '!$b = 2',
      "/' One line. '/",
      '!$c = 3',
    ]);
    expect(declared.map((d) => (d.type === 'definition' ? d.comment : undefined))).toEqual([
      'First line.\nSecond line.',
      'A block\ncomment.',
      'One line.',
    ]);
  });

  it('reads no declaration in a comment line or a block comment', () => {
    expect(
      names([
        "' !procedure $no()",
        "/' !procedure $no() '/",
        "/'",
        '!procedure $hidden()',
        '!endprocedure',
        // A block comment ends at a line ending with `'/`, not at one with `'/` inside it.
        "'/ !$still = 1",
        '!$hidden = 1',
        `'/${NO_BREAK_SPACE}`,
        '!$shown = 1',
      ])
    ).toEqual(['$shown']);
  });

  it('takes a block comment off the start or the end of a line before reading it', () => {
    const declared = declarationsOf([
      "/' note '/ !procedure P()",
      '!endprocedure',
      "!procedure Q() /' note '/",
      '!endprocedure',
      '!$v = "set" /\' note \'/',
      "/'''a'''/ !$t = 1",
      "!$w = 1 /'''tag'''/ + 2",
    ]);
    expect(declared.map((d) => (d.type === 'definition' ? [d.name, d.start, d.end, d.value] : []))).toEqual([
      ['P', 22, 23, undefined],
      ['Q', 11, 12, undefined],
      ['$v', 1, 3, '"set"'],
      ['$t', 11, 13, '1'],
      ['$w', 1, 3, '1  + 2'],
    ]);
  });

  it('reads directives in lower case only', () => {
    expect(names(['!PROCEDURE P()', '!ENDPROCEDURE', '!Procedure Q()', '!Define R 1', '!GLOBAL $g = 1'])).toEqual([]);
  });

  it('reads a line the engine would refuse as declaring nothing', () => {
    expect(
      names([
        '!procedure P',
        '!procedure $p($a',
        '!procedure $q($a = "open)',
        '!procedure $r(1)',
        '!unquotedx procedure U()',
        // One white space after each flag, as the engine's line pattern has it.
        '!final  procedure F()',
        '!undef',
        '!foreach $i [1]',
        '!foreach in [1]',
      ])
    ).toEqual([]);
  });

  it('reads the files that `!include` and `!includesub` read, with what follows their `!`', () => {
    expect(
      declarationsOf([
        '!include common.puml',
        '!include_once lib/a.iuml!2',
        '!include_many <C4/C4_Context>',
        '!include<C4/C4_Container>',
        '!includeurl local.puml',
        '!include _once x.puml',
        '!includesub parts.puml!PART',
        '!includesub PART',
        `!include spaced.puml ${NO_BREAK_SPACE}`,
        '!include odd!name.puml!2',
        '!includesub a.puml!B!C',
      ]).map((d) => (d.type === 'include' ? [d.directive, d.target, d.start, d.end, d.selector] : []))
    ).toEqual([
      ['include', 'common.puml', 9, 20, null],
      ['include_once', 'lib/a.iuml', 14, 24, '2'],
      ['include_many', '<C4/C4_Context>', 14, 29, null],
      // The engine needs no white space after the directive.
      ['include', '<C4/C4_Container>', 8, 25, null],
      // `!includeurl` reads a path as `!include` does.
      ['include', 'local.puml', 12, 22, null],
      ['include', '_once x.puml', 9, 21, null],
      ['includesub', 'parts.puml', 12, 22, 'PART'],
      // Without a `!`, a section of the text itself.
      ['includesub', '', 12, 12, 'PART'],
      ['include', 'spaced.puml', 9, 20, null],
      // The path of `!include` ends at its last `!`, that of `!includesub` at its first.
      ['include', 'odd!name.puml', 9, 22, '2'],
      ['includesub', 'a.puml', 12, 18, 'B!C'],
    ]);
  });

  it('reads the target of an include after a comment taken off the line, in columns of the line', () => {
    expect(
      declarationsOf(["!include common.puml /' note '/", "/' note '/ !include shifted.puml"]).map((d) =>
        d.type === 'include' ? [d.target, d.start, d.end] : []
      )
    ).toEqual([
      ['common.puml', 9, 20],
      ['shifted.puml', 20, 32],
    ]);
  });

  it('marks an include under a condition, and one in a body with its line', () => {
    expect(
      declarationsOf(['!if 1', '!include a.puml', '!endif', '!procedure P()', '!include b.puml', '!endprocedure']).map(
        (d) => [label(d), d.conditional, d.body]
      )
    ).toEqual([
      ['a.puml', true, undefined],
      ['P', false, undefined],
      ['b.puml', false, 3],
    ]);
  });

  it('keeps the section a declaration lies in, which `!includesub` reads again', () => {
    expect(
      declarationsOf(['!startsub PART', '!$x = 1', '!endsub', '!$y = 2', '!startsub bad-name', '!$z = 3']).map((d) => [
        label(d),
        d.sub === undefined ? undefined : `${d.sub.name}@${d.sub.line}`,
      ])
    ).toEqual([
      ['$x', 'PART@0'],
      ['$y', undefined],
      ['$z', undefined],
    ]);
  });

  it('numbers the lines it is given as asked', () => {
    expect(declarationsOf(['!$a = 1', '!$b = 2'], [3, 7]).map((d) => d.line)).toEqual([3, 7]);
  });

  it('reads names with letters of any script and emoji, as the engine does', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(names(['!$名前 = 1', `!procedure ${emoji}box()`, '!endprocedure', '!$_x9 = 2'])).toEqual([
      '$名前',
      `${emoji}box`,
      '$_x9',
    ]);
  });
});

describe('readUntilCommaOrClose', () => {
  it.each([
    ['"a,b", c)', 5],
    ['f(1, 2), 3)', 7],
    ["'x)', y", 4],
    ['"open', null],
    ['no end', null],
  ])('finds the end of %j at %j', (text, end) => {
    expect(readUntilCommaOrClose(text, 0)).toBe(end);
  });
});

describe('withoutInnerComment', () => {
  it('takes off a comment the line starts with, and then the special comments in what is left', () => {
    const cut = withoutInnerComment("/' a '/ x /'''y'''/ z");
    expect(cut).toEqual({
      text: ' x  z',
      removed: [
        [0, 7],
        [10, 19],
      ],
    });
    expect(columnIn(cut, 1)).toBe(8);
    expect(columnIn(cut, 4)).toBe(20);
  });

  it('takes off a comment the line ends with', () => {
    expect(withoutInnerComment("text /' a '/")).toEqual({ text: 'text ', removed: [[5, 12]] });
  });

  it('reads the line with tabs as spaces, and keeps a comment followed by a no-break space', () => {
    expect(withoutInnerComment("\t/' a '/\tx").text).toBe('\tx');
    const kept = `x /' a '/${NO_BREAK_SPACE}`;
    expect(withoutInnerComment(kept)).toEqual({ text: kept, removed: [] });
  });

  it('keeps a line with a comment in its middle', () => {
    expect(withoutInnerComment("a /' b '/ c")).toEqual({ text: "a /' b '/ c", removed: [] });
  });
});
