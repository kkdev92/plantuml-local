/**
 * Building blocks for the TextMate grammars in this folder.
 *
 * The grammars are written as TypeScript so that repeated fragments (the
 * whitespace class, keyword lists, the arrow syntax) are composed instead
 * of copied. The build evaluates src/grammar/index.ts and writes plain
 * JSON into dist/syntaxes/, which is what VS Code reads.
 *
 * Patterns are Oniguruma regular expressions. They are written with
 * String.raw so that a backslash in the source is a backslash in the
 * pattern.
 */

export interface Rule {
  name?: string;
  contentName?: string;
  match?: string;
  begin?: string;
  end?: string;
  while?: string;
  captures?: Captures;
  beginCaptures?: Captures;
  endCaptures?: Captures;
  whileCaptures?: Captures;
  patterns?: Rule[];
  include?: string;
  applyEndPatternLast?: boolean;
}

export type Captures = Record<string, Rule>;

export interface Grammar {
  scopeName: string;
  name?: string;
  injectionSelector?: string;
  injections?: Record<string, Rule>;
  patterns: Rule[];
  repository: Record<string, Rule>;
}

export const re = String.raw;

/** Merges repositories; a name defined twice is a mistake, not an override. */
export function merge(...parts: Record<string, Rule>[]): Record<string, Rule> {
  const result: Record<string, Rule> = {};
  for (const part of parts) {
    for (const [name, rule] of Object.entries(part)) {
      if (name in result) {
        throw new Error(`grammar repository entry defined twice: ${name}`);
      }
      result[name] = rule;
    }
  }
  return result;
}

/** Scope name with the language suffix every token of this grammar carries. */
export function scope(name: string): string {
  return name
    .split(' ')
    .map((part) => `${part}.plantuml`)
    .join(' ');
}

/** `{ name }` for a capture group. */
export function named(name: string): Rule {
  return { name: scope(name) };
}

/** `{ patterns: [includes] }` for a capture group whose text needs further rules. */
export function nested(...includes: string[]): Rule {
  return { patterns: includes.map((include) => ({ include })) };
}

export function include(name: string): Rule {
  return { include: name.startsWith('#') || name.includes('.') ? name : `#${name}` };
}

/**
 * Start of a line: any position with only blanks and `>` before it, or
 * `\G`, where an enclosing rule handed over the rest of the line (after a
 * block comment that opens the line).
 *
 * `^` alone is not enough. Inside a block quote or a list item, VS Code's
 * Markdown grammar has already consumed the `> ` or the indentation, and
 * after a rule carried over from an earlier line ends, `\G` no longer
 * points there either, so every line rule would miss the line.
 *
 * The look-behind is tried at every position of every line, so it has to
 * fail fast: one character first (almost every position is preceded by
 * something else), then at most 32 characters back to the line start. An
 * unbounded look-behind made a 10 000-character line take seconds.
 */
export const BOL = re`(?:\G|(?<![^\s>])(?<=^[\s>]{0,32}))`;

/**
 * PlantUML treats the no-break space as whitespace in every command
 * (`%s` in its patterns expands to `\s\u00A0`).
 */
export const SP = '[\\s\u00A0]';

/**
 * A preprocessor name: a letter, underscore or supplementary-plane
 * character, then those or ASCII digits (TLineType upstream).
 */
export const IDENT = re`[\p{L}_\x{10000}-\x{10FFFF}][\p{L}0-9_\x{10000}-\x{10FFFF}]*`;

/** Straight and curly double quotes (`%g` upstream). */
export const DQ = '["\u201C\u201D]';
export const NOT_DQ = '[^"\u201C\u201D]';

/**
 * End of a line's content: before a block comment that closes the line
 * (the preprocessor drops it), or the end of the line. Rules that take
 * "the rest of the line" stop here and let `comment-inline` take the
 * comment.
 */
export const EOL = re`(?=${SP}*(?:/'(?:(?!/').)*'/${SP}*)?$)`;

/**
 * Lines that end a diagram (`@end…` or `\end…`) also end every multi-line
 * construct inside it, so an unclosed note cannot swallow the rest of the
 * fence.
 */
export const DIAGRAM_END_AHEAD = re`(?=${BOL}\s*[@\\]end)`;

/** End pattern for multi-line constructs: their own end, or the diagram's. */
export function endOr(pattern: string): string {
  return `${pattern}|${DIAGRAM_END_AHEAD}`;
}

/**
 * `\s` the way the engine reads it. PlantUML's patterns are Java regular
 * expressions, where `\s` is ASCII whitespace, and its `%s` adds only the
 * no-break space (see SP); the engine trims nothing else from a line
 * either. Oniguruma's `\s` also takes Unicode spaces, so a line written
 * with an ideographic space (U+3000), which the engine rejects, would be
 * coloured as if it were fine. `(?S)` in front of every pattern makes `\s`
 * ASCII, in character classes and look-behinds too.
 */
export function asciiWhitespace(grammar: Grammar): Grammar {
  const rule = (source: Rule): Rule => {
    const result: Rule = { ...source };
    for (const key of ['match', 'begin', 'end', 'while'] as const) {
      const pattern = source[key];
      if (pattern !== undefined) {
        result[key] = `(?S)${pattern}`;
      }
    }
    if (source.patterns !== undefined) {
      result.patterns = source.patterns.map(rule);
    }
    for (const key of ['captures', 'beginCaptures', 'endCaptures', 'whileCaptures'] as const) {
      const captures = source[key];
      if (captures !== undefined) {
        result[key] = Object.fromEntries(Object.entries(captures).map(([n, capture]) => [n, rule(capture)]));
      }
    }
    return result;
  };
  const rules = (entries: Record<string, Rule>): Record<string, Rule> =>
    Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, rule(entry)]));
  return {
    ...grammar,
    patterns: grammar.patterns.map(rule),
    repository: rules(grammar.repository),
    ...(grammar.injections === undefined ? {} : { injections: rules(grammar.injections) }),
  };
}
