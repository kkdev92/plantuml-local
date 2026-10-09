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
 * are refused, and `!includedef` and `!import`, which the bundled engine
 * does not act on.
 */
export const DIRECTIVES: readonly string[] = [
  'include',
  'include_once',
  'include_many',
  'includesub',
  'startsub',
  'endsub',
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

/**
 * The diagram templates, offered as `puml-<kind>` where a whole diagram can
 * start. Each draws as it is; the names in it are snippet placeholders to
 * tab through.
 */
export const TEMPLATES: readonly { kind: string; diagram: string }[] = [
  {
    kind: 'sequence',
    diagram: [
      '@startuml',
      'actor ${2:User} as user',
      'participant "${3:Service}" as service',
      'database "${4:Database}" as db',
      'user -> service : ${5:request}',
      'activate service',
      'service -> db : query',
      'db --> service : rows',
      'service --> user : response',
      'deactivate service',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'class',
    diagram: [
      '@startuml',
      'interface ${2:Repository} {',
      '  +find(id: String): ${3:Order}',
      '}',
      'class ${3:Order} {',
      '  -id: String',
      '  +total(): Number',
      '}',
      'class ${4:OrderLine} {',
      '  -quantity: Integer',
      '}',
      '${3:Order} "1" *-- "many" ${4:OrderLine}',
      '${2:Repository} <|.. ${5:OrderStore}',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'activity',
    diagram: [
      '@startuml',
      'start',
      ':${2:Receive order};',
      'if (${3:In stock?}) then (yes)',
      '  :${4:Ship order};',
      'else (no)',
      '  :${5:Notify customer};',
      'endif',
      'stop',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'state',
    diagram: [
      '@startuml',
      '[*] --> ${2:Idle}',
      '${2:Idle} --> ${3:Running} : ${4:start}',
      '${3:Running} --> ${2:Idle} : ${5:stop}',
      '${3:Running} --> [*] : ${6:fail}',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'component',
    diagram: [
      '@startuml',
      'package "${2:Application}" {',
      '  component [${3:Web}] as web',
      '  component [${4:API}] as api',
      '}',
      'database "${5:Database}" as db',
      'web --> api',
      'api --> db',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'usecase',
    diagram: [
      '@startuml',
      'left to right direction',
      'actor ${2:Customer} as customer',
      'rectangle "${3:Shop}" {',
      '  usecase "${4:Place order}" as place',
      '  usecase "${5:Track order}" as track',
      '}',
      'customer --> place',
      'customer --> track',
      '@enduml',
    ].join('\n'),
  },
];

/** One suggestion: what the list shows and what replaces the typed token. */
export interface Suggestion {
  label: string;
  insert: string;
  /** Shown beside the label: what a template draws. */
  detail?: string;
}

/** The suggestions at a position, replacing the token from `start` to `end`. */
export interface Suggestions {
  items: readonly Suggestion[];
  /**
   * Language keywords (`@start…`, directives), names (themes, icons), or
   * templates, whose `insert` is a snippet.
   */
  kind: 'keyword' | 'name' | 'template';
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

/** A line holding nothing but the start of a template's name, after its quote markers or indent. */
const TEMPLATE_NAME = /^([\s>]*)p(?:u(?:m(?:l(?:-[\w-]*)?)?)?)?$/;

/**
 * Whether a line up to the cursor could get a suggestion at all: decided
 * from the line alone, before the document is read.
 */
export function mightSuggest(before: string): boolean {
  return /(?:^[\s>]*[@!][\w-]*(?:\s+[\w-]*)?|<&[\w-]*)$/.test(before) || TEMPLATE_NAME.test(before);
}

/**
 * The templates for a line holding nothing but the start of a template's
 * name: the bare diagram, or with `fence`, the diagram in a ` ```plantuml `
 * block named `<kind>-diagram`, for the text of a Markdown document. Each
 * line after the first repeats what precedes the name on its line, so a
 * template in a quote stays in the quote. `names` gives what each kind is
 * shown as.
 */
export function suggestTemplates(
  before: string,
  after: string,
  fence: boolean,
  names: Readonly<Record<string, string>>
): Suggestions | null {
  const typed = TEMPLATE_NAME.exec(before);
  if (typed === null || after.trim() !== '') {
    return null;
  }
  const lead = typed[1] ?? '';
  return {
    items: TEMPLATES.map(({ kind, diagram }) => ({
      label: `puml-${kind}`,
      detail: names[kind] ?? kind,
      insert: (fence ? `\`\`\`plantuml \${1:${kind}-diagram}\n${diagram}\n\`\`\`` : diagram).replace(
        /\n/g,
        `\n${lead}`
      ),
    })),
    kind: 'template',
    start: lead.length,
    end: before.length,
  };
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
