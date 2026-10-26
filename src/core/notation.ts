/**
 * Notation the bundled engine accepts but does not draw, found in a source
 * before it is rendered, so that the drawing can say what it leaves out.
 *
 * Measured with the bundled engine: a formula in `<math>` or `<latex>` tags
 * is drawn blank wherever it stands — a label, a note, a JSON value, a
 * mindmap node — and a diagram embedded in a note, a legend or a class body
 * with `{{ … }}` is left out of a UML diagram, both without an error. Salt
 * draws its braces, and `{{x}}` inside a label is drawn as text, so only a
 * line that starts with `{{` in a UML diagram counts as an embedded diagram.
 */

import { forEachCodeLine, START } from './shape';

/** The kinds of notation the engine leaves out. */
export type UnsupportedNotation = 'math' | 'latex' | 'embedded';

/** One use of such notation, on `line` of the source (counting from 0). */
export interface NotationUse {
  kind: UnsupportedNotation;
  line: number;
}

/**
 * Where `source` uses notation the bundled engine does not draw, one entry
 * per kind and line. Comment lines are skipped, as the engine skips them,
 * and so are the rows of a sprite, which are data.
 */
export function unsupportedNotations(source: string): NotationUse[] {
  const uses: NotationUse[] = [];
  // The word after @start, once a start line is seen; a source without one
  // is read as a UML diagram.
  let kind: string | null = null;
  let inSprite = false;
  forEachCodeLine(source, (line, index) => {
    const start = START.exec(line);
    if (start !== null) {
      kind = (start[2] ?? 'uml').toLowerCase();
      return;
    }
    const trimmed = line.trim();
    if (inSprite) {
      inSprite = trimmed !== '}';
      return;
    }
    if (trimmed.startsWith('sprite ') && trimmed.endsWith('{')) {
      inSprite = true;
      return;
    }
    if (line.includes('<math>')) {
      uses.push({ kind: 'math', line: index });
    }
    if (line.includes('<latex>')) {
      uses.push({ kind: 'latex', line: index });
    }
    if ((kind === null || kind === 'uml') && trimmed.startsWith('{{')) {
      uses.push({ kind: 'embedded', line: index });
    }
  });
  return uses;
}

/** The kinds `source` uses, each once, in a fixed order. */
export function unsupportedKinds(source: string): UnsupportedNotation[] {
  const seen = new Set(unsupportedNotations(source).map((use) => use.kind));
  return (['math', 'latex', 'embedded'] as const).filter((kind) => seen.has(kind));
}
