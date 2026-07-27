/**
 * Approximate text measurement for the render worker.
 *
 * PlantUML measures label widths through a Canvas 2D context, which Node
 * does not provide. Instead of pulling in a native canvas binding, we
 * answer with approximate advance widths: the Helvetica/Arial metrics
 * (per mille of the font size) for Latin characters, and a full em for
 * CJK, kana and other full-width characters.
 *
 * The trade-off is documented in the README: boxes can be slightly wider
 * or narrower than a browser rendering of the same diagram.
 */

/** Advance widths as a fraction of the font size, keyed by character. */
const ADVANCE: Record<string, number> = Object.create(null) as Record<string, number>;
for (const c of '0123456789') {ADVANCE[c] = 0.556;}
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {ADVANCE[c] = 0.667;}
for (const c of 'abcdefghijklmnopqrstuvwxyz') {ADVANCE[c] = 0.556;}
for (const c of 'ilj') {ADVANCE[c] = 0.222;}
for (const c of 'mw') {ADVANCE[c] = 0.833;}
for (const c of ' !,.:;|') {ADVANCE[c] = 0.278;}
for (const c of '()[]{}') {ADVANCE[c] = 0.333;}
for (const c of '<=>+~') {ADVANCE[c] = 0.584;}
ADVANCE['-'] = 0.333;
ADVANCE['@'] = 1.015;
ADVANCE['M'] = 0.833;
ADVANCE['W'] = 0.944;

/** Code points above this are treated as full-width (one em). */
const FULL_WIDTH_THRESHOLD = 0x2e80;

/** Fallback for Latin/asciiish characters missing from the table. */
const DEFAULT_ADVANCE = 0.556;

/** Measures the width of `text` at the given font size, in pixels. */
export function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const codePoint = ch.codePointAt(0) ?? 0;
    const advance = codePoint > FULL_WIDTH_THRESHOLD ? 1 : (ADVANCE[ch] ?? DEFAULT_ADVANCE);
    width += advance * fontSize;
  }
  return width;
}

export interface TextMetricsLike {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
}

export interface Canvas2DContextStub {
  font: string;
  measureText(text: string): TextMetricsLike;
}

/**
 * Creates the minimal Canvas 2D context PlantUML needs: a `font` property
 * it assigns before measuring, and `measureText`.
 */
export function createCanvas2DContextStub(): Canvas2DContextStub {
  let fontSize = 14;

  return {
    set font(value: string) {
      const match = /(\d+(?:\.\d+)?)px/.exec(value);
      if (match?.[1] !== undefined) {
        fontSize = Number.parseFloat(match[1]);
      }
    },
    get font(): string {
      return `${String(fontSize)}px sans-serif`;
    },
    measureText(text: string): TextMetricsLike {
      return {
        width: measureTextWidth(String(text), fontSize),
        actualBoundingBoxAscent: fontSize * 0.75,
        actualBoundingBoxDescent: fontSize * 0.25,
      };
    },
  };
}
