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
 *
 * The only image the engine draws is a PNG written inline (see
 * src/core/inline-png.ts). One from a file or a URL, or inline data of
 * another kind, is drawn as the text "[img TBD42102]" in its place. An image
 * is named with `<img:…>`, `<img …>` or `<img src=…>`, and in C4 with an
 * argument that starts with `img:` (`$sprite="img:…"`), which C4 turns into
 * one. C4 also takes a sprite by position and through a variable, so any
 * argument that starts with `img:` counts: a label that happens to start
 * with it is taken for an image too.
 */

import { isInlinePng } from './inline-png';
import { forEachCodeLine, START } from './shape';

/** The kinds of notation the engine leaves out. */
export type UnsupportedNotation = 'math' | 'latex' | 'embedded' | 'image';

/** One use of such notation, on `line` of the source (counting from 0). */
export interface NotationUse {
  kind: UnsupportedNotation;
  line: number;
}

/**
 * An image in a text, as the engine reads it: `<i` in that case and `mg` in
 * any, a colon or spaces, the image, and a scale.
 */
const TEXT_IMAGE = /<i[mM][gG][\s:]+([^>{}]+)(?:\{scale=[0-9.]+\})?>/g;

/** An argument that starts with `img:`, quoted either way or not at all. */
const IMAGE_ARGUMENT = /[(,=][ \t]*(?:"img:([^"]*)"|'img:([^']*)'|img:([^\s,)]*))/g;

/** Whether `line` names an image the engine does not draw. */
function namesUndrawnImage(line: string): boolean {
  const images = [
    // Without `src=` and its quotes, as the engine takes them off.
    ...[...line.matchAll(TEXT_IMAGE)].map(([, image = '']) => {
      const source = /^src=/i.test(image) ? image.slice(4) : image;
      return /^".*"$/.test(source) ? source.slice(1, -1) : source;
    }),
    // C4 writes the argument into `<img:…>`, a scale and all.
    ...[...line.matchAll(IMAGE_ARGUMENT)].map(([, double, single, bare]) =>
      (double ?? single ?? bare ?? '').replace(/\{scale=[0-9.]+\}$/, '')
    ),
  ];
  return images.some((image) => !isInlinePng(image));
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
    if (namesUndrawnImage(line)) {
      uses.push({ kind: 'image', line: index });
    }
  });
  return uses;
}

/** The kinds `source` uses, each once, in a fixed order. */
export function unsupportedKinds(source: string): UnsupportedNotation[] {
  const seen = new Set(unsupportedNotations(source).map((use) => use.kind));
  return (['math', 'latex', 'embedded', 'image'] as const).filter((kind) => seen.has(kind));
}

/** What to say about each kind: `formula` is given the tag, `<math>` or `<latex>`. */
export interface NotationLabels {
  formula(tag: string): string;
  embeddedDiagram: string;
  image: string;
}

/** What to say about `kind`. */
export function notationLabel(kind: UnsupportedNotation, labels: NotationLabels): string {
  switch (kind) {
    case 'math':
      return labels.formula('<math>');
    case 'latex':
      return labels.formula('<latex>');
    case 'embedded':
      return labels.embeddedDiagram;
    case 'image':
      return labels.image;
  }
}
