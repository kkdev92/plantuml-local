/**
 * Recognises the diagrams the engine draws in place of a diagram it could
 * not render.
 *
 * Most failures — a syntax error, an include that cannot be resolved, an
 * empty diagram, a source without `@startuml` — do not reach
 * `renderToString`'s error callback. The engine draws a diagram that
 * describes the problem and passes that to the success callback instead.
 * The preview shows it as it is, which is what someone fixing the source
 * wants to see; an export must not save it as the diagram.
 *
 * The engine returns nothing structured, so the drawings are told apart by
 * their layout, one rule per layout the bundled engine produces. Matching
 * on the words "error" or "Error" alone would misfire on diagrams that are
 * about errors, so each rule also checks the shape around the words.
 * test/integration/grammar-cases.test.ts runs every rule against every
 * grammar case the engine renders, and an engine update that changes a
 * layout fails there rather than letting its errors through as diagrams.
 */

/** What the engine drew instead of the diagram. */
export interface EngineError {
  /** The engine's own description of the problem. */
  message: string;
  /**
   * The line of the rendered source the engine blames, counting from 1.
   * Null when it names none, or names a line of an included library
   * rather than of the source itself (the message then says which).
   */
  line: number | null;
}

interface TextElement {
  attributes: string;
  content: string;
}

/** Elements that draw something. A lone message is drawn without any. */
const SHAPE = /<(?:rect|path|line|polyline|polygon|ellipse|circle|image)\b/;

/** `[From textarea (line 3) ]`: where a located error happened. */
const LOCATION = /^\[From (.+) \(line (\d+)\) \]$/;

/** The only text of the drawings some diagram types make for bad input. */
const LONE_MESSAGES = [/^Your data does not sound like \S+ data$/, /^Syntax error!$/];

const NOT_SUPPORTED = 'Diagram not supported by this release of PlantUML';
const DIRECTIVE_INTRO = 'Sorry, but the following directive ';

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function textElements(svg: string): TextElement[] {
  return [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((match) => ({
    attributes: match[1] ?? '',
    content: decode(match[2] ?? ''),
  }));
}

/**
 * The error layout for syntax errors, failed includes, missing themes and
 * the like: an italic version banner, then `[From <origin> (line N) ]`,
 * the offending lines, and the message in red at the foot.
 */
function locatedError(texts: readonly TextElement[]): EngineError | null {
  const [banner, location] = texts;
  if (
    banner === undefined ||
    location === undefined ||
    !banner.content.startsWith('PlantUML version ') ||
    !/\bfont-style="italic"/.test(banner.attributes)
  ) {
    return null;
  }
  const where = LOCATION.exec(location.content);
  if (where === null) {
    return null;
  }

  const red = texts.filter((text) => /\bfill="#FF0000"/i.test(text.attributes)).at(-1);
  const message = (red ?? texts.at(-1) ?? location).content.trim();
  const origin = where[1] ?? '';
  const line = Number(where[2]);
  // `textarea` is the source that was rendered. Anything else is a library
  // it included (`<azure/…>`), whose lines are not the source's.
  return origin === 'textarea'
    ? { message, line }
    : { message: `${message} (${origin}, line ${String(line)})`, line: null };
}

/**
 * The layout for a source the engine cannot place in any diagram type:
 * no `@start…` line, or text before it.
 */
function notSupported(texts: readonly TextElement[]): EngineError | null {
  if (texts[0]?.content !== NOT_SUPPORTED) {
    return null;
  }
  const intro = texts.findIndex((text) => text.content === DIRECTIVE_INTRO);
  if (intro === -1) {
    return null;
  }
  const directive = texts[intro + 1]?.content.trim() ?? '';
  const recognised = directive !== '' && !directive.startsWith('is not recognized');
  return {
    message: recognised ? `${NOT_SUPPORTED}: "${directive}" is not recognized` : NOT_SUPPORTED,
    line: null,
  };
}

/**
 * The drawing some diagram types make for input they cannot read: one line
 * of text and nothing else (`Syntax error!` for EBNF, `Your data does not
 * sound like JSON data` for JSON).
 */
function loneMessage(svg: string, texts: readonly TextElement[]): EngineError | null {
  const [only] = texts;
  if (texts.length !== 1 || only === undefined || SHAPE.test(svg)) {
    return null;
  }
  const message = only.content.trim();
  return LONE_MESSAGES.some((pattern) => pattern.test(message)) ? { message, line: null } : null;
}

/**
 * The error the engine drew instead of a diagram, or null when `svg` is a
 * diagram. Pass the engine's output as it came back, before anything is
 * added to it: an exported background would count as a shape.
 */
export function recognizeEngineError(svg: string): EngineError | null {
  const texts = textElements(svg);
  return locatedError(texts) ?? notSupported(texts) ?? loneMessage(svg, texts);
}

/**
 * The banner the engine draws above a diagram it accepted with warnings
 * (DiagramChromeFactory upstream), in the light and in the dark palette.
 */
const WARNING_BANNER = /<rect\b[^>]*\bfill="#(?:FFFFCC|774400)"[^>]*\bstroke="#(?:FFDD88|AA5500)"[^>]*\bstroke-width="3"/i;

/**
 * The warnings the engine drew above a diagram: one line of 10-point
 * monospace text per message in the banner, which names no line of the
 * source. Empty when there is no banner.
 */
export function recognizeEngineWarnings(svg: string): string[] {
  if (!WARNING_BANNER.test(svg)) {
    return [];
  }
  return textElements(svg)
    .filter((text) => /\bfont-size="10"/.test(text.attributes) && /\bfont-family="monospace"/.test(text.attributes))
    .map((text) => text.content.trim())
    .filter((message) => message !== '');
}
