import { DIAGRAM_BACKDROP } from '../core/constants';
import { bundledLibrary } from '../core/libraries';
import { splitLines } from '../core/lines';
import type { DiagramRender, IncludedStyle } from '../core/types';
import { firstLocalIncludeLine } from '../includes/describe';

/**
 * The palette a diagram that picks a `!theme` is drawn in.
 *
 * The engine's dark palette only swaps colours that come in a light/dark
 * pair, which its own defaults do. A theme sets plain colours, drawn as
 * they are in both palettes, and most themes paint no background: the
 * diagram sits on the backdrop of the palette in use. A theme made for a
 * white page (`plain`, `cerulean`) then puts dark text on the dark
 * backdrop, and one made for a dark page puts white text on the light one.
 *
 * So such a diagram gets the palette asked for only if its theme can be
 * read in it. That is measured rather than listed: a small diagram with
 * the same `!theme` lines is rendered in both palettes, and the contrast
 * of its message label against what is behind it decides. Measuring keeps
 * up with the engine's theme library, and takes in several `!theme` lines,
 * which the engine applies one over the other.
 *
 * A `!theme`, or a bundled library, can also come from a file the diagram
 * includes, which is known only once the diagram is drawn. The diagram is
 * drawn in the palette its own lines choose; if what it included turns the
 * choice, it is drawn once more in the other palette, and that drawing is
 * taken as it is ({@link drawReadable}).
 *
 * Colours a diagram sets itself — with `skinparam`, a style or a colour on
 * an element, in its own lines or in a file it includes — are plain
 * colours as well. Set for a white page, a light box keeps the dark
 * palette's white text on it. There are too many ways to set one to look
 * for them in the source, so a diagram drawn in the dark palette is looked
 * at once drawn: when a text of it is hard to read against the shape under
 * it and the light palette reads better, the light drawing is taken. Links,
 * which the engine draws blue in both palettes, are drawn lighter in the
 * dark one.
 */

/** The probe's message, found again in the rendered SVG. */
const PROBE_LABEL = 'plantumlLocalProbe';

/** WCAG's minimum contrast for text (level AA). */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * The weakest contrast a text of a dark drawing may have before the light
 * palette is tried: WCAG's minimum for large text. The engine's own dark
 * palette draws a header or a footer at 3.9 and the closed days of a Gantt
 * chart at 3.1, no better in the light palette, which a higher bar would
 * draw a second time to find out.
 */
export const MIN_DRAWN_CONTRAST = 3;

/**
 * The colour a dark drawing's links are drawn in. The engine underlines a
 * link (`[[…]]`) in its hyperlink colour, which its dark palette keeps blue
 * (#0000FF): 2.0 against the dark backdrop, and about 1 on a dark note.
 * This one is 4.5 or more on the backdrop and on the fills the dark palette
 * gives elements, notes and warnings.
 */
export const DARK_LINK = '#9ECBFF';

/**
 * An include of a standard library, whose name the engine reads in any case.
 *
 * The bundled libraries (src/core/libraries.ts) set colours made for a white
 * page, the same in either palette. Azure paints its elements white and
 * leaves their text to the palette, which the dark one makes white: white on
 * white. C4 writes the names of boundaries, the relations and the title of
 * its legend in greys and black, which the dark backdrop all but hides.
 * Looking at the dark drawing would not catch every one: the swatches of a
 * C4 legend are as faint in either palette, so the light drawing reads no
 * better by the weakest text, and the lines are not measured at all.
 *
 * So a diagram that includes one and picks no theme is drawn in the light
 * palette, as one whose theme is made for a white page is. A theme sets the
 * text colour itself, the same in either palette, so a diagram with one is
 * measured like any other.
 */
const LIBRARY_INCLUDE = /^[ \t]*!include(?:_many|_once)?[ \t]*<([^/>]+)\//gm;

/** Whether `text` includes a bundled library made for a white page. */
export function includesWhitePageLibrary(text: string): boolean {
  return [...text.matchAll(LIBRARY_INCLUDE)].some(([, name]) => bundledLibrary(name ?? '')?.forWhitePage === true);
}

