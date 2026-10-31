/**
 * How a block's source divides into diagrams, read the way the bundled
 * engine reads one input.
 *
 * A diagram runs from a line starting with `@start…` (or `\start…`) to one
 * starting with `@end…`; neither counts on a `'` comment line or inside a
 * `/' … '/` block comment, which the engine skips too, nor inside a
 * diagram's multi-line note or legend, whose lines the engine reads as the
 * note's text (see forEachShapeLine). The engine draws only
 * the first diagram of an input and only the first page of a diagram that
 * uses `newpage`, and says nothing about the rest; nor about the lines it
 * leaves out above the start line. It adds the end line a diagram is
 * missing. Those cases are told apart here, before the engine sees the
 * source.
 *
 * Lines are counted from 0 within the source.
 */

import { splitLines } from './lines';

/** What the preview and export do with a block's source. */
export type DiagramShape =
  /**
   * Hand `source` to the engine. `addedEnd` is the end line appended
   * because the block had none, or null when the source is unchanged.
   * `startLine` is the diagram's `@start…` line, or null without one.
   * `before` is the first line above it, which the engine leaves out with
   * the rest up to the start line `start`, or null when there is none.
   */
  | {
      kind: 'drawable';
      source: string;
      addedEnd: string | null;
      startLine: number | null;
      before: { line: number; start: string } | null;
    }
  /** More than one `@start…` line, the second at `line`: only the first diagram would be drawn. */
  | { kind: 'several'; line: number }
  /** `newpage` inside the diagram, at `line`: only the first page would be drawn. */
  | { kind: 'pages'; line: number };

/** A diagram's first line, capturing its marker (`@` or `\`) and its kind. */
export const START = /^\s*([@\\])start([A-Za-z0-9_]+)/;
/** A diagram's last line. */
export const END = /^\s*[@\\]end/;
const NEWPAGE = /^\s*newpage(?:\s|$)/i;
/** Diagrams whose lines are data rather than PlantUML. */
export const DATA = /^\s*[@\\]start(?:json|yaml)\b/;

/** A note's first line, capturing what follows the word `note`. */
export const NOTE = /^\s*(?:&\s*)?\/?\s*(?:floating\s+)?[hr]?note\b(.*)$/i;
const NOTE_END = /^\s*end\s?[hr]?note\s*$/i;
const BRACE_END = /^\s*\}\s*$/;
/** `note "text" as N1`, which is one line. */
export const FLOATING_TEXT = /^\s*"[^"]*"\s+as\s/i;
/** A colon of its own, before a one-line note's text: `::` is part of a member's name. */
export const LABEL_COLON = /(?<!:):(?!:)/;
const LEGEND = /^\s*legend(?:\s+(?:top|bottom))?(?:\s+(?:left|right|center))?\s*$/i;
const LEGEND_END = /^\s*end\s?legend\s*$/i;

