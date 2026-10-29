import { describe, expect, it } from 'vitest';

import {
  includedLines,
  isEndDirective,
  isStartDirective,
  joinContinuedLines,
  libraryLines,
  sectionLines,
  uncommented,
} from '../../src/includes/included-lines';

const BOM = String.fromCharCode(0xfeff);
const BS = String.fromCharCode(92);

const text = (lines: readonly string[]): string => lines.join('\n');
const numbered = (lines: string[]): { lines: string[]; numbers: number[] } => ({
  lines,
  numbers: lines.map((_, index) => index),
});

const TWO_DIAGRAMS = text([
  '@startuml',
  `!procedure C($a,${BS}`,
  "' note",
  '$b)',
  'Alice -> Bob : $a $b',
  '!endprocedure',
  '@enduml',
  '@startuml(id=SECOND)',
  '!$second = 1',
  '@enduml',
]);

describe('includedLines', () => {
  it('reads a file without a diagram whole, without its YAML header, and does not join its lines', () => {
    expect(
      includedLines(text(['---', 'title: x', '---', `!procedure C($a,${BS}`, '$b)', '!endprocedure']), null)
    ).toEqual({
      lines: [`!procedure C($a,${BS}`, '$b)', '!endprocedure'],
      numbers: [3, 4, 5],
    });
  });

  it('drops a BOM, and splits lines at CR LF, LF and CR', () => {
    expect(includedLines(`${BOM}!$a = 1\r\n!$b = 2\r!$c = 3`, null)).toEqual({
      lines: ['!$a = 1', '!$b = 2', '!$c = 3'],
      numbers: [0, 1, 2],
    });
  });

  it('reads the first diagram of a file that has one, joining a line ending with a backslash', () => {
    // The comment line between the two parts of the declaration is skipped, as the engine skips it.
    expect(includedLines(TWO_DIAGRAMS, null)).toEqual({
      lines: ['!procedure C($a,$b)', 'Alice -> Bob : $a $b', '!endprocedure'],
      numbers: [1, 4, 5],
    });
  });

  it('reads the diagram that `file!N` or `file!ID` asks for', () => {
    const second = { lines: ['!$second = 1'], numbers: [8] };
    expect(includedLines(TWO_DIAGRAMS, '1')).toEqual(second);
    expect(includedLines(TWO_DIAGRAMS, '01')).toEqual(second);
    expect(includedLines(TWO_DIAGRAMS, 'SECOND')).toEqual(second);
    expect(includedLines(TWO_DIAGRAMS, '0')).toEqual(includedLines(TWO_DIAGRAMS, null));
  });

  it('cannot include a diagram the file does not have', () => {
    expect(includedLines(TWO_DIAGRAMS, '2')).toEqual({ problem: 'no-diagram' });
    expect(includedLines(TWO_DIAGRAMS, 'SECONDS')).toEqual({ problem: 'no-diagram' });
    expect(includedLines(TWO_DIAGRAMS, 'SECON')).toEqual({ problem: 'no-diagram' });
    expect(includedLines(TWO_DIAGRAMS, '99999999999')).toEqual({ problem: 'no-diagram' });
  });

  it('does not follow an ID the engine would read as a pattern', () => {
    expect(includedLines(TWO_DIAGRAMS, 'SEC.ND')).toEqual({ problem: 'pattern' });
  });

  it('ignores what follows `!` in a file without a diagram', () => {
    expect(includedLines('!$a = 1', '3')).toEqual({ lines: ['!$a = 1'], numbers: [0] });
  });

  it('reads a diagram to its end line, or to the end of the file', () => {
    expect(includedLines(text(['\\startuml', '!$a = 1', '  @endwhatever', '!$b = 2']), null)).toEqual({
      lines: ['!$a = 1'],
      numbers: [1],
    });
    expect(includedLines(text(['@startuml', '!$a = 1']), null)).toEqual({ lines: ['!$a = 1'], numbers: [1] });
  });

  it('skips a YAML header right after the start line', () => {
    expect(includedLines(text(['@startuml', '---', 'a: b', '---', '!$v = 1', '@enduml']), null)).toEqual({
      lines: ['!$v = 1'],
      numbers: [4],
    });
  });

  it('does not join the lines of a ditaa diagram', () => {
    const ditaa = text(['@startditaa', `a ${BS}`, 'b', '@endditaa', '@startuml', `c ${BS}`, 'd', '@enduml']);
    expect(includedLines(ditaa, null)).toEqual({ lines: [`a ${BS}`, 'b'], numbers: [1, 2] });
    expect(includedLines(ditaa, '1')).toEqual({ lines: ['c d'], numbers: [5] });
  });

  it('reads a diagram written in the comments of another language', () => {
    // What comes before `@start` is what goes, up to the white space before it.
    expect(
      includedLines(
        text(['class Foo {', "' @startuml", "' !procedure P()", "' x", "' !endprocedure", "' @enduml", '}']),
        null
      )
    ).toEqual({ lines: [' !procedure P()', ' x', ' !endprocedure'], numbers: [2, 3, 4] });
  });
});

