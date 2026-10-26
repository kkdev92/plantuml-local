/**
 * The colours a diagram's source sets where the colour picker shows and
 * edits them: the value of a `skinparam`, the colour at the end of an
 * element's declaration, and a colour property in a `<style>` block. Each
 * is `#` and three or six hex digits, or `#` and a name the bundled engine
 * knows. Anything else is left alone: a gradient (`#red/blue`), a colour
 * with a style modifier (`#red;line:blue`), a colour with an alpha
 * (`#80AABBCC`), a name the engine does not know, and a `#` in a comment, a
 * string, a URL or the rows of a sprite.
 *
 * Like the rest of src/core, this has no dependency on the `vscode` module.
 * Lines and columns are counted from 0.
 */

import { forEachCodeLine } from './shape';

/**
 * The names the bundled engine draws, and what it draws them as: each one
 * drawn as the fill of a rectangle by @plantuml/core 1.2026.9. The names are
 * the engine's, not CSS's: `MediumPurple` and `PaleVioletRed` differ from
 * the CSS values, and the ArchiMate names are the engine's own. The worker
 * test draws each on every engine update. Names match in any case.
 */
export const NAMED_COLORS: Readonly<Record<string, string>> = {
  aliceblue: '#F0F8FF',
  antiquewhite: '#FAEBD7',
  application: '#C2F0FF',
  aqua: '#00FFFF',
  aquamarine: '#7FFFD4',
  azure: '#F0FFFF',
  beige: '#F5F5DC',
  bisque: '#FFE4C4',
  black: '#000000',
  blanchedalmond: '#FFEBCD',
  blue: '#0000FF',
  blueviolet: '#8A2BE2',
  brown: '#A52A2A',
  burlywood: '#DEB887',
  business: '#FFFFCC',
  cadetblue: '#5F9EA0',
  chartreuse: '#7FFF00',
  chocolate: '#D2691E',
  coral: '#FF7F50',
  cornflowerblue: '#6495ED',
  cornsilk: '#FFF8DC',
  crimson: '#DC143C',
  cyan: '#00FFFF',
  darkblue: '#00008B',
  darkcyan: '#008B8B',
  darkgoldenrod: '#B8860B',
  darkgray: '#A9A9A9',
  darkgreen: '#006400',
  darkgrey: '#A9A9A9',
  darkkhaki: '#BDB76B',
  darkmagenta: '#8B008B',
  darkolivegreen: '#556B2F',
  darkorange: '#FF8C00',
  darkorchid: '#9932CC',
  darkred: '#8B0000',
  darksalmon: '#E9967A',
  darkseagreen: '#8FBC8F',
  darkslateblue: '#483D8B',
  darkslategray: '#2F4F4F',
  darkslategrey: '#2F4F4F',
  darkturquoise: '#00CED1',
  darkviolet: '#9400D3',
  deeppink: '#FF1493',
  deepskyblue: '#00BFFF',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1E90FF',
  firebrick: '#B22222',
  floralwhite: '#FFFAF0',
  forestgreen: '#228B22',
  fuchsia: '#FF00FF',
  gainsboro: '#DCDCDC',
  ghostwhite: '#F8F8FF',
  gold: '#FFD700',
  goldenrod: '#DAA520',
  gray: '#808080',
  green: '#008000',
  greenyellow: '#ADFF2F',
  grey: '#808080',
  honeydew: '#F0FFF0',
  hotpink: '#FF69B4',
  implementation: '#FFE0E0',
  indianred: '#CD5C5C',
  indigo: '#4B0082',
  ivory: '#FFFFF0',
  khaki: '#F0E68C',
  lavender: '#E6E6FA',
  lavenderblush: '#FFF0F5',
  lawngreen: '#7CFC00',
  lemonchiffon: '#FFFACD',
  lightblue: '#ADD8E6',
  lightcoral: '#F08080',
  lightcyan: '#E0FFFF',
  lightgoldenrodyellow: '#FAFAD2',
  lightgray: '#D3D3D3',
  lightgreen: '#90EE90',
  lightgrey: '#D3D3D3',
  lightpink: '#FFB6C1',
  lightsalmon: '#FFA07A',
  lightseagreen: '#20B2AA',
  lightskyblue: '#87CEFA',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#B0C4DE',
  lightyellow: '#FFFFE0',
  lime: '#00FF00',
  limegreen: '#32CD32',
  linen: '#FAF0E6',
  magenta: '#FF00FF',
  maroon: '#800000',
  mediumaquamarine: '#66CDAA',
  mediumblue: '#0000CD',
  mediumorchid: '#BA55D3',
  mediumpurple: '#9370D8',
  mediumseagreen: '#3CB371',
  mediumslateblue: '#7B68EE',
  mediumspringgreen: '#00FA9A',
  mediumturquoise: '#48D1CC',
  mediumvioletred: '#C71585',
  midnightblue: '#191970',
  mintcream: '#F5FFFA',
  mistyrose: '#FFE4E1',
  moccasin: '#FFE4B5',
  motivation: '#CCCCFF',
  navajowhite: '#FFDEAD',
  navy: '#000080',
  oldlace: '#FDF5E6',
  olive: '#808000',
  olivedrab: '#6B8E23',
  orange: '#FFA500',
  orangered: '#FF4500',
  orchid: '#DA70D6',
  palegoldenrod: '#EEE8AA',
  palegreen: '#98FB98',
  paleturquoise: '#AFEEEE',
  palevioletred: '#D87093',
  papayawhip: '#FFEFD5',
  peachpuff: '#FFDAB9',
  peru: '#CD853F',
  physical: '#97FF97',
  pink: '#FFC0CB',
  plum: '#DDA0DD',
  powderblue: '#B0E0E6',
  purple: '#800080',
  red: '#FF0000',
  rosybrown: '#BC8F8F',
  royalblue: '#4169E1',
  saddlebrown: '#8B4513',
  salmon: '#FA8072',
  sandybrown: '#F4A460',
  seagreen: '#2E8B57',
  seashell: '#FFF5EE',
  sienna: '#A0522D',
  silver: '#C0C0C0',
  skyblue: '#87CEEB',
  slateblue: '#6A5ACD',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#FFFAFA',
  springgreen: '#00FF7F',
  steelblue: '#4682B4',
  strategy: '#F8E7C0',
  tan: '#D2B48C',
  teal: '#008080',
  technology: '#C9FFC9',
  thistle: '#D8BFD8',
  tomato: '#FF6347',
  turquoise: '#40E0D0',
  violet: '#EE82EE',
  wheat: '#F5DEB3',
  white: '#FFFFFF',
  whitesmoke: '#F5F5F5',
  yellow: '#FFFF00',
  yellowgreen: '#9ACD32',
};