/** The line that ends the multi-line note or legend `line` starts, or null. */
export function noteEnd(line: string): RegExp | null {
  const note = NOTE.exec(line);
  if (note !== null) {
    const rest = note[1] ?? '';
    if (FLOATING_TEXT.test(rest) || LABEL_COLON.test(rest)) {
      return null;
    }
    return /\{\s*$/.test(rest) ? BRACE_END : NOTE_END;
  }
  return LEGEND.test(line) ? LEGEND_END : null;
}

/**
 * Whether `source` has a line that starts a diagram, outside comments. A
 * PlantUML file without one is lines to include, not a diagram.
 */
export function hasStartLine(source: string): boolean {
  let found = false;
  forEachCodeLine(source, (line) => {
    found ||= START.test(line);
  });
  return found;
}

/**
 * Calls `visit` with each line the engine reads as part of the diagram text,
 * skipping comment lines and block comments, with the line's index.
 */
export function forEachCodeLine(source: string, visit: (line: string, index: number) => void): void {
  let inBlockComment = false;
  splitLines(source).forEach((line, index) => {
    const trimmed = line.trim();
    if (inBlockComment || trimmed.startsWith("/'")) {
      inBlockComment = !trimmed.endsWith("'/");
      return;
    }
    if (!trimmed.startsWith("'")) {
      visit(line, index);
    }
  });
}

/**
 * Calls `visit` as forEachCodeLine does, but not with the lines inside a
 * diagram's multi-line note or legend: the engine reads those as the note's
 * text up to its end line, however they begin, so none of them starts, ends
 * or pages a diagram. The note's first line and end line are visited. The
 * lines of a JSON or YAML diagram are data, with no notes in them.
 *
 * A note counts only when its end line comes before the source ends and
 * before a start line that follows an end line in it. The engine would read
 * a note left open on into the next diagram, taking that diagram in; read as
 * any other lines, the note's lines keep the diagrams apart.
 */
export function forEachShapeLine(source: string, visit: (line: string, index: number) => void): void {
  const lines: { text: string; index: number }[] = [];
  forEachCodeLine(source, (text, index) => {
    lines.push({ text, index });
  });
  // The end line of the note being read, which is visited.
  let noteLast = 0;
  // How far a note left open runs, by the line that would end it: a note of
  // the same kind starting before then is left open too.
  const leftOpen = new Map<RegExp, number>();
  let notes = false;
  for (const [at, { text, index }] of lines.entries()) {
    if (at < noteLast) {
      continue;
    }
    visit(text, index);
    if (START.test(text)) {
      notes = !DATA.test(text);
      continue;
    }
    if (END.test(text)) {
      notes = false;
      continue;
    }
    const close = notes ? noteEnd(text) : null;
    if (close === null || at < (leftOpen.get(close) ?? 0)) {
      continue;
    }
    const end = noteEndAt(lines, at + 1, close);
    if (end.closed) {
      noteLast = end.at;
    } else {
      leftOpen.set(close, end.at);
    }
  }
}

/**
 * Where in `lines`, from `from`, the line ending a note matches `close`; or,
 * for a note left open, where the next diagram starts (a start line after an
 * end line) or the lines end.
 */
function noteEndAt(
  lines: readonly { text: string }[],
  from: number,
  close: RegExp
): { closed: boolean; at: number } {
  let ended = false;
  for (let at = from; at < lines.length; at++) {
    const text = lines[at]?.text ?? '';
    if (close.test(text)) {
      return { closed: true, at };
    }
    if (END.test(text)) {
      ended = true;
    } else if (ended && START.test(text)) {
      return { closed: false, at };
    }
  }
  return { closed: false, at: lines.length };
}

export function diagramShape(source: string): DiagramShape {
  let startLine: number | null = null;
  let startDirective = '';
  let lineBefore: number | null = null;
  let secondStart: number | null = null;
  let newpage: number | null = null;
  let open = false;
  let addedEnd = '';

  forEachShapeLine(source, (line, index) => {
    const start = START.exec(line);
    if (start !== null) {
      if (startLine === null) {
        startLine = index;
        open = true;
        startDirective = `${start[1] ?? '@'}start${start[2] ?? 'uml'}`;
        addedEnd = `${start[1] ?? '@'}end${start[2] ?? 'uml'}`;
      } else {
        secondStart ??= index;
      }
      return;
    }
    if (startLine === null) {
      if (line.trim() !== '') {
        lineBefore ??= index;
      }
      return;
    }
    if (END.test(line)) {
      open = false;
      return;
    }
    if (open && newpage === null && NEWPAGE.test(line)) {
      newpage = index;
    }
  });

  if (secondStart !== null) {
    return { kind: 'several', line: secondStart };
  }
  if (newpage !== null) {
    return { kind: 'pages', line: newpage };
  }
  // The engine starts the diagram at the first `@start…` line, and only an
  // `@` one; without one it keeps every line.
  const before =
    startLine !== null && lineBefore !== null && startDirective.startsWith('@')
      ? { line: lineBefore, start: startDirective }
      : null;
  if (startLine !== null && open) {
    return { kind: 'drawable', source: `${source}\n${addedEnd}`, addedEnd, startLine, before };
  }
  return { kind: 'drawable', source, addedEnd: null, startLine, before };
}