/** How many sets of `!theme` lines keep their measurement. */
const MAX_MEASUREMENTS = 64;

/** Contrast of the probe's label in each palette. */
export interface LabelContrast {
  light: number;
  dark: number;
}

/** The `!theme` lines of a diagram, trimmed; none when it picks no theme. */
export function themeLines(source: string): string[] {
  return splitLines(source)
    .filter((line) => /^[ \t]*!theme[ \t]/.test(line))
    .map((line) => line.trim());
}

/** A `!theme` read from a folder of the workspace, which only the file loader can give a probe. */
const THEME_FROM_FOLDER = /^[ \t]*!theme[ \t]+\S.*?[ \t]from[ \t]+(?!<|https?:\/\/)\S/i;

/**
 * The `!theme` lines a diagram applies, those of the files it included
 * taken as written where its first local include is: the engine applies
 * them in the order it meets them, the last over the others. A theme read
 * from a folder comes back as its own lines, which stand in for the
 * `!theme … from` line that names it, in the diagram or in a file it
 * includes.
 */
export function paletteLines(source: string, included?: IncludedStyle): string[] {
  if (included === undefined || included.themes.length === 0) {
    return themeLines(source);
  }
  const fromFolder = (line: string): boolean => THEME_FROM_FOLDER.test(line);
  const own = (lines: readonly string[]): string[] => themeLines(lines.join('\n')).filter((line) => !fromFolder(line));
  const at = firstLocalIncludeLine(source);
  const lines = splitLines(source);
  const before = at < 0 ? lines : lines.slice(0, at);
  const after = at < 0 ? [] : lines.slice(at);
  return [...own(before), ...included.themes.filter((line) => !fromFolder(line)), ...own(after)];
}

/**
 * Draws a diagram in the palette its themes can be read in: the one chosen
 * from its own lines first, then — when the files it included turn that
 * choice — once more in the other, which is taken as it is. A drawing in
 * the dark palette has its links lightened, and gives way to the light one
 * when that reads better (see the module comment).
 */
export async function drawReadable(
  source: string,
  dark: boolean,
  resolve: (source: string, dark: boolean, included?: IncludedStyle) => Promise<boolean>,
  draw: (palette: boolean) => Promise<DiagramRender>
): Promise<{ result: DiagramRender; palette: boolean }> {
  const drawIn = async (palette: boolean): Promise<DiagramRender> => {
    const result = await draw(palette);
    return palette ? { ...result, svg: lightenLinks(result.svg) } : result;
  };
  const palette = await resolve(source, dark);
  const first = await drawIn(palette);
  const again = first.includedStyle === undefined ? palette : await resolve(source, dark, first.includedStyle);
  const drawn = again === palette ? { result: first, palette } : { result: await drawIn(again), palette: again };
  if (!drawn.palette) {
    return drawn;
  }
  const weakest = weakestTextContrast(drawn.result.svg, true);
  if (weakest === undefined || weakest >= MIN_DRAWN_CONTRAST) {
    return drawn;
  }
  const light = await drawIn(false);
  const lighter = weakestTextContrast(light.svg, false);
  return lighter !== undefined && lighter > weakest ? { result: light, palette: false } : drawn;
}

/** A dark drawing, with its links — the engine's blue, underlined — in {@link DARK_LINK}. */
export function lightenLinks(svg: string): string {
  return svg.replace(/<text\b[^>]*>/g, (tag) =>
    /\stext-decoration="underline"/.test(tag) ? tag.replace(/\sfill="#0000FF"/i, ` fill="${DARK_LINK}"`) : tag
  );
}