describe('libraryLines', () => {
  it('reads all the lines of a library file, without a YAML header', () => {
    expect(libraryLines(text(['---', 'x: y', '---', '@startuml', '!$a = 1']))).toEqual({
      lines: ['@startuml', '!$a = 1'],
      numbers: [3, 4],
    });
    expect(libraryLines(text(['---', 'never closed']))).toEqual({ lines: [], numbers: [] });
  });
});

describe('sectionLines', () => {
  const SECTIONS = text([
    '!startsub PART',
    '!procedure S()',
    'x',
    '!endprocedure',
    '!endsub',
    '!procedure T()',
    '!endprocedure',
    '!startsub PART',
    `!$more = ${BS}`,
    '1',
    '!endsub',
  ]);

  it('reads every part of a section, one after the other, joining a line ending with a backslash', () => {
    expect(sectionLines(SECTIONS, 'PART')).toEqual({
      lines: ['!procedure S()', 'x', '!endprocedure', '!$more = 1'],
      numbers: [1, 2, 3, 8],
    });
  });

  it('cannot include a section the file does not have, or any section of a file with a bad section name', () => {
    expect(sectionLines(SECTIONS, 'OTHER')).toBeNull();
    expect(sectionLines(`${SECTIONS}\n!startsub bad-name`, 'PART')).toBeNull();
  });

  it('does not end a section at another `!startsub`, as the engine does not', () => {
    const nested = text(['!startsub A', 'a1', '!startsub B', 'b1', '!endsub', 'after']);
    expect(sectionLines(nested, 'A')).toEqual({ lines: ['a1', 'b1'], numbers: [1, 3] });
    expect(sectionLines(nested, 'B')).toEqual({ lines: ['b1'], numbers: [3] });
  });
});

describe('joinContinuedLines', () => {
  it('joins a line ending with a single backslash to the next line', () => {
    expect(joinContinuedLines(numbered([`a ${BS}`, `b ${BS}`, 'c', 'd']))).toEqual({
      lines: ['a b c', 'd'],
      numbers: [0, 3],
    });
  });

  it('keeps a line ending with two backslashes, and the last line', () => {
    expect(joinContinuedLines(numbered([`a ${BS}${BS}`, 'b', `c ${BS}`]))).toEqual({
      lines: [`a ${BS}${BS}`, 'b', `c ${BS}`],
      numbers: [0, 1, 2],
    });
  });

  it('skips comment lines and block comments to the next line, and takes comments off it', () => {
    expect(joinContinuedLines(numbered([`a ${BS}`, "' c", "/' d '/", "/' e", "f '/", "/' g '/ h", 'i']))).toEqual({
      lines: ['a  h', 'i'],
      numbers: [0, 6],
    });
  });

  it('keeps the backslash when only comments follow', () => {
    expect(joinContinuedLines(numbered([`a ${BS}`, "' only a comment"]))).toEqual({ lines: [`a ${BS}`], numbers: [0] });
  });
});

describe('uncommented', () => {
  it('takes what comes before `@start` off the lines that start with it', () => {
    expect(uncommented(numbered(['x', '// @startuml', '// a', '//', 'b', '// @enduml'])).lines).toEqual([
      'x',
      ' @startuml',
      ' a',
      '',
      'b',
      ' @enduml',
    ]);
    expect(uncommented(numbered(['<b> @startuml', '<b> a'])).lines).toEqual([' @startuml', ' a']);
  });

  it('does not take anything off for a start line with a word before `@start`', () => {
    expect(uncommented(numbered(['say @startuml', 'say a'])).lines).toEqual(['say @startuml', 'say a']);
    expect(uncommented(numbered(['<b>x</b> @startuml', '<b>x</b> a'])).lines).toEqual([
      '<b>x</b> @startuml',
      '<b>x</b> a',
    ]);
  });
});

describe('start and end lines', () => {
  it.each([
    ['@startuml', true],
    ['  \\startmindmap', true],
    ['@start', false],
    ['@STARTUML', false],
    ['x @startuml', false],
  ])('reads %j as a start line: %j', (line, start) => {
    expect(isStartDirective(line)).toBe(start);
  });

  it.each([
    ['@enduml', true],
    ['@end', true],
    ['\t\\endmindmap', true],
    ['@ENDUML', false],
    ['x @enduml', false],
  ])('reads %j as an end line: %j', (line, end) => {
    expect(isEndDirective(line)).toBe(end);
  });
});
