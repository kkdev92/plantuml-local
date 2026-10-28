/**
 * What in a diagram is text rather than PlantUML: comments, quoted text,
 * the text of notes, legends, titles, headers and footers, the data of
 * sprites, style sheets, the body of a JSON object, and all of a JSON or
 * YAML diagram. The completion takes no names from it and offers nothing
 * in it.
 *
 * Comments are told apart as the rest of the extension tells them apart
 * (forEachCodeLine in src/core/shape.ts): a line starting with `'`, and the
 * lines of a `/' … '/` block that starts a line. They are told apart first,
 * as the engine's preprocessor drops them before anything else is read. A
 * `/' … '/` or an apostrophe within a line is drawn as text by the bundled
 * engine, so it is code here. Notes and texts end where the folding ends
 * them (textEnd in src/language/folding.ts).
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

import { noteText, textEnd } from './folding';

/** A line of a diagram, its protected text told apart. */
export interface CodeLine {
  /** The line with its protected text replaced by spaces: as long as the line. */
  code: string;
  /** Whether all of the line is protected. */
  whole: boolean;
  /**
   * The protected text within the line, from column `start` up to `end`:
   * Infinity when it runs on to the end of the line, where typing goes on
   * in it.
   */
  spans: readonly (readonly [start: number, end: number])[];
}

/** A sprite's keyword and name, before its data. */
const SPRITE = /^\s*sprite\s+\$?[\p{L}\p{N}_]+/iu;
/** A JSON object in a class or object diagram, up to its opening brace. */
const JSON_OBJECT = /^\s*json\s+[^{]*(?=\{)/i;
const STYLE = /^\s*<style>/i;
const STYLE_END = /<\/style>/i;

/** The quoted text of `line` that starts before column `end`, quoted either way. */
function quotes(line: string, end: number): [number, number][] {
  const spans: [number, number][] = [];
  let at = 0;
  while (at < end) {
    const quote = line[at];
    if (quote === '"' || quote === '“') {
      const close = line.indexOf(quote === '"' ? '"' : '”', at + 1);
      const stop = close === -1 ? Infinity : close + 1;
      spans.push([at, stop]);
      at = stop;
    } else {
      at += 1;
    }
  }
  return spans;
}

/** How far the line opens (or, below 0, closes) JSON objects and arrays, outside its strings. */
function depth(text: string): number {
  let change = 0;
  let string = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (string) {
      if (char === '\\') {
        at += 1;
      } else if (char === '"') {
        string = false;
      }
    } else if (char === '"') {
      string = true;
    } else if (char === '{' || char === '[') {
      change += 1;
    } else if (char === '}' || char === ']') {
      change -= 1;
    }
  }
  return change;
}

function codeLine(line: string, spans: readonly (readonly [number, number])[]): CodeLine {
  // UTF-16 code units, as VS Code counts columns.
  const chars = line.split('');
  for (const [start, end] of spans) {
    chars.fill(' ', start, Math.min(end, line.length));
  }
  return { code: chars.join(''), whole: false, spans };
}

const protectedLine = (line: string): CodeLine => ({ code: ' '.repeat(line.length), whole: true, spans: [] });

/**
 * The lines of a diagram, `lines` from the line after its start line, with
 * their protected text told apart. `data` is a JSON or YAML diagram, all
 * of which is data.
 */
export function protect(lines: readonly string[], data: boolean): CodeLine[] {
  let comment = false;
  let text: RegExp | null = null;
  let sprite = false;
  let style = false;
  let json = 0;

  return lines.map((line) => {
    const trimmed = line.trim();
    if (data) {
      return protectedLine(line);
    }
    if (comment || trimmed.startsWith("/'")) {
      comment = !trimmed.endsWith("'/");
      return protectedLine(line);
    }
    if (trimmed.startsWith("'")) {
      return protectedLine(line);
    }

    if (text !== null) {
      if (!text.test(line)) {
        return protectedLine(line);
      }
      text = null;
      return codeLine(line, quotes(line, line.length));
    }
    if (sprite) {
      sprite = trimmed !== '}';
      return protectedLine(line);
    }
    if (style) {
      style = !STYLE_END.test(line);
      return protectedLine(line);
    }
    if (json > 0) {
      json += depth(line);
      return protectedLine(line);
    }

    if (STYLE.test(line)) {
      style = !STYLE_END.test(line);
      return protectedLine(line);
    }
    const sprited = SPRITE.exec(line);
    if (sprited !== null) {
      sprite = trimmed.endsWith('{');
      return codeLine(line, [[sprited[0].length, Infinity]]);
    }
    const object = JSON_OBJECT.exec(line);
    if (object !== null) {
      json = depth(line.slice(object[0].length));
      return codeLine(line, [[object[0].length, Infinity]]);
    }
    const ends = textEnd(line);
    if (ends !== null) {
      text = ends;
      return codeLine(line, quotes(line, line.length));
    }
    const colon = noteText(line);
    return colon === null
      ? codeLine(line, quotes(line, line.length))
      : codeLine(line, [...quotes(line, colon), [colon, Infinity]]);
  });
}

/** Whether a cursor at `column` of the line is in its protected text. */
export function protectedAt(line: CodeLine, column: number): boolean {
  return line.whole || line.spans.some(([start, end]) => start < column && column < end);
}
