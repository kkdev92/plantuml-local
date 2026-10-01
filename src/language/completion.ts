/**
 * What to suggest while a diagram is typed: `@start…` and `@end…` lines,
 * preprocessor directives, the bundled themes after `!theme` and the
 * OpenIconic names after `<&`. Only what the bundled engine has is offered:
 * no diagram type it cannot draw, no directive it ignores, no theme or icon
 * it does not ship.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * caller finds the line, and whether it lies in a diagram.
 */

import { END, START, forEachCodeLine } from '../core/shape';
import { SUPPORTED_DIAGRAMS } from '../grammar/plantuml';

/**
 * The directives offered after `!`. Left out: `!includeurl`, since URLs
 * are refused, and `!includedef`, `!includesub`, `!import`, `!startsub` and
 * `!endsub`, which the bundled engine does not act on.
 */
export const DIRECTIVES: readonly string[] = [
  'include',
  'include_once',
  'include_many',
  'theme',
  'define',
  'definelong',
  'enddefinelong',
  'undef',
  'if',
  'ifdef',
  'ifndef',
  'elseif',
  'else',
  'endif',
  'while',
  'endwhile',
  'foreach',
  'endfor',
  'function',
  'endfunction',
  'procedure',
  'endprocedure',
  'return',
  'unquoted',
  'final',
  'local',
  'global',
  'assert',
  'log',
  'dump_memory',
  'option',
];

/** The names that come from the bundled engine's files. */
export interface CompletionData {
  themes: readonly string[];
  icons: readonly string[];
}

/** One suggestion: what the list shows and what replaces the typed token. */
export interface Suggestion {
  label: string;
  insert: string;
}

/** The suggestions at a position, replacing the token from `start` to `end`. */
export interface Suggestions {
  items: readonly Suggestion[];
  /** Language keywords (`@start…`, directives) or names (themes, icons). */
  kind: 'keyword' | 'name';
  /** Columns of the line: where the typed token begins and ends. */
  start: number;
  end: number;
}

/**
 * Whether the line is a diagram line at all, and the diagram open at it.
 * `line` counts from 0 in `source`; null when it is a comment. `open` is
 * the kind of the diagram the line lies in (`uml`, `mindmap`…), or null
 * outside one.
 */
export function lineContext(source: string, line: number): { open: string | null } | null {
  let open: string | null = null;
  let code = false;
  forEachCodeLine(source, (text, index) => {
    if (index === line) {
      code = true;
    } else if (index < line) {
      const start = START.exec(text);
      if (start !== null) {
        open = start[2] ?? null;
      } else if (END.test(text)) {
        open = null;
      }
    }
  });
  return code ? { open } : null;
}

/**
 * Whether a line up to the cursor could get a suggestion at all: decided
 * from the line alone, before the document is read.
 */
export function mightSuggest(before: string): boolean {
  return /(?:^[\s>]*[@!][\w-]*(?:\s+[\w-]*)?|<&[\w-]*)$/.test(before);
}

const names = (values: readonly string[]): Suggestion[] =>
  values.map((value) => ({ label: value, insert: value }));

/**
 * The suggestions for a line split at the cursor into `before` and `after`,
 * in a diagram of the kind `open` (null outside one), or null when there is
 * nothing to suggest there.
 */
export function suggest(
  before: string,
  after: string,
  open: string | null,
  data: CompletionData
): Suggestions | null {
  const rest = /^[\w-]*/.exec(after)?.[0] ?? '';
  const end = before.length + rest.length;

  // `@start…` outside a diagram, the diagram's own `@end…` inside one.
  if (/^\s*@\w*$/.test(before)) {
    const kinds = SUPPORTED_DIAGRAMS.flatMap((kind) => kind.names);
    const lines = open === null ? kinds.map((kind) => `@start${kind}`) : [`@end${open}`];
    return { items: names(lines), kind: 'keyword', start: before.lastIndexOf('@'), end };
  }

  const theme = /^\s*!theme\s+([\w-]*)$/.exec(before);
  if (theme !== null) {
    return {
      items: names(data.themes),
      kind: 'name',
      start: before.length - (theme[1] ?? '').length,
      end,
    };
  }

  if (/^\s*!\w*$/.test(before)) {
    return {
      items: names(DIRECTIVES.map((name) => `!${name}`)),
      kind: 'keyword',
      start: before.lastIndexOf('!'),
      end,
    };
  }

  // Icons may sit in labels and strings too; the closing `>` is added
  // unless it is already there.
  const icon = /<&([\w-]*)$/.exec(before);
  if (icon !== null) {
    const close = after.slice(rest.length).startsWith('>') ? '' : '>';
    return {
      items: data.icons.map((name) => ({ label: name, insert: `${name}${close}` })),
      kind: 'name',
      start: before.length - (icon[1] ?? '').length,
      end,
    };
  }

  return null;
}

/**
 * The theme names in the bundled `themes.cjs` and the icon names in
 * `openiconic.cjs`, as the build writes and copies them.
 */
export function readCompletionData(themesScript: string, iconsScript: string): CompletionData {
  const keys = (script: string, table: string): string[] =>
    [...script.matchAll(new RegExp(`${table}\\[("[^"\\\\]*")\\]\\s*=`, 'g'))].map(
      (match) => JSON.parse(match[1] ?? '""') as string
    );
  return {
    themes: keys(themesScript, 'PLANTUML_THEMES'),
    icons: keys(iconsScript, 'PLANTUML_OPENICONIC'),
  };
}