/** A diagram that shows only what `lines` do to a message label. */
export function probeSource(lines: readonly string[]): string {
  return ['@startuml', ...lines, `Alice -> Bob : ${PROBE_LABEL}`, '@enduml'].join('\n');
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two `#RRGGBB` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/**
 * The contrast of the probe's label against what is behind it: the
 * background the diagram paints, or else the backdrop of the palette it
 * was drawn in. Undefined when there is no label — the engine drew an
 * error instead, as it does for a theme it cannot load.
 */
export function labelContrast(svg: string, dark: boolean): number | undefined {
  const label = new RegExp(
    `<text[^>]*\\bfill="(#[0-9A-Fa-f]{6})(?:[0-9A-Fa-f]{2})?"[^>]*>${PROBE_LABEL}</text>`
  ).exec(svg)?.[1];
  if (label === undefined) {
    return undefined;
  }
  return contrast(label, backdropOf(svg, dark));
}

/** What a drawing sits on: the background it paints, or else the backdrop of the palette it was drawn in. */
function backdropOf(svg: string, dark: boolean): string {
  const painted = /<svg\b[^>]*\bstyle="[^"]*background-color:\s*(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?/.exec(svg);
  return painted?.[1] !== undefined && painted[2] !== '00' ? painted[1] : DIAGRAM_BACKDROP[dark ? 'dark' : 'light'];
}

/** What a drawing draws, in order: a shape, with its attributes, or a text, with its attributes and content. */
const DRAWN = /<(rect|circle|ellipse|polygon|path)\b([^>]*)>|<text\b([^>]*)>([^<]*)<\/text>/g;

/** Left, top, right and bottom. */
type Box = readonly [number, number, number, number];

/** A number attribute, NaN when it is missing. */
function numberIn(attributes: string, name: string): number {
  const at = attributes.indexOf(` ${name}="`);
  return at === -1 ? NaN : parseFloat(attributes.slice(at + name.length + 3));
}

/** The plain colour an element is filled with as `#RRGGBB`, `none` for no fill, or null for anything else (a gradient). */
function fillOf(attributes: string): string | null {
  const fill = /\sfill="([^"]*)"/.exec(attributes)?.[1];
  if (fill === 'none') {
    return 'none';
  }
  const colour = /^(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/.exec(fill ?? '');
  return colour === null ? null : colour[2] === '00' ? 'none' : (colour[1] ?? null);
}

function boxAround(values: readonly number[]): Box | null {
  const xs = values.filter((_, index) => index % 2 === 0);
  const ys = values.filter((_, index) => index % 2 === 1);
  return xs.length === 0 || xs.length !== ys.length
    ? null
    : [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** How many numbers each command of a path takes, as the engine writes them: absolute. */
const PATH_ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, A: 7, Z: 0 };

/**
 * The box around a path's points, control points included, which holds its
 * curves; null for a command the engine does not write.
 */
function pathBox(data: string): Box | null {
  const points: number[] = [];
  const tokens = data.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let arity = 0;
  let taken: number[] = [];
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      const next = PATH_ARITY[token];
      if (next === undefined || taken.length !== 0) {
        return null;
      }
      arity = next;
      continue;
    }
    taken.push(Number(token));
    if (taken.length === arity) {
      // An arc's radii, rotation and flags are not points.
      points.push(...(arity === 7 ? taken.slice(5) : taken));
      taken = [];
    }
  }
  return taken.length === 0 ? boxAround(points) : null;
}

function shapeBox(shape: string, attributes: string): Box | null {
  const at = (name: string): number => numberIn(attributes, name);
  switch (shape) {
    case 'rect':
      return [at('x'), at('y'), at('x') + at('width'), at('y') + at('height')];
    case 'circle':
      return [at('cx') - at('r'), at('cy') - at('r'), at('cx') + at('r'), at('cy') + at('r')];
    case 'ellipse':
      return [at('cx') - at('rx'), at('cy') - at('ry'), at('cx') + at('rx'), at('cy') + at('ry')];
    case 'polygon':
      return boxAround((/\spoints="([^"]*)"/.exec(attributes)?.[1]?.match(/-?[\d.]+/g) ?? []).map(Number));
    default:
      return pathBox(/\sd="([^"]*)"/.exec(attributes)?.[1] ?? '');
  }
}

/** About the middle of a text: half an em a character lands inside the shape it is written in. */
function middleOf(attributes: string, content: string): [number, number] {
  const size = numberIn(attributes, 'font-size') || 14;
  const x = numberIn(attributes, 'x');
  const y = numberIn(attributes, 'y');
  const half = (content.length * size) / 4;
  const anchor = /\stext-anchor="(middle|end)"/.exec(attributes)?.[1];
  const across = anchor === 'middle' ? x : anchor === 'end' ? x - half : x + half;
  return [across, /\sdominant-baseline="central"/.test(attributes) ? y : y - size * 0.3];
}

