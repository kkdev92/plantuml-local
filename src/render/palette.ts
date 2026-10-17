import { DIAGRAM_BACKDROP } from '../core/constants';
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
 * A `!theme`, or the Azure library, can also come from a file the diagram
 * includes, which is known only once the diagram is drawn. The diagram is
 * drawn in the palette its own lines choose; if what it included turns the
 * choice, it is drawn once more in the other palette, and that drawing is
 * taken as it is ({@link drawReadable}).
 */

/** The probe's message, found again in the rendered SVG. */
const PROBE_LABEL = 'plantumlLocalProbe';

/** WCAG's minimum contrast for text (level AA). */
export const MIN_TEXT_CONTRAST = 4.5;

/**
 * An include of the bundled Azure library. It paints its elements white and
 * leaves their text to the palette, which the dark one makes white: white on
 * white. A diagram that includes it and picks no theme is drawn in the light
 * palette, as one whose theme is made for a white page is. A theme sets the
 * text colour itself, the same in either palette, so a diagram with one is
 * measured like any other.
 */
const AZURE_INCLUDE = /^[ \t]*!include(?:_many|_once)?[ \t]*<azure\//m;

/** Whether `text` includes the bundled Azure library. */
export function includesAzure(text: string): boolean {
  return AZURE_INCLUDE.test(text);
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
  return source
    .split(/\r?\n/)
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
  const lines = source.split(/\r?\n/);
  const before = at < 0 ? lines : lines.slice(0, at);
  const after = at < 0 ? [] : lines.slice(at);
  return [...own(before), ...included.themes.filter((line) => !fromFolder(line)), ...own(after)];
}

/**
 * Draws a diagram in the palette its themes can be read in: the one chosen
 * from its own lines first, then — when the files it included turn that
 * choice — once more in the other, which is taken as it is.
 */
export async function drawReadable(
  source: string,
  dark: boolean,
  resolve: (source: string, dark: boolean, included?: IncludedStyle) => Promise<boolean>,
  draw: (palette: boolean) => Promise<DiagramRender>
): Promise<{ result: DiagramRender; palette: boolean }> {
  const palette = await resolve(source, dark);
  const result = await draw(palette);
  if (result.includedStyle === undefined) {
    return { result, palette };
  }
  const again = await resolve(source, dark, result.includedStyle);
  return again === palette ? { result, palette } : { result: await draw(again), palette: again };
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
  const painted = /<svg\b[^>]*\bstyle="[^"]*background-color:\s*(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?/.exec(svg);
  const behind =
    painted?.[1] !== undefined && painted[2] !== '00'
      ? painted[1]
      : DIAGRAM_BACKDROP[dark ? 'dark' : 'light'];
  return contrast(label, behind);
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
      return includesAzure(source) || included?.azure === true ? false : dark;
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
