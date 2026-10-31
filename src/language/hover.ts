import type { MessageLocalizer } from '../core/messages';
import { START } from '../core/shape';
import { SUPPORTED_DIAGRAMS } from '../grammar/plantuml';
import { DIRECTIVES, type CompletionData } from './completion';
import type { MacroDefinition } from './macro-help';

/**
 * What a hover shows in a diagram: help for what the bundled engine reads
 * alike in every diagram — its preprocessor directives (TLineType and the
 * Eater classes upstream), the kinds of diagram after `@start`
 * (DiagramType), the themes it ships and its OpenIconic icons — and the
 * Markdown that shows text of the documents as it is written.
 *
 * The properties a few rules of a style sheet offer, and four skinparams,
 * get help from src/language/style.ts, which takes the names from the
 * engine and is held to what it draws. Nothing else gets help: not the
 * keywords of a type of diagram, nor the other names of skinparam and
 * style items; nor a directive in another case, such as `!Include`, which
 * the engine refuses. A theme or an icon gets help only as the engine finds
 * it: in its own case, and with no word the text defines, as the engine
 * would put the word's value in its place.
 *
 * The Markdown is meant to be shown untrusted, without HTML. Text of the
 * documents goes in it escaped, each ASCII punctuation character behind a
 * backslash, so that nothing in it is read as a link, an image or HTML; or
 * in a code block whose fence is longer than any run of backticks in it,
 * so that no line of it can close the block.
 *
 * Like the completion, this has no dependency on the `vscode` module: the
 * caller finds the line and gives the words, localised.
 */

/** The version of the bundled engine the help is written for, to be read again when it changes. */
export const HELP_ENGINE = '1.2026.9';

/** How many definitions of a name a hover shows. */
export const HOVER_DEFINITIONS = 10;

/** How much of the comment above a definition a hover shows: lines, then characters. */
export const HOVER_COMMENT = { lines: 20, characters: 2000 };

/** Text shown as it is written: each ASCII punctuation character escaped. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[!-/:-@[-`{-~]/g, (char) => `\\${char}`);
}

/** `text` in a fenced code block that no line of it can close, its language `language` (none when empty). */
export function codeBlock(text: string, language: string): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

/** `text`, one line, in a code span that no run of backticks in it can close. */
export function inlineCode(text: string): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  const ticks = '`'.repeat(longest + 1);
  // A space on each side, which the span drops again, keeps an end that is
  // a backtick from joining the run around it, and an end that is a space
  // from being dropped (a span that starts and ends with a space loses one
  // at each end, unless it is all spaces).
  const pad = /^[` ]|[` ]$/.test(text) && /[^ ]/.test(text) ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/**
 * `text` shown as written where it may wrap: each line escaped as
 * {@link escapeMarkdown} escapes it, a line break at each of its own, and
 * each run of spaces or tabs written as that many spaces, all no-break but
 * the first of a run inside the line, where the line can still wrap.
 * Markdown drops the spaces a line starts with, so a run there is all
 * no-break.
 */
export function escapeLines(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      escapeMarkdown(line).replace(/[ \t]+/g, (run: string, at: number) =>
        at === 0 ? '&nbsp;'.repeat(run.length) : ` ${'&nbsp;'.repeat(run.length - 1)}`
      )
    )
    .join('\\\n');
}

/** What a hover gives built-in help for, and its columns in its line. */
export interface BuiltinTarget {
  kind: 'directive' | 'diagram' | 'theme' | 'icon';
  /** The directive without its `!`, the kind of diagram as the list of supported diagrams names it, the theme or the icon. */
  name: string;
  start: number;
  end: number;
}