/** A shape a drawing paints: where, and its fill (null for a gradient). */
interface Painted {
  box: Box;
  fill: string | null;
}

/** The fill of the last shape painted over a point, or `backdrop` when none is. */
function fillUnder(painted: readonly Painted[], [x, y]: [number, number], backdrop: string): string | null {
  for (let index = painted.length - 1; index >= 0; index--) {
    const shape = painted[index];
    if (shape !== undefined && shape.box[0] <= x && x <= shape.box[2] && shape.box[1] <= y && y <= shape.box[3]) {
      return shape.fill;
    }
  }
  return backdrop;
}

/**
 * The contrast of the text hardest to read in a drawing, against the last
 * shape painted under it, or else what the drawing sits on. A text on a
 * gradient is not measured. Undefined when no text is.
 */
export function weakestTextContrast(svg: string, dark: boolean): number | undefined {
  const backdrop = backdropOf(svg, dark);
  const painted: Painted[] = [];
  let weakest: number | undefined;
  for (const [, shape, shapeAttributes = '', attributes = '', content = ''] of svg.matchAll(DRAWN)) {
    if (shape !== undefined) {
      const fill = fillOf(shapeAttributes);
      const box = fill === 'none' ? null : shapeBox(shape, shapeAttributes);
      if (box !== null) {
        painted.push({ box, fill });
      }
      continue;
    }
    const fill = fillOf(attributes);
    if (fill === null || fill === 'none' || content.trim() === '') {
      continue;
    }
    const behind = fillUnder(painted, middleOf(attributes, content), backdrop);
    if (behind !== null) {
      const measured = contrast(fill, behind);
      weakest = weakest === undefined ? measured : Math.min(weakest, measured);
    }
  }
  return weakest;
}

/**
 * The palette to draw in: the one asked for, unless text is hard to read
 * in it and easier in the other.
 */
export function choosePalette(dark: boolean, measured: LabelContrast): boolean {
  const asked = dark ? measured.dark : measured.light;
  const other = dark ? measured.light : measured.dark;
  return asked < MIN_TEXT_CONTRAST && other > asked ? !dark : dark;
}

/**
 * Measures each set of `!theme` lines once — two renders — and remembers
 * the answer for every diagram that uses the same lines.
 */
export class ThemePalettes {
  private readonly measured = new Map<string, Promise<LabelContrast | undefined>>();

  constructor(private readonly render: (source: string, dark: boolean) => Promise<string>) {}

  /**
   * The palette to draw `source` in when `dark` is asked for, taking in what
   * the files it included set, once a drawing has told.
   */
  async resolve(source: string, dark: boolean, included?: IncludedStyle): Promise<boolean> {
    const lines = paletteLines(source, included);
    if (lines.length === 0) {
      return includesWhitePageLibrary(source) || included?.whitePageLibrary === true ? false : dark;
    }
    const measured = await this.measure(lines.join('\n'), lines);
    return measured === undefined ? dark : choosePalette(dark, measured);
  }

  private measure(key: string, lines: readonly string[]): Promise<LabelContrast | undefined> {
    const known = this.measured.get(key);
    if (known !== undefined) {
      return known;
    }
    const pending = this.probe(key, lines);
    this.measured.set(key, pending);
    // Typing a theme name measures every prefix of it on the way.
    if (this.measured.size > MAX_MEASUREMENTS) {
      const oldest = this.measured.keys().next().value;
      if (oldest !== undefined) {
        this.measured.delete(oldest);
      }
    }
    return pending;
  }

  private async probe(key: string, lines: readonly string[]): Promise<LabelContrast | undefined> {
    const source = probeSource(lines);
    try {
      const light = labelContrast(await this.render(source, false), false);
      const dark = labelContrast(await this.render(source, true), true);
      return light === undefined || dark === undefined ? undefined : { light, dark };
    } catch {
      // A render that did not finish (a timeout, a restarting worker)
      // says nothing about the theme: measure again next time.
      this.measured.delete(key);
      return undefined;
    }
  }
}
