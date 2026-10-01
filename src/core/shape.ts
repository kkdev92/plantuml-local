/**
 * How a block's source divides into diagrams, read the way the bundled
 * engine reads one input.
 *
 * A diagram runs from a line starting with `@start…` (or `\start…`) to one
 * starting with `@end…`; neither counts on a `'` comment line or inside a
 * `/' … '/` block comment, which the engine skips too. The engine draws
 * only the first diagram of an input and only the first page of a diagram
 * that uses `newpage`, and says nothing about the rest; it fails outright
 * on a diagram whose end line is missing. Those cases are told apart here,
 * before the engine sees the source.
 */

/** What the preview and export do with a block's source. */
export type DiagramShape =
  /**
   * Hand `source` to the engine. `addedEnd` is the end line appended
   * because the block had none, or null when the source is unchanged.
   */
  | { kind: 'drawable'; source: string; addedEnd: string | null }
  /** More than one `@start…` line: only the first diagram would be drawn. */
  | { kind: 'several' }
  /** `newpage` inside the diagram: only the first page would be drawn. */
  | { kind: 'pages' };

const START = /^\s*([@\\])start([A-Za-z0-9_]+)/;
const END = /^\s*[@\\]end/;
const NEWPAGE = /^\s*newpage(?:\s|$)/i;

export function diagramShape(source: string): DiagramShape {
  let inBlockComment = false;
  let starts = 0;
  let open = false;
  let pages = false;
  let addedEnd = '';

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlockComment || trimmed.startsWith("/'")) {
      inBlockComment = !trimmed.endsWith("'/");
      continue;
    }
    if (trimmed.startsWith("'")) {
      continue;
    }
    const start = START.exec(line);
    if (start !== null) {
      starts++;
      if (!open) {
        open = true;
        addedEnd = `${start[1] ?? '@'}end${start[2] ?? 'uml'}`;
      }
      continue;
    }
    if (END.test(line)) {
      open = false;
      continue;
    }
    if (open && NEWPAGE.test(line)) {
      pages = true;
    }
  }

  if (starts > 1) {
    return { kind: 'several' };
  }
  if (pages) {
    return { kind: 'pages' };
  }
  if (starts === 1 && open) {
    return { kind: 'drawable', source: `${source}\n${addedEnd}`, addedEnd };
  }
  return { kind: 'drawable', source, addedEnd: null };
}
