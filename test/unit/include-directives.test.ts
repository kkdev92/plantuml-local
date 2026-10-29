import { describe, expect, it } from 'vitest';

import { asWritten, definedWords, includeDirectives, includePathOf, themeFolderOf } from '../../src/includes/directives';

const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

describe('includePathOf', () => {
  // What the engine asks the file loader for, observed with upstream's engine.
  it.each([
    ['!include common.puml', 9, 'common.puml'],
    ['!include_once common.puml', 14, 'common.puml'],
    ['!include_many common.puml', 14, 'common.puml'],
    ['!include\tcommon.puml', 9, 'common.puml'],
    ['  \t!include indented.puml', 12, 'indented.puml'],
    ['!include   common.puml   ', 11, 'common.puml'],
    [`!include${IDEOGRAPHIC_SPACE}common.puml`, 9, 'common.puml'],
    [`!include common.puml${NO_BREAK_SPACE}`, 9, 'common.puml'],
    [`!include common.puml${IDEOGRAPHIC_SPACE}`, 9, `common.puml${IDEOGRAPHIC_SPACE}`],
    ["!include common.puml /' note '/", 9, 'common.puml'],
    ["!include common.puml/' note '/", 9, 'common.puml'],
    ["!include common.puml\t/' note '/\t", 9, 'common.puml'],
    [`!include common.puml /' note '/${NO_BREAK_SPACE}`, 9, "common.puml /' note '/"],
    ["!include common.puml /' a '/ /' b '/", 9, "common.puml /' a '/"],
    ["!include common.puml /' note '/ x", 9, "common.puml /' note '/ x"],
    ["!include common.puml /' open", 9, "common.puml /' open"],
    ["!include /' note '/ common.puml", 9, "/' note '/ common.puml"],
    ["!include common.puml ' not a comment", 9, "common.puml ' not a comment"],
    ['!include common.puml!PART', 9, 'common.puml'],
    ['!include common.puml!1', 9, 'common.puml'],
    ['!include common.puml!', 9, 'common.puml'],
    ['!include a!b!c.puml', 9, 'a!b'],
    ['!include common.puml !PART', 9, 'common.puml '],
    ["!include common.puml!PART /' note '/", 9, 'common.puml'],
    ['!include "quoted name.puml"', 9, '"quoted name.puml"'],
    ['!include_many   spaced name.puml  ', 16, 'spaced name.puml'],
    ['!include ', 9, ''],
    // !includesub names its section after the first `!`, not the last.
    ['!includesub common.puml!PART', 12, 'common.puml'],
    ['!includesub a!b!c.puml', 12, 'a'],
    // A section of the diagram itself, or a path being typed.
    ['!includesub PART', 12, 'PART'],
    ['!includesub ', 12, ''],
  ])('reads %j as asking for the path at column %i', (line, start, path) => {
    expect(includePathOf(line)).toEqual({ start, end: start + path.length, path });
  });

  it.each([
    '!INCLUDE common.puml',
    '!Include common.puml',
    '!INCLUDESUB common.puml!PART',
    '!includedef common.puml',
    '!includeurl common.puml',
    '!includecommon.puml',
    '!include',
    `!include${NO_BREAK_SPACE}common.puml`,
    '!include <C4/C4_Container>',
    '!include https://example.com/x.puml',
    "' !include common.puml",
    'Alice -> Bob : !include common.puml',
  ])('finds no local include in %j', (line) => {
    expect(includePathOf(line)).toBeNull();
  });
});

describe('themeFolderOf', () => {
  // Split as the engine's !theme splits it: at the first " from ", in any case, both sides trimmed.
  it.each([
    ['!theme local from themes', 7, 'local', 18, 'themes'],
    ['!theme local FROM themes/', 7, 'local', 18, 'themes/'],
    ['  !theme\tlocal from   themes  ', 9, 'local', 22, 'themes'],
    ['!theme my local from a from b', 7, 'my local', 21, 'a from b'],
    ["!theme local from themes /' note '/", 7, 'local', 18, 'themes'],
    ['!theme local from ', 7, 'local', 18, ''],
  ])('reads %j as the name at column %i, %j, and the folder at column %i, %j', (line, nameStart, name, start, path) => {
    expect(themeFolderOf(line)).toEqual({ start, end: start + path.length, path, name, nameStart });
  });

  it.each([
    '!theme local',
    '!theme local from',
    '!theme plain from <themes>',
    '!theme local from https://example.com/themes',
    '!THEME local from themes',
    '!themes local from themes',
    "' !theme local from themes",
  ])('finds no folder in %j', (line) => {
    expect(themeFolderOf(line)).toBeNull();
  });
});

