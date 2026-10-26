import { describe, expect, it } from 'vitest';

import { NAMED_COLORS, findColors, hexOf, rgbOf, toHex } from '../../src/core/colors';
import { documentColumnOf, documentLineOf } from '../../src/core/positions';

const puml = (...lines: string[]): string => lines.join(String.fromCharCode(10));
const hexes = (...lines: string[]): string[] => findColors(puml(...lines)).map((use) => use.hex);

describe('toHex', () => {
  it('expands three digits, upper-cases six, and takes a name the engine knows in any case', () => {
    expect(toHex('#ABC')).toBe('#AABBCC');
    expect(toHex('#f0a')).toBe('#FF00AA');
    expect(toHex('#aabbcc')).toBe('#AABBCC');
    expect(toHex('#pink')).toBe('#FFC0CB');
    expect(toHex('#PINK')).toBe('#FFC0CB');
    expect(toHex('#Business')).toBe('#FFFFCC');
    expect(toHex('#notacolour')).toBeNull();
    expect(toHex('#80AABBCC')).toBeNull();
    expect(toHex('#1234')).toBeNull();
  });

  it('has the engine’s names, which are not CSS’s in every case', () => {
    expect(Object.keys(NAMED_COLORS)).toHaveLength(154);
    expect(NAMED_COLORS['mediumpurple']).toBe('#9370D8');
    expect(NAMED_COLORS['palevioletred']).toBe('#D87093');
    for (const [name, hex] of Object.entries(NAMED_COLORS)) {
      expect(name, name).toMatch(/^[a-z]+$/);
      expect(hex, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('hexOf and rgbOf', () => {
  it('round-trip, rounding to the nearest of 256', () => {
    expect(hexOf({ red: 1, green: 0.5, blue: 0 })).toBe('#FF8000');
    expect(hexOf(rgbOf('#AABBCC'))).toBe('#AABBCC');
    expect(rgbOf('#FF0000')).toEqual({ red: 1, green: 0, blue: 0 });
    expect(hexOf({ red: 1.2, green: -1, blue: 0.5 })).toBe('#FF0080');
  });
});

describe('findColors', () => {
  it('finds the value of a skinparam, on its own line and in a block', () => {
    expect(findColors(puml('@startuml', 'skinparam backgroundColor #EEEEEE', 'A -> B', '@enduml'))).toEqual([
      { line: 1, start: 26, end: 33, hex: '#EEEEEE' },
    ]);
    expect(hexes('skinparam class {', '  BackgroundColor #ABC', '  FontSize 12', '  BorderColor #pink', '}', 'class Foo')).toEqual(['#AABBCC', '#FFC0CB']);
    expect(hexes('skinparam shadowing false', 'skinparam classFontColor red')).toEqual([]);
  });

  it('finds the colour at the end of an element’s declaration, after its name, alias or opening brace', () => {
    expect(findColors(puml('class Foo #pink'))).toEqual([{ line: 0, start: 10, end: 15, hex: '#FFC0CB' }]);
    expect(hexes('participant "Bob #1" as b #red', 'rectangle "Named" as r #ABC {', 'state S #Business', 'usecase (Do it) as UC #LightBlue', 'abstract class A #F00')).toEqual([
      '#FF0000',
      '#AABBCC',
      '#FFFFCC',
      '#ADD8E6',
      '#FF0000',
    ]);
    // Not a declaration: a message, a note, an arrow colour.
    expect(hexes('Alice -> Bob : #red', 'note left #red', 'A -[#red]-> B', ':step; #red')).toEqual([]);
  });

  it('finds a colour property of a style block, with or without its semicolon, and no other property', () => {
    expect(hexes('<style>', 'rectangle {', '  BackgroundColor #FFFFCC;', '  LineColor #ABC', '  FontSize 12', '  Padding #12', '}', '</style>', 'rectangle R')).toEqual([
      '#FFFFCC',
      '#AABBCC',
    ]);
    expect(findColors(puml('<style>', '  LineColor #ABC;', '</style>'))[0]).toEqual({ line: 1, start: 12, end: 16, hex: '#AABBCC' });
  });

  it('leaves alone gradients, modifiers, alphas, unknown names, comments, strings, URLs and sprite rows', () => {
    expect(
      hexes(
        'class A #red/blue',
        'class B #red-blue',
        'class C #red|blue',
        'class D #ABC;line:red',
        'class E #80AABBCC',
        'class F #notacolour',
        "' class G #red",
        "/'",
        'class H #red',
        "'/",
        'class I "#red"',
        'class J [[http://example.com/#ABC]]',
        'sprite $s [16x16/16] {',
        '0123456789ABCDEF',
        '}',
        'class K #1234'
      )
    ).toEqual([]);
  });

  it('counts lines from the source’s first line, comment lines included', () => {
    expect(findColors(puml("' first", '@startuml', 'class Foo #pink', '@enduml')).map((use) => use.line)).toEqual([2]);
  });
});

describe('document positions', () => {
  it('put a source line and column where they are in the document, past the container the line carries', () => {
    expect(documentLineOf(4, 2)).toBe(6);
    expect(documentColumnOf('> class Foo #pink', '> ', 10)).toBe(12);
    expect(documentColumnOf('class Foo #pink', '> ', 10)).toBe(10);
    expect(documentColumnOf('  class Foo #pink', '  ', 10)).toBe(12);
    expect(documentColumnOf('class Foo #pink', '', 10)).toBe(10);
  });
});