/** A colour a diagram sets: where its `#…` token is in the source, and what it is as `#RRGGBB`. */
export interface ColorUse {
  line: number;
  start: number;
  end: number;
  hex: string;
}

/**
 * A colour token at the end of a line: `#` and three or six hex digits or
 * letters, followed by nothing but spaces and, for an element, a `{` — so
 * not a gradient, a style modifier, an alpha, or a URL's fragment.
 */
const TRAILING = /\s(#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[A-Za-z]+))(?:\s*\{)?\s*$/;
/** `skinparam <name> <value>`. */
const SKINPARAM = /^\s*skinparam\s+\S+\s+#\S+\s*$/i;
/** A line of a `skinparam … {` block: `<Name> <value>`. */
const SKINPARAM_ENTRY = /^\s*[A-Za-z][\w<>]*\s+#\S+\s*$/;
/** A colour property of a `<style>` block: `<…Color…> <value>`, maybe ended with `;`. */
const STYLE_ENTRY = /^\s*[A-Za-z]*colou?r[A-Za-z]*\s+#\S+\s*;?\s*$/i;
/**
 * A declaration of an element that takes a colour at its end, by the word
 * that starts it.
 */
const ELEMENT =
  /^\s*(?:abstract\s+class|abstract|class|interface|enum|annotation|entity|object|participant|actor|boundary|control|database|collections|queue|state|usecase|rectangle|package|node|cloud|folder|frame|component|artifact|card|file|hexagon|label|storage|agent|stack|person|circle|map|json)\b/i;

/** `#ABC` as `#AABBCC`, `#aabbcc` as `#AABBCC`, `#pink` as the engine draws it, or null for a name it does not know. */
export function toHex(token: string): string | null {
  const value = token.slice(1);
  if (/^[0-9A-Fa-f]{6}$/.test(value)) {
    return `#${value.toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{3}$/.test(value)) {
    return `#${value
      .split('')
      .map((digit) => digit + digit)
      .join('')
      .toUpperCase()}`;
  }
  return NAMED_COLORS[value.toLowerCase()] ?? null;
}

/** `#RRGGBB` for colour components in `[0, 1]`. */
export function hexOf(color: { red: number; green: number; blue: number }): string {
  const part = (component: number): string =>
    Math.round(Math.min(1, Math.max(0, component)) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `#${part(color.red)}${part(color.green)}${part(color.blue)}`;
}

/** The components of `#RRGGBB` in `[0, 1]`. */
export function rgbOf(hex: string): { red: number; green: number; blue: number } {
  return {
    red: parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/**
 * The colours `source` sets where the picker edits them, in source order.
 * Comment lines, the rows of a sprite and anything the position rules above
 * do not cover are left out.
 */
export function findColors(source: string): ColorUse[] {
  const found: ColorUse[] = [];
  let inSprite = false;
  let inStyle = false;
  let inSkinparam = false;
  forEachCodeLine(source, (line, index) => {
    const trimmed = line.trim();
    if (inSprite) {
      inSprite = trimmed !== '}';
      return;
    }
    if (trimmed.startsWith('sprite ') && trimmed.endsWith('{')) {
      inSprite = true;
      return;
    }
    if (/^<style>$/i.test(trimmed)) {
      inStyle = true;
      return;
    }
    if (/^<\/style>$/i.test(trimmed)) {
      inStyle = false;
      return;
    }
    if (/^skinparam\b.*\{$/i.test(trimmed)) {
      inSkinparam = true;
      return;
    }
    if (inSkinparam && trimmed === '}') {
      inSkinparam = false;
      return;
    }
    const where = inStyle
      ? STYLE_ENTRY.test(line)
      : inSkinparam
        ? SKINPARAM_ENTRY.test(line)
        : SKINPARAM.test(line) || ELEMENT.test(line);
    if (!where) {
      return;
    }
    const match = TRAILING.exec(inStyle ? line.replace(/;\s*$/, '') : line);
    if (match === null || match[1] === undefined) {
      return;
    }
    const hex = toHex(match[1]);
    if (hex === null) {
      return;
    }
    const start = match.index + 1;
    found.push({ line: index, start, end: start + match[1].length, hex });
  });
  return found;
}