describe('includeDirectives', () => {
  const paths = (source: string): [number, string, boolean][] =>
    includeDirectives(source).map((found) => [found.line, found.path, found.literal]);

  it('finds the includes of the code lines, with their columns', () => {
    const source = [
      '@startuml',
      '!include a.puml',
      "' !include commented.puml",
      "/'",
      '!include in-block-comment.puml',
      "'/",
      '  !include_once b/c.iuml!PART',
      '@enduml',
    ].join('\n');
    expect(includeDirectives(source)).toEqual([
      { line: 1, start: 9, end: 15, path: 'a.puml', literal: true, inBody: false },
      { line: 6, start: 16, end: 24, path: 'b/c.iuml', literal: true, inBody: false },
    ]);
  });

  it('skips a line whose path is empty', () => {
    expect(paths('!include !PART\n!include ')).toEqual([]);
  });

  it('finds the file of an !includesub, and none for a section of the diagram itself', () => {
    expect(includeDirectives('!includesub parts.puml!PART\n!includesub PART')).toEqual([
      { line: 0, start: 12, end: 22, path: 'parts.puml', literal: true, inBody: false },
    ]);
  });

  it('finds the file of a theme read from a folder, from its name and from its folder', () => {
    const path = 'themes/puml-theme-local.puml';
    expect(includeDirectives('!theme local from themes\n!theme plain\n!theme local from ')).toEqual([
      { line: 0, start: 7, end: 12, path, literal: true, inBody: false },
      { line: 0, start: 18, end: 24, path, literal: true, inBody: false },
    ]);
    expect(paths('!theme $name from themes\n!theme local from %dirpath()\n!folder = "x"\n!theme local from folder')).toEqual([
      [0, 'themes/puml-theme-$name.puml', false],
      [0, 'themes/puml-theme-$name.puml', false],
      [1, '%dirpath()/puml-theme-local.puml', false],
      [1, '%dirpath()/puml-theme-local.puml', false],
      [3, 'folder/puml-theme-local.puml', false],
      [3, 'folder/puml-theme-local.puml', false],
    ]);
  });

  it('does not take as written a path with a variable or a function', () => {
    expect(paths('!include $f\n!include %dirpath()/d.puml\n!include common$x.puml')).toEqual([
      [0, '$f', false],
      [1, '%dirpath()/d.puml', false],
      [2, 'common$x.puml', false],
    ]);
  });

  it.each([
    ['!common = "other"', 'common.puml'],
    ['!global common = "other"', 'common.puml'],
    ['!local common ?= "other"', 'common.puml'],
    ['!define common other', 'common.puml'],
    ['!definelong common', 'common.puml'],
    ['!puml = "z"', 'common.puml'],
    ['!x = "y"', 'common-x.puml'],
    ['!function common()\n!return "f"\n!endfunction', 'common.puml'],
    ['!DEFINE COMMON other', 'common.puml'],
  ])('does not take a path as written once %j defines a word of it', (definition, path) => {
    const found = includeDirectives(`${definition}\n!include ${path}`).at(-1);
    expect(found).toMatchObject({ path, literal: false });
  });

  it('takes a path as written when the words defined are not in it', () => {
    expect(paths('!$common = "other"\n!other = "x"\n!include common.puml')).toEqual([[2, 'common.puml', true]]);
  });

  it('does not take as written a path in a procedure or a function, looked for next to its caller', () => {
    const source = [
      '!procedure $inc()',
      '!include in-procedure.puml',
      '!endprocedure',
      '!function $f() !return "x"',
      '!include after-one-line-function.puml',
      '!unquoted function $g()',
      '!include in-function.puml',
      '!return 1',
      '!endfunction',
      '!include after.puml',
    ].join('\n');
    expect(paths(source)).toEqual([
      [1, 'in-procedure.puml', false],
      [4, 'after-one-line-function.puml', true],
      [6, 'in-function.puml', false],
      [9, 'after.puml', true],
    ]);
    expect(includeDirectives(source).map((found) => found.inBody)).toEqual([true, false, true, false]);
    expect(includeDirectives('!procedure $look()\n!theme local from themes\n!endprocedure')).toMatchObject([
      { literal: false, inBody: true },
      { literal: false, inBody: true },
    ]);
  });
});

describe('definedWords', () => {
  it('finds the words the code lines define, in lower case', () => {
    const source = [
      '!a = 1',
      '!$b = 2',
      '!global C ?= 3',
      '!define D x',
      '!definelong E(x)',
      '!enddefinelong',
      "' !g = 1",
      '!final procedure F()',
      '!endprocedure',
      '!unquoted function H() !return 1',
      '!procedure $p()',
      '!endprocedure',
    ].join('\n');
    expect([...definedWords(source)].sort()).toEqual(['a', 'c', 'd', 'e', 'f', 'h']);
  });
});

describe('asWritten', () => {
  it.each([
    ['star', [], true],
    ['star', ['sta', 'stars'], true],
    ['$star', [], false],
    ['%star', [], false],
    ['star', ['star'], false],
    ['Star', ['star'], false],
    ['cloud-upload', ['upload'], false],
  ])('reads %j as written when %j are defined: %s', (written, defined, expected) => {
    expect(asWritten(written, new Set(defined))).toBe(expected);
  });
});