/** A directive at the start of a line, as the engine reads one: `!`, then its name, in lower case. */
const DIRECTIVE = /^([ \t]*!)([a-z_]+)(?![A-Za-z0-9_])/;
/** `!procedure` or `!function`, after the words that may come before it, each followed by one white space character. */
const DECLARATION = /^([ \t]*!)((?:(?:unquoted|final)[ \t])*)(procedure|function)(?![A-Za-z0-9_])/;
/** What a function written on one line returns, after its parameters: `!return` or `return`. */
const RETURNS = /\)[ \t]*(!?return)(?![A-Za-z0-9_])/;
/** A `!theme` line that names a theme alone, read from no folder. */
const THEME = /^([ \t]*!theme[ \t]+)([\w-]+)[ \t]*$/;
/** An OpenIconic icon in text (Splitter.openiconPattern upstream): its colour, its name, and its scale or colour. */
const ICON = /<(#\w+)?&([-\w]+)([{,]?(?:(?:scale=|\*)[0-9.]+)?(?:,?color[= :](?:#[0-9a-fA-F]{1,8}|\w+))?\}?)?>/gi;

/**
 * What the cursor at column `column` of line `text` of a diagram is on
 * that has built-in help, or null. `asWritten` tells whether the engine
 * reads a name of the line as it is written.
 */
export function builtinAt(
  text: string,
  column: number,
  data: CompletionData,
  asWritten: (name: string) => boolean
): BuiltinTarget | null {
  const at = (kind: BuiltinTarget['kind'], name: string, start: number, end: number): BuiltinTarget | null =>
    column >= start && column <= end ? { kind, name, start, end } : null;

  // The engine tells the kind from the start of the name after `@start`, in any case.
  const start = START.exec(text);
  if (start !== null) {
    const written = start[2] ?? '';
    const kind = SUPPORTED_DIAGRAMS.flatMap(({ names }) => names).find((name) => written.toLowerCase().startsWith(name));
    return kind === undefined ? null : at('diagram', kind, start[0].length - written.length - 'start'.length - 1, start[0].length);
  }

  const declaration = DECLARATION.exec(text);
  if (declaration !== null) {
    let from = (declaration[1] ?? '').length;
    for (const word of (declaration[2] ?? '').match(/unquoted|final/g) ?? []) {
      const found = at('directive', word, from === (declaration[1] ?? '').length ? from - 1 : from, from + word.length);
      if (found !== null) {
        return found;
      }
      from += word.length + 1;
    }
    const keyword = declaration[3] ?? '';
    const found = at('directive', keyword, from === (declaration[1] ?? '').length ? from - 1 : from, from + keyword.length);
    if (found !== null) {
      return found;
    }
    const returns = keyword === 'function' ? RETURNS.exec(text.slice(from)) : null;
    if (returns !== null) {
      const word = returns[1] ?? '';
      const end = from + returns.index + returns[0].length;
      const inline = at('directive', 'return', end - word.length, end);
      if (inline !== null) {
        return inline;
      }
    }
  }

  const directive = DIRECTIVE.exec(text);
  if (directive !== null && DIRECTIVES.includes(directive[2] ?? '')) {
    const name = directive[2] ?? '';
    const found = at('directive', name, (directive[1] ?? '').length - 1, (directive[1] ?? '').length + name.length);
    if (found !== null) {
      return found;
    }
  }

  const theme = THEME.exec(text);
  if (theme !== null) {
    const name = theme[2] ?? '';
    const from = (theme[1] ?? '').length;
    if (data.themes.includes(name) && asWritten(name)) {
      const found = at('theme', name, from, from + name.length);
      if (found !== null) {
        return found;
      }
    }
  }

  for (const icon of text.matchAll(ICON)) {
    const name = icon[2] ?? '';
    const found = at('icon', name, icon.index, icon.index + icon[0].length);
    if (found !== null) {
      return data.icons.includes(name) && asWritten(name) ? found : null;
    }
  }
  return null;
}

/** Built-in help: what it is for, what it does, how it is written, and lines that use it. */
export interface Help {
  /** What it is for, as written: `!include`, `@startuml`, a theme or an icon. */
  title: string;
  /** What it does, localised. */
  text: string;
  /** How it is written; for a kind of diagram, a whole diagram, which the bundled engine draws as it is. */
  syntax: string;
  /** Lines of a diagram that use it, which the bundled engine draws as they are, between `@startuml` and `@enduml`. */
  example?: string;
}

/** The lines of a diagram for each directive that has an example: a few go with several directives. */
const EXAMPLES = {
  startsub: ['!startsub PEOPLE', 'actor User', '!endsub', 'User -> System : request'],
  theme: ['!theme cerulean', 'Alice -> Bob : hello'],
  define: ['!define SERVICE Orders', 'component SERVICE'],
  definelong: ['!definelong SERVICE(name)', 'component name', '!enddefinelong', 'SERVICE(Orders)'],
  undef: ['!$mode = "full"', '!undef $mode', '!ifndef $mode', 'Alice -> Bob : no mode', '!endif'],
  if: [
    '!$level = 2',
    '!if $level == 1',
    'Alice -> Bob : first',
    '!elseif $level == 2',
    'Alice -> Bob : second',
    '!else',
    'Alice -> Bob : other',
    '!endif',
  ],
  ifdef: ['!$tests = 1', '!ifdef $tests', 'Alice -> Bob : run the tests', '!endif'],
  ifndef: ['!ifndef $tests', 'Alice -> Bob : no tests', '!endif'],
  while: ['!$step = 1', '!while $step <= 3', 'Alice -> Bob : step $step', '!$step = $step + 1', '!endwhile'],
  foreach: ['!foreach $name in ["Alice", "Bob", "Carol"]', 'participant $name', '!endfor'],
  function: ['!function $double($n)', '!return $n * 2', '!endfunction', 'Alice -> Bob : $double(21)'],
  procedure: ['!procedure $service($name)', 'component $name', '!endprocedure', '$service("Orders")', '$service("Billing")'],
  unquoted: ['!unquoted procedure $service($name)', 'component $name', '!endprocedure', '$service(Orders)'],
  final: ['!final procedure $service($name)', 'component $name', '!endprocedure', '$service("Orders")'],
  local: [
    '!$name = "global"',
    '!procedure $show()',
    '!local $name = "local"',
    'Alice -> Bob : $name',
    '!endprocedure',
    '$show()',
    'Alice -> Bob : $name',
  ],
  global: ['!procedure $count()', '!global $calls = 1', '!endprocedure', '$count()', 'Alice -> Bob : $calls'],
  assert: ['!$version = 2', '!assert $version >= 2 : "version 2 or later is needed"', 'Alice -> Bob : hello'],
  log: ['!log Drawing the diagram', 'Alice -> Bob : hello'],
  dump_memory: ['!$name = "Alice"', '!dump_memory', 'Alice -> Bob : hello'],
  option: ['!option handwritten', 'Alice -> Bob : hello'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

const lines = (example: readonly string[]): string => example.join('\n');

/** The help for directive `name` (without its `!`), or null for one that has none. */
function directiveHelp(name: string, l10n: MessageLocalizer): Omit<Help, 'title'> | null {
  switch (name) {
    case 'include':
      return {
        text: l10n.t(
          'Reads a file in place of this line, unless the same has been read already. Of a file holding diagrams, it reads the first, or the one picked by ! and a number, counting from 0, or an id after the path. <library/file> reads a file of a bundled library.'
        ),
        syntax: lines(['!include file.puml', '!include file.puml!ID', '!include <C4/C4_Context>']),
      };
    case 'include_once':
      return {
        text: l10n.t('Reads a file as !include does, but stops with an error if it has been included already.'),
        syntax: '!include_once file.puml',
      };
    case 'include_many':
      return {
        text: l10n.t('Reads a file as !include does, even if it has been included already.'),
        syntax: '!include_many file.puml',
      };
    case 'includesub':
      return {
        text: l10n.t(
          'Reads the lines between !startsub NAME and !endsub of a file in place of this line; without a file, those of this diagram.'
        ),
        syntax: lines(['!includesub file.puml!NAME', '!includesub NAME']),
      };
    case 'startsub':
      return {
        text: l10n.t(
          'Marks the lines up to !endsub as a section, which !includesub can read by its name. They are drawn here too. A section cannot hold another.'
        ),
        syntax: lines(['!startsub NAME', '…', '!endsub']),
        example: lines(EXAMPLES.startsub),
      };
    case 'endsub':
      return {
        text: l10n.t('Ends the section !startsub started.'),
        syntax: '!endsub',
        example: lines(EXAMPLES.startsub),
      };
    case 'theme':
      return {
        text: l10n.t(
          'Gives the diagram the look of a theme: one bundled with this extension, by its name, or puml-theme-NAME.puml in a folder of the workspace.'
        ),
        syntax: lines(['!theme NAME', '!theme NAME from folder']),
        example: lines(EXAMPLES.theme),
      };
    case 'define':
      return {
        text: l10n.t(
          'Without parameters, sets a variable to the text after its name, which then takes the place of the name. With parameters, defines a macro whose text takes the place of each call.'
        ),
        syntax: lines(['!define NAME text', '!define NAME(a, b) text']),
        example: lines(EXAMPLES.define),
      };
    case 'definelong':
      return {
        text: l10n.t('Starts a macro written over the lines up to !enddefinelong, which take the place of each call.'),
        syntax: lines(['!definelong NAME(a, b)', '…', '!enddefinelong']),
        example: lines(EXAMPLES.definelong),
      };
    case 'enddefinelong':
      return {
        text: l10n.t('Ends the macro !definelong started.'),
        syntax: '!enddefinelong',
        example: lines(EXAMPLES.definelong),
      };
    case 'undef':
      return { text: l10n.t('Removes a variable.'), syntax: '!undef NAME', example: lines(EXAMPLES.undef) };
    case 'if':
      return {
        text: l10n.t('Keeps the lines up to the next !elseif, !else or !endif only if the expression is true.'),
        syntax: lines(['!if expression', '…', '!elseif expression', '…', '!else', '…', '!endif']),
        example: lines(EXAMPLES.if),
      };
    case 'ifdef':
      return {
        text: l10n.t('Keeps the lines up to the next !else or !endif only if a variable or a function of that name exists.'),
        syntax: lines(['!ifdef NAME', '…', '!endif']),
        example: lines(EXAMPLES.ifdef),
      };
    case 'ifndef':
      return {
        text: l10n.t('Keeps the lines up to the next !else or !endif only if no variable or function of that name exists.'),
        syntax: lines(['!ifndef NAME', '…', '!endif']),
        example: lines(EXAMPLES.ifndef),
      };
    case 'elseif':
      return {
        text: l10n.t(
          'Keeps the lines up to the next !elseif, !else or !endif only if the conditions before it are false and its expression is true.'
        ),
        syntax: '!elseif expression',
        example: lines(EXAMPLES.if),
      };
    case 'else':
      return {
        text: l10n.t('Keeps the lines up to !endif only if the conditions before it are false.'),
        syntax: '!else',
        example: lines(EXAMPLES.if),
      };
    case 'endif':
      return { text: l10n.t('Ends !if, !ifdef or !ifndef.'), syntax: '!endif', example: lines(EXAMPLES.if) };
    case 'while':
      return {
        text: l10n.t('Repeats the lines up to !endwhile as long as the expression is true.'),
        syntax: lines(['!while expression', '…', '!endwhile']),
        example: lines(EXAMPLES.while),
      };
    case 'endwhile':
      return { text: l10n.t('Ends the lines !while repeats.'), syntax: '!endwhile', example: lines(EXAMPLES.while) };
    case 'foreach':
      return {
        text: l10n.t(
          'Repeats the lines up to !endfor for each item of a JSON array, or each key of a JSON object, the variable set to it.'
        ),
        syntax: lines(['!foreach $item in expression', '…', '!endfor']),
        example: lines(EXAMPLES.foreach),
      };
    case 'endfor':
      return { text: l10n.t('Ends the lines !foreach repeats.'), syntax: '!endfor', example: lines(EXAMPLES.foreach) };
    case 'function':
      return {
        text: l10n.t(
          'Declares a function: each call is replaced with the value !return gives. Its body ends with !endfunction, unless !return follows its parameters on the same line.'
        ),
        syntax: lines(['!function $name($a, $b = "default")', '!return expression', '!endfunction', '!function $name($a) !return expression']),
        example: lines(EXAMPLES.function),
      };
    case 'endfunction':
      return {
        text: l10n.t('Ends the body of !function.'),
        syntax: '!endfunction',
        example: lines(EXAMPLES.function),
      };
    case 'procedure':
      return {
        text: l10n.t('Declares a procedure: each call is replaced with the lines of its body, up to !endprocedure.'),
        syntax: lines(['!procedure $name($a, $b = "default")', '…', '!endprocedure']),
        example: lines(EXAMPLES.procedure),
      };
    case 'endprocedure':
      return {
        text: l10n.t('Ends the body of !procedure.'),
        syntax: '!endprocedure',
        example: lines(EXAMPLES.procedure),
      };
    case 'return':
      return {
        text: l10n.t('Gives the value of a function, which replaces its call.'),
        syntax: '!return expression',
        example: lines(EXAMPLES.function),
      };
    case 'unquoted':
      return {
        text: l10n.t('Before procedure or function: the arguments of its calls are read as text, so they need no quotes.'),
        syntax: lines(['!unquoted procedure $name($a)', '!unquoted function $name($a)']),
        example: lines(EXAMPLES.unquoted),
      };
    case 'final':
      return {
        text: l10n.t(
          'Before procedure or function: the engine stops with an error if another declaration has the same name and number of parameters, before or after this one.'
        ),
        syntax: lines(['!final procedure $name($a)', '!final function $name($a)']),
        example: lines(EXAMPLES.final),
      };
    case 'local':
      return {
        text: l10n.t(
          'Sets a variable for the procedure or function that runs only, hiding a global variable of the same name. Outside a procedure or function, it is an error.'
        ),
        syntax: '!local $name = value',
        example: lines(EXAMPLES.local),
      };
    case 'global':
      return {
        text: l10n.t('Sets a global variable, even in a procedure or function.'),
        syntax: '!global $name = value',
        example: lines(EXAMPLES.global),
      };
    case 'assert':
      return {
        text: l10n.t('Stops with an error, "Assertion error" and the message, if the expression is false.'),
        syntax: lines(['!assert expression', '!assert expression : "message"']),
        example: lines(EXAMPLES.assert),
      };
    case 'log':
      return {
        text: l10n.t(
          'Writes the text, its variables replaced, to the log of PlantUML. VS Code shows it as an error under Window in the Output panel, not in the output of this extension.'
        ),
        syntax: '!log text',
        example: lines(EXAMPLES.log),
      };
    case 'dump_memory':
      return {
        text: l10n.t(
          'Writes the variables set so far to the log of PlantUML, when it runs with --verbose on the command line. The bundled engine writes nothing.'
        ),
        syntax: '!dump_memory',
        example: lines(EXAMPLES.dump_memory),
      };
    case 'option':
      return {
        text: l10n.t('Sets an option of the engine by its name. A name the engine does not know is ignored.'),
        syntax: '!option NAME value',
        example: lines(EXAMPLES.option),
      };
    default:
      return null;
  }
}

/** The lines between the start and end lines of a minimal diagram of each kind, by the first name of the kind. */
const DIAGRAM_BODIES: Readonly<Record<string, readonly string[]>> = {
  uml: ['Alice -> Bob : hello', 'Bob --> Alice : hi'],
  gantt: ['[Design] lasts 5 days', '[Build] lasts 10 days', "[Build] starts at [Design]'s end"],
  mindmap: ['* Project', '** Goals', '** Risks'],
  wbs: ['* Release', '** Plan', '** Build'],
  nwdiag: ['nwdiag {', '  network office {', '    address = "192.168.0.x/24"', '    web01 [address = "192.168.0.10"];', '    db01;', '  }', '}'],
  creole: ['= Heading', 'Text in **bold** and //italic//.', '* An item'],
  chart: ['h-axis [Q1, Q2, Q3]', 'v-axis 0 --> 10', 'bar "Sales" [3, 5, 8]'],
  packetdiag: ['packetdiag {', '  colwidth = 32', '  0-15: Source Port', '  16-31: Destination Port', '}'],
  json: ['{', '  "name": "Alice",', '  "roles": ["admin", "user"]', '}'],
  yaml: ['name: Alice', 'roles:', '  - admin', '  - user'],
  ebnf: ['expression = term, { "+", term };', 'term = "a" | "b";'],
  regex: ['/[a-z]+@[a-z]+\\.com/'],
  salt: ['{', '  Login    | "alice   "', '  Password | "****    "', '  [Cancel] | [  OK  ]', '}'],
};

/** What a kind of diagram is, by the first name the kind has. */
function diagramText(kind: string, l10n: MessageLocalizer): string | null {
  switch (kind) {
    case 'uml':
      return l10n.t(
        'UML diagrams, such as sequence, class, activity, state, component and timing diagrams: the engine tells which from the lines.'
      );
    case 'gantt':
      return l10n.t('A Gantt chart: tasks, how long each lasts and when it starts.');
    case 'mindmap':
      return l10n.t('A mind map: one idea per line, its level set by how the line starts, such as by the number of * before it.');
    case 'wbs':
      return l10n.t(
        'A work breakdown structure: one item per line, its level set by how the line starts, such as by the number of * before it.'
      );
    case 'nwdiag':
      return l10n.t('A network diagram: networks, the nodes on each and their addresses.');
    case 'creole':
      return l10n.t('Text in Creole markup, such as headings, lists, tables, bold and italic, drawn as it is formatted.');
    case 'chart':
      return l10n.t('A chart of values along two axes, drawn as bars, lines, areas or points.');
    case 'packetdiag':
      return l10n.t('A packet diagram: the fields of a packet header and the bits each takes.');
    case 'json':
      return l10n.t('JSON data, shown as a diagram.');
    case 'yaml':
      return l10n.t('YAML data, shown as a diagram.');
    case 'ebnf':
      return l10n.t('A grammar in EBNF (Extended Backus–Naur Form), drawn as a diagram.');
    case 'regex':
      return l10n.t('A regular expression, drawn as a diagram.');
    case 'salt':
      return l10n.t('A wireframe of a user interface, with windows, buttons, text fields, check boxes, trees, tables and menus.');
    default:
      return null;
  }
}

/** The help for `target`, or null when it has none. */
export function helpFor(target: BuiltinTarget, l10n: MessageLocalizer): Help | null {
  switch (target.kind) {
    case 'directive': {
      const help = directiveHelp(target.name, l10n);
      return help === null ? null : { title: `!${target.name}`, ...help };
    }
    case 'diagram': {
      const kind = SUPPORTED_DIAGRAMS.find(({ names }) => names.includes(target.name))?.names[0] ?? '';
      const text = diagramText(kind, l10n);
      const body = DIAGRAM_BODIES[kind];
      return text === null || body === undefined
        ? null
        : { title: `@start${target.name}`, text, syntax: lines([`@start${target.name}`, ...body, `@end${target.name}`]) };
    }
    case 'theme':
      return {
        title: target.name,
        text: l10n.t('A theme bundled with this extension, which gives the diagram its look.'),
        syntax: `!theme ${target.name}`,
      };
    case 'icon':
      return {
        title: target.name,
        text: l10n.t('An OpenIconic icon bundled with this extension, drawn in text. A scale and a colour can follow its name.'),
        syntax: lines([`<&${target.name}>`, `<&${target.name}{scale=2,color=red}>`]),
      };
  }
}

/** The Markdown of built-in help. */
export function helpMarkdown(help: Help, l10n: MessageLocalizer): string {
  return [
    `**${escapeMarkdown(help.title)}**`,
    escapeMarkdown(help.text),
    codeBlock(help.syntax, 'plantuml'),
    ...(help.example === undefined ? [] : [escapeMarkdown(l10n.t('Example')), codeBlock(help.example, 'plantuml')]),
  ].join('\n\n');
}

/** The comment above a definition, cut to {@link HOVER_COMMENT}, with `…` on a line of its own where it was cut. */
function shortComment(comment: string): string {
  const all = comment.split('\n');
  let text = all.slice(0, HOVER_COMMENT.lines).join('\n');
  let cut = all.length > HOVER_COMMENT.lines;
  if (text.length > HOVER_COMMENT.characters) {
    // Not between the two halves of a character.
    const last = text.charCodeAt(HOVER_COMMENT.characters - 1);
    text = text.slice(0, last >= 0xd800 && last <= 0xdbff ? HOVER_COMMENT.characters - 1 : HOVER_COMMENT.characters);
    cut = true;
  }
  return cut ? `${text}\n…` : text;
}

/**
 * The Markdown of the definitions a name may stand for, each a section of
 * the hover: `summary`, where they are, what defines them and how sure that
 * is; then each definition, up to {@link HOVER_DEFINITIONS}, as declared,
 * where, and the comment above it, as written.
 */
export function definitionSections(
  summary: string,
  definitions: readonly MacroDefinition[],
  l10n: MessageLocalizer
): string[] {
  const shown = definitions.slice(0, HOVER_DEFINITIONS);
  return [
    escapeMarkdown(summary),
    ...shown.map((definition) =>
      [
        codeBlock(definition.declaration, 'plantuml'),
        escapeMarkdown(definition.where),
        ...(definition.comment === undefined ? [] : [codeBlock(shortComment(definition.comment), 'text')]),
      ].join('\n\n')
    ),
    ...(definitions.length > shown.length
      ? [escapeMarkdown(l10n.t('{0} more definitions are not shown.', String(definitions.length - shown.length)))]
      : []),
  ];
}
