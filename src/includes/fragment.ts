import { END, forEachCodeLine, START } from '../core/shape';

/**
 * Whether an included file can be spliced in without losing anything.
 *
 * A file of plain lines is spliced in as it is. A file holding one whole
 * diagram contributes the inside of it, which is how the engine reads it.
 * The engine reads only the first diagram of a file and drops every line
 * outside it, saying nothing, so a file with a second diagram or with a
 * command outside its diagram is refused instead: the diagram would be
 * drawn without part of what the file says. Comment lines and blank lines
 * outside the diagram lose nothing.
 *
 * Lines are counted from 0.
 */
export type FragmentShape =
  | { kind: 'usable' }
  /** A command outside the file's diagram, at `line`. */
  | { kind: 'outside'; line: number }
  /** A second diagram, starting at `line`. */
  | { kind: 'several'; line: number };

export function fragmentShape(text: string): FragmentShape {
  let starts = 0;
  let open = false;
  let second: number | null = null;
  let outside: number | null = null;

  forEachCodeLine(text, (line, index) => {
    if (START.test(line)) {
      starts++;
      if (starts === 2) {
        second = index;
      }
      open = true;
      return;
    }
    if (END.test(line)) {
      open = false;
      return;
    }
    if (!open && line.trim() !== '') {
      outside ??= index;
    }
  });

  if (starts === 0) {
    return { kind: 'usable' };
  }
  if (second !== null) {
    return { kind: 'several', line: second };
  }
  if (outside !== null) {
    return { kind: 'outside', line: outside };
  }
  return { kind: 'usable' };
}
