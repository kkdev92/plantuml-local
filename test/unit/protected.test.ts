import { describe, expect, it } from 'vitest';

import { protect, protectedAt, type CodeLine } from '../../src/language/protected';

/** The code of each line, protected text blanked out, trailing spaces dropped. */
const code = (lines: readonly string[], data = false): string[] =>
  protect(lines, data).map((line) => line.code.trimEnd());
const whole = (lines: readonly string[]): boolean[] => protect(lines, false).map((line) => line.whole);

describe('protect', () => {
  it('blanks out comment lines and block comments, as the engine skips them', () => {
    const lines = ["' a comment", 'A -> B', "/' a block", 'still in it', "'/", "/' one line '/", 'B -> A'];

    expect(whole(lines)).toEqual([true, false, true, true, true, true, false]);
    expect(code(lines)).toEqual(['', 'A -> B', '', '', '', '', 'B -> A']);
  });

  it('blanks out quoted text, keeping every column where it was', () => {
    const [line] = protect(['participant "注文係 🙂" as A : "x'], false) as [CodeLine];

    expect(line.code).toBe(`participant ${' '.repeat(8)} as A : ${' '.repeat(2)}`);
    expect(line.code).toHaveLength('participant "注文係 🙂" as A : "x'.length);
    // From the opening quote to the closing one, or on to the end of the line.
    expect(line.spans).toEqual([
      [12, 20],
      [28, Infinity],
    ]);
    expect(code(['A -> B : “curly” label'])).toEqual([`A -> B : ${' '.repeat(7)} label`]);
  });

  it('keeps an apostrophe or a /\' within a line, which the engine draws as text', () => {
    expect(code(["A -> B : it's /' shown '/"])).toEqual(["A -> B : it's /' shown '/"]);
  });

  it('blanks out the text of notes, legends, titles, headers and footers, not the lines around it', () => {
    const lines = [
      'note left of A',
      'participant "x" as y',
      'end note',
      'legend right',
      'alt',
      'endlegend',
      'title',
      'loop',
      'end title',
      'note over A {',
      'start',
      '}',
      'A -> B',
    ];

    expect(whole(lines)).toEqual([false, true, false, false, true, false, false, true, false, false, true, false, false]);
    expect(code(lines)[12]).toBe('A -> B');
  });

  it('blanks out the text of a one-line note after its colon', () => {
    const [line] = protect(['note left of A : alt and loop'], false) as [CodeLine];

    expect(line.code.trimEnd()).toBe('note left of A');
    expect(line.spans).toEqual([[15, Infinity]]);
    // A floating note is a note with an alias: its text is quoted.
    expect(code(['note "some text" as N1'])).toEqual([`note ${' '.repeat(11)} as N1`]);
  });

  it('blanks out the data of a sprite, on its line or in its rows', () => {
    expect(code(['sprite $bug [15x15/16z] PKzR2i0m2BFMi15p__FEjQEqB1z27aeqCqixa8S4OT7C53cKpsHpaYPDJY_12MHM'])).toEqual([
      'sprite $bug',
    ]);
    const lines = ['sprite $cloud [16x8/16] {', 'FFFF00000000FFFF', '0000FFFFFFFF0000', '}', 'A -> B : <$cloud>'];
    expect(whole(lines)).toEqual([false, true, true, true, false]);
    expect(code(lines)[0]).toBe('sprite $cloud');
  });

  it('blanks out a style sheet', () => {
    const lines = ['<style>', 'sequenceDiagram {', '  BackgroundColor red', '}', '</style>', 'A -> B'];

    expect(whole(lines)).toEqual([true, true, true, true, true, false]);
  });

  it('blanks out the body of a JSON object in a class or object diagram, braces counted outside strings', () => {
    const lines = ['json J {', '  "a": { "b": "}" },', '  "q": "say \\"}\\"",', '  "list": [1, 2]', '}', 'class C {', '}'];

    expect(whole(lines)).toEqual([false, true, true, true, true, false, false]);
    expect(code(lines)[0]).toBe('json J');
    // A class body is code: its braces stay.
    expect(code(lines)[5]).toBe('class C {');
  });

  it('blanks out the whole of a JSON or YAML diagram', () => {
    expect(protect(['{', '  "name": "value"', '}'], true).every((line) => line.whole)).toBe(true);
  });
});

describe('protectedAt', () => {
  const at = (text: string, column: number): boolean => protectedAt(protect([text], false)[0] as CodeLine, column);

  it('is true inside quoted text and false on either side of it', () => {
    const text = 'participant "Web" as W';
    expect([11, 12, 13, 16, 17].map((column) => at(text, column))).toEqual([false, false, true, true, false]);
    // A quote still open runs on to the end of the line.
    expect(at('A -> B : "typing', 16)).toBe(true);
  });

  it('is true after the colon of a one-line note, and anywhere on a protected line', () => {
    expect(at('note left of A : te', 19)).toBe(true);
    expect(at('note left of A : te', 14)).toBe(false);
    const [, body] = protect(['note left of A', ''], false) as [CodeLine, CodeLine];
    expect(protectedAt(body, 0)).toBe(true);
  });
});
