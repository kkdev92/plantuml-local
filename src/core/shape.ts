/**
 * How a block's source divides into diagrams, read the way the bundled
 * engine reads one input.
 *
 * A diagram runs from a line starting with `@start…` (or `\start…`) to one
 * starting with `@end…`; neither counts on a `'` comment line or inside a
 * `/' … '/` block comment, which the engine skips too. The engine draws only
 * the first diagram of an input and only the first page of a diagram that
 * uses `newpage`, and says nothing about the rest; nor about the lines it
 * leaves out above the start line. It adds the end line a diagram is
 * missing. Those cases are told apart here, before the engine sees the
 * source.
 *
 * Lines are counted from 0 within the source.
 */

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

/**
 * Calls `visit` with each line the engine reads as part of the diagram text,
 * skipping comment lines and block comments, with the line's index.
 */
export function forEachCodeLine(source: string, visit: (line: string, index: number) => void): void {
  let inBlockComment = false;
  source.split(/\r?\n/).forEach((line, index) => {
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

export function diagramShape(source: string): DiagramShape {
  let startLine: number | null = null;
  let startDirective = '';
  let lineBefore: number | null = null;
  let secondStart: number | null = null;
  let newpage: number | null = null;
  let open = false;
  let addedEnd = '';

  forEachCodeLine(source, (line, index) => {
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
