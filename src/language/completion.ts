/**
 * What to suggest while a diagram is typed: `@start…` and `@end…` lines,
 * preprocessor directives, the bundled themes after `!theme` and the
 * OpenIconic names after `<&`. Only what the bundled engine has is offered:
 * no diagram type it cannot draw, no directive it ignores, no theme or icon
 * it does not ship. Elsewhere in a diagram: the aliases it declares, its
 * words, and the snippets of its type where that type can be told.
 *
 * Like the exporter, this has no dependency on the `vscode` module: the
 * caller finds the line, and whether it lies in a diagram.
 */

import { splitLines } from '../core/lines';
import { DATA, END, START, forEachCodeLine } from '../core/shape';
import { SUPPORTED_DIAGRAMS } from '../grammar/plantuml';
import { diagramKind, inBodies, type DiagramKind } from './diagram-kind';
import { protect, protectedAt } from './protected';
import { aliasesOf, wordAt, wordsOf } from './words';

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
  {
    kind: 'object',
    diagram: [
      '@startuml',
      'object "${2:Order}" as order {',
      '  id = ${3:42}',
      '  status = ${4:paid}',
      '}',
      'object "${5:Customer}" as customer {',
      '  name = ${6:Alice}',
      '}',
      'customer -- order',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'er',
    diagram: [
      '@startuml',
      'entity "${2:Customer}" as customer {',
      '  *id : number <<generated>>',
      '  --',
      '  name : text',
      '}',
      'entity "${3:Order}" as order {',
      '  *id : number <<generated>>',
      '  --',
      '  *customer_id : number <<FK>>',
      '  placed : date',
      '}',
      'customer ||--o{ order',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'deployment',
    diagram: [
      '@startuml',
      'cloud "${2:Internet}" as net',
      'node "${3:Web server}" as web {',
      '  component [${4:App}] as app',
      '}',
      'database "${5:Database}" as db',
      'net --> web',
      'app --> db',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'timing',
    diagram: [
      '@startuml',
      'concise "${2:User}" as user',
      'robust "${3:Service}" as service',
      '@0',
      'user is ${4:Idle}',
      'service is ${5:Waiting}',
      '@100',
      'user is ${6:Requesting}',
      'service is ${7:Processing}',
      '@300',
      'user is ${4:Idle}',
      'service is ${5:Waiting}',
      '@enduml',
    ].join('\n'),
  },
  {
    kind: 'gantt',
    diagram: [
      '@startgantt',
      'Project starts ${2:2026-01-05}',
      '[${3:Design}] lasts ${4:5} days',
      '[${5:Build}] lasts ${6:10} days',
      '[${5:Build}] starts at [${3:Design}]\'s end',
      '@endgantt',
    ].join('\n'),
  },
  {
    kind: 'mindmap',
    diagram: [
      '@startmindmap',
      '* ${2:Project}',
      '** ${3:Goals}',
      '*** ${4:Ship on time}',
      '** ${5:Risks}',
      '*** ${6:Scope creep}',
      '@endmindmap',
    ].join('\n'),
  },
  {
    kind: 'wbs',
    diagram: [
      '@startwbs',
      '* ${2:Release}',
      '** ${3:Plan}',
      '*** ${4:Scope}',
      '** ${5:Build}',
      '*** ${6:Implement}',
      '*** ${7:Test}',
      '@endwbs',
    ].join('\n'),
  },
  {
    kind: 'salt',
    diagram: [
      '@startsalt',
      '{+',
      '  ${2:Name} | "${3:Alice}     "',
      '  [${4:OK}] | [${5:Cancel}]',
      '}',
      '@endsalt',
    ].join('\n'),
  },
  {
    kind: 'json',
    diagram: [
      '@startjson',
      '{',
      '  "${2:name}": "${3:value}",',
      '  "${4:items}": [1, 2, 3]',
      '}',
      '@endjson',
    ].join('\n'),
  },
  {
    kind: 'yaml',
    diagram: [
      '@startyaml',
      '${2:name}: ${3:value}',
      '${4:items}:',
      '  - ${5:first}',
      '  - ${6:second}',
      '@endyaml',
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

/** A snippet of syntax: what the list shows, and the text it inserts in snippet syntax. */
export interface Snippet {
  label: string;
  body: string;
}

/**
 * The snippets of each diagram type that can be told from its lines
 * (src/language/diagram-kind.ts): the groups of a sequence diagram and the
 * control flow of an activity diagram. Each draws as it is inserted, with
 * its placeholders at their defaults, in a diagram of its type only
 * (test/integration/worker.test.ts draws each with the bundled engine).
 */
export const SNIPPETS: Readonly<Record<DiagramKind, readonly Snippet[]>> = {
  sequence: [
    { label: 'alt', body: 'alt ${1:condition}\n  $2\nelse ${3:otherwise}\n  $4\nend' },
    { label: 'opt', body: 'opt ${1:condition}\n  $2\nend' },
    { label: 'loop', body: 'loop ${1:condition}\n  $2\nend' },
    { label: 'par', body: 'par ${1:first}\n  $2\nelse ${3:second}\n  $4\nend' },
    { label: 'ref', body: 'ref over ${1:participant}\n  ${2:reference}\nend ref' },
    { label: 'note', body: 'note ${1|over,left of,right of|} ${2:participant}\n  ${3:text}\nend note' },
  ],
  activity: [
    { label: 'if', body: 'if (${1:condition}) then (${2:yes})\n  $3\nelse (${4:no})\n  $5\nendif' },
    { label: 'while', body: 'while (${1:condition}) is (${2:yes})\n  $3\nendwhile (${4:no})' },
    { label: 'repeat', body: 'repeat\n  $1\nrepeat while (${2:condition}) is (${3:yes}) not (${4:no})' },
    { label: 'fork', body: 'fork\n  $1\nfork again\n  $2\nend fork' },
  ],
};

/** A snippet's text with each placeholder at its default: its text, its first choice, or nothing. */
export function expandSnippet(body: string): string {
  return body.replace(
    /\$\{\d+:([^}]*)\}|\$\{\d+\|([^,|]*)[^}]*\}|\$\d+/g,
    (_placeholder, text?: string, choice?: string) => text ?? choice ?? ''
  );
}

/** What the list offers at a position in a diagram where nothing else is offered. */
export interface NameSuggestions {
  /** The aliases the diagram declares, each with the name it stands for. */
  aliases: readonly { name: string; display: string }[];
  /** The diagram's other words. */
  words: readonly string[];
  /** The snippets of the diagram's type, on a line of their own. */
  snippets: readonly Snippet[];
  /** Columns of the line: where the word at the cursor begins and ends. */
  start: number;
  end: number;
  /** The indentation of the line, which the lines of a snippet after its first go on with. */
  lead: string;
}

/**
 * The diagram line `line` of `source` lies in: its lines after the start
 * line, from `from` up to `to`, the kind its start line names, and whether
 * it is data. Null on a start or end line, and outside a diagram. With
 * `bare`, a source without a start line is one diagram, as the engine draws
 * a Markdown block without one.
 */
export function diagramAt(
  source: string,
  line: number,
  bare: boolean
): { from: number; to: number; open: string; data: boolean } | null {
  const bounds: { index: number; start: RegExpExecArray | null; text: string }[] = [];
  forEachCodeLine(source, (text, index) => {
    const start = START.exec(text);
    if (start !== null || END.test(text)) {
      bounds.push({ index, start, text });
    }
  });
  const last = bounds.filter(({ index }) => index <= line).at(-1);
  const to = bounds.find(({ index }) => index > line)?.index ?? splitLines(source).length;
  if (last === undefined) {
    return bare && bounds.every(({ start }) => start === null) ? { from: 0, to, open: 'uml', data: false } : null;
  }
  if (last.index === line || last.start === null) {
    return null;
  }
  return { from: last.index + 1, to, open: last.start[2] ?? 'uml', data: DATA.test(last.text) };
}

/**
 * The aliases, words and snippets for the cursor at `column` of line `line`
 * of `source`, taken from the diagram the line lies in only; null where
 * there are none, or the cursor is in protected text or on a preprocessor
 * line. `bare` is a Markdown block, which is a diagram without a start
 * line. `words` says when the diagram's words are offered: `always`;
 * `beside` aliases or snippets only, so that there is nothing to offer
 * where the words are all there would be; or `never`.
 */
export function suggestNames(
  source: string,
  line: number,
  column: number,
  options: { bare: boolean; words: 'always' | 'beside' | 'never' }
): NameSuggestions | null {
  const diagram = diagramAt(source, line, options.bare);
  if (diagram === null) {
    return null;
  }
  const lines = splitLines(source).slice(diagram.from, diagram.to);
  const code = protect(lines, diagram.data);
  const here = line - diagram.from;
  const text = lines[here] ?? '';
  const current = code[here];
  if (current === undefined || protectedAt(current, column) || /^\s*!/.test(text)) {
    return null;
  }

  // As VS Code lists words: without the one at the cursor.
  const typed = wordAt(text, column);
  const declared = aliasesOf(lines, code);
  const names = new Set(declared.map(({ name }) => name));
  const aliases = declared.filter(({ name }) => name !== typed.word);
  const words =
    options.words === 'never' ? [] : wordsOf(code).filter((word) => word !== typed.word && !names.has(word));

  const alone = text.slice(0, typed.start).trim() === '' && text.slice(typed.end).trim() === '';
  const kind = diagram.open === 'uml' && alone && inBodies(code)[here] === false ? diagramKind(code, here) : null;
  const snippets = kind === null ? [] : SNIPPETS[kind];

  if (aliases.length === 0 && snippets.length === 0 && (options.words !== 'always' || words.length === 0)) {
    return null;
  }
  return { aliases, words, snippets, start: typed.start, end: typed.end, lead: /^\s*/.exec(text)?.[0] ?? '' };
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
