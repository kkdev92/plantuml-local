import { describe, expect, it } from 'vitest';

import { readStyleSheet } from '../../src/core/style-sheet';

/** The style sheet `lines`, read up to the `|` in them. */
const upTo = (...lines: string[]): ReturnType<typeof readStyleSheet> => {
  const line = lines.findIndex((text) => text.includes('|'));
  const column = lines[line]?.indexOf('|') ?? 0;
  return readStyleSheet(
    lines.map((text) => text.replace('|', '')),
    { line, column }
  );
};

describe('readStyleSheet', () => {
  it('reads a property written either way, with where its name and its value are', () => {
    const { properties, refused } = readStyleSheet(['element {', '  FontColor red', '  LineColor: #E00;', '}']);

    expect(refused).toBe(false);
    expect(properties).toEqual([
      { name: 'FontColor', line: 1, start: 2, end: 11, value: { line: 1, start: 12, end: 15, text: 'red' } },
      { name: 'LineColor', line: 2, start: 2, end: 11, value: { line: 2, start: 13, end: 17, text: '#E00' } },
    ]);
  });

  it('reads a rule on one line, two properties on a line, and a value up to a closing brace', () => {
    const { properties } = readStyleSheet(['sequenceDiagram { participant { FontColor #1A2B3C; LineColor #FEDCB0 } }']);

    expect(properties.map(({ name, value }) => [name, value.text])).toEqual([
      ['FontColor', '#1A2B3C'],
      ['LineColor', '#FEDCB0'],
    ]);
  });

  it('takes a comment after a value as part of it, as the engine does, and skips the others', () => {
    const { properties } = readStyleSheet([
      '// a rule',
      'element {',
      "  /' a note '/ FontColor red // the colour",
      '  /* a note */ LineColor blue /* the line */',
      '}',
    ]);

    expect(properties.map(({ value }) => value.text)).toEqual(['red // the colour', 'blue /* the line */']);
  });

  it('records a value written on the line of its name only, and reads past the others', () => {
    const { properties } = readStyleSheet(['element {', '  FontColor', '  red', '  LineColor blue', '}']);

    expect(properties.map(({ name }) => name)).toEqual(['LineColor']);
  });

  it('reads a quoted value whole, and leaves a variable out of the properties', () => {
    const { properties } = readStyleSheet(['element {', '  --accent #E00', '  FontName "Courier; New"', '}']);

    expect(properties.map(({ name, value }) => [name, value.text])).toEqual([['FontName', '"Courier; New"']]);
  });

  it('tells what the engine refuses: an empty name, a missing brace, a property outside of any rule', () => {
    expect(readStyleSheet(['{', '}']).refused).toBe(true);
    expect(readStyleSheet(['element, }']).refused).toBe(true);
    expect(readStyleSheet(['FontColor red']).refused).toBe(true);
    expect(readStyleSheet(['@media dark;']).refused).toBe(true);
    expect(readStyleSheet(['element {', '}', '@media dark {', '  element {', '  }', '}']).refused).toBe(false);
  });

  it('reads on past a refused statement, so that the properties after it are found', () => {
    const { properties, refused } = readStyleSheet(['LineColor #ABC;', 'element {', '  FontColor red', '}']);

    expect(refused).toBe(true);
    expect(properties.map(({ name }) => name)).toEqual(['LineColor', 'FontColor']);
  });

  it('gives the rules open at a stop, outermost first: their selectors, a star, or an @ rule', () => {
    expect(upTo('sequenceDiagram {', '  participant, arrow * {', '    |').open).toEqual([
      { selectors: ['sequenceDiagram'], star: false, at: false },
      { selectors: ['participant', 'arrow'], star: true, at: false },
    ]);
    expect(upTo('@media dark {', '  element {', '  }', '  |').open).toEqual([{ selectors: [], star: false, at: true }]);
    expect(upTo('element {', '}', '|').open).toEqual([]);
  });

  it('tells what a stop lies in: between statements, a name, a value, or anything else', () => {
    expect(upTo('element {', '  |').pending).toEqual({ kind: 'statement' });
    expect(upTo('element {', '  Font|Col').pending).toEqual({ kind: 'name', line: 1, start: 2 });
    expect(upTo('element {', '  FontColor |').pending).toEqual({ kind: 'value', name: 'FontColor', start: 12 });
    expect(upTo('element {', '  FontColor:  #E|00;').pending).toEqual({ kind: 'value', name: 'FontColor', start: 14 });
    expect(upTo('element {', '  FontColor:|').pending).toEqual({ kind: 'value', name: 'FontColor', start: 12 });
    // In quoted text, the value still: src/language/style.ts offers nothing there.
    expect(upTo('element {', '  FontName "Cour|').pending).toEqual({ kind: 'value', name: 'FontName', start: 11 });
    // A name that what follows makes a selector: src/language/style.ts looks past the cursor.
    expect(upTo('partic|ipant, arrow {').pending).toEqual({ kind: 'name', line: 0, start: 0 });
    // A line break after the name: the value is read there, but not offered.
    expect(upTo('element {', '  FontColor', '  |').pending).toEqual({ kind: 'other' });
    for (const lines of [
      ['element {', '  /* Font| */'],
      ['element {', '  // Font|'],
      ['"quo|ted" {'],
      ['participant, ar|row {'],
      ['@media da|rk {'],
    ]) {
      expect(upTo(...lines).pending, lines.join('\n')).toEqual({ kind: 'other' });
    }
  });
});
