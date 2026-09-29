/**
 * Builds the grammar checklist (test/unit/grammar/checklist.json) from a
 * checkout of the upstream PlantUML sources.
 *
 * The syntax highlighting grammar has to recognise everything the bundled
 * engine accepts. PlantUML parses a diagram line by line against a list of
 * commands, so the commands registered by the diagram factories of the
 * browser build are an exact inventory of that syntax. This script lists
 * them - it records names only, never the upstream patterns - and the unit
 * tests fail while any entry has no grammar test case covering it.
 *
 * The checkout must be at the tag matching the bundled @plantuml/core
 * version. Build markers are resolved for the browser (TeaVM) build of the
 * MIT-licensed flavour, which is what @plantuml/core ships:
 *   // ::comment when X ... // ::done    dropped when X applies
 *   // ::uncomment when X ... // ::done  restored when X applies
 *   if (!TeaVM.isTeaVM()) { ... }        dropped
 *
 * Usage:
 *   git clone --depth 1 --branch v1.2026.8 https://github.com/plantuml/plantuml.git
 *   node scripts/extract-grammar-checklist.mjs --source ../plantuml
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const FLAVOUR = new Set(['__TEAVM__', '__MIT__']);
const JAVA_ROOT = 'src/main/java/net/sourceforge/plantuml';

function parseArgs(argv) {
  const args = { source: undefined, out: 'test/unit/grammar/checklist.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--source') args.source = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (args.source === undefined) throw new Error('missing --source <plantuml checkout>');
  return args;
}

// --- reading Java ----------------------------------------------------------

/** Maps simple class names to file paths (the names used here are unique). */
function indexJava(root) {
  const byName = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.java')) {
        const name = entry.name.slice(0, -'.java'.length);
        byName.set(name, [...(byName.get(name) ?? []), path]);
      }
    }
  };
  walk(root);
  return byName;
}

/** Removes comments while leaving string and character literals alone. */
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Returns the index just past the bracket that closes the one at `open`. */
function matchBracket(text, open) {
  const pairs = { '{': '}', '(': ')' };
  const opener = text[open];
  const closer = pairs[opener];
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      i = j;
    } else if (c === opener) depth++;
    else if (c === closer && --depth === 0) return i + 1;
  }
  throw new Error(`unbalanced ${opener} at ${open}`);
}

/** Drops `if (!TeaVM.isTeaVM()) ...` and keeps only the TeaVM side of `if (TeaVM.isTeaVM())`. */
function resolveTeaVM(code) {
  const pattern = /if\s*\(\s*(!?)\s*TeaVM\.isTeaVM\(\)\s*\)\s*/g;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const negated = match[1] === '!';
    const start = match.index;
    let bodyStart = start + match[0].length;
    let bodyEnd;
    if (code[bodyStart] === '{') bodyEnd = matchBracket(code, bodyStart);
    else bodyEnd = code.indexOf(';', bodyStart) + 1;
    let thenPart = code.slice(bodyStart, bodyEnd);
    if (thenPart.startsWith('{')) thenPart = thenPart.slice(1, -1);
    let end = bodyEnd;
    let elsePart = '';
    const elseMatch = /^\s*else\s*/.exec(code.slice(bodyEnd));
    if (elseMatch) {
      const elseStart = bodyEnd + elseMatch[0].length;
      const elseEnd = code[elseStart] === '{' ? matchBracket(code, elseStart) : code.indexOf(';', elseStart) + 1;
      elsePart = code.slice(elseStart, elseEnd);
      if (elsePart.startsWith('{')) elsePart = elsePart.slice(1, -1);
      end = elseEnd;
    }
    code = code.slice(0, start) + (negated ? elsePart : thenPart) + code.slice(end);
    pattern.lastIndex = start;
  }
  return code;
}

/** Reads a Java file as the TeaVM MIT build sees it, without comments. */
function readFlavoured(path) {
  const out = [];
  let mode = null;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const marker = /^\s*\/\/\s*::(comment|uncomment) when (.+?)\s*$/.exec(line);
    if (marker) {
      const applies = marker[2].split(/\s+/).some((token) => FLAVOUR.has(token));
      if (marker[1] === 'comment') mode = applies ? 'drop' : null;
      else mode = applies ? 'restore' : null;
      continue;
    }
    if (/^\s*\/\/\s*::done\b/.test(line)) {
      mode = null;
      continue;
    }
    if (mode === 'drop') continue;
    out.push(mode === 'restore' ? line.replace(/^(\s*)\/\/ ?/, '$1') : line);
  }
  return resolveTeaVM(stripComments(out.join('\n')));
}

/** Splits at commas or semicolons that are not nested in brackets. */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      current += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if ('({[<'.includes(c) && !(c === '<' && /[\s=]/.test(text[i + 1] ?? ''))) depth++;
    else if (')}]>'.includes(c) && !(c === '>' && (text[i - 1] === '-' || /\s/.test(text[i - 1] ?? '')))) depth--;
    if (c === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += c;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

// --- naming ----------------------------------------------------------------

function normaliseArg(arg) {
  const a = arg.replace(/\s+/g, ' ').trim();
  if (a === 'this') return undefined;
  if (/^".*"$/.test(a) || /^(true|false|\d+)$/.test(a)) return a;
  let m = /^(\w+)\.ME$/.exec(a);
  if (m) return m[1];
  m = /^new (\w+)(?:<>)?\((.*)\)$/.exec(a);
  if (m) return m[1];
  m = /^(?:\w+\.)*(\w+)\(\)$/.exec(a);
  if (m) return m[1];
  m = /^(?:\w+\.)*(\w+)$/.exec(a);
  if (m) return m[1];
  throw new Error(`unrecognised argument: ${arg}`);
}

function withArgs(name, args) {
  const list = splitTopLevel(args, ',')
    .map(normaliseArg)
    .filter((a) => a !== undefined);
  return list.length === 0 ? name : `${name}(${list.join(',')})`;
}

/**
 * Some command classes share a simple name (sequencediagram.CommandUrl and
 * classdiagram.CommandUrl are different commands). Such names are
 * qualified with the top-level package the registering file imports them
 * from.
 */
function qualifier(index, code, file, name) {
  if ((index.get(name) ?? []).length < 2) return name;
  const imported = new RegExp(`import net\\.sourceforge\\.plantuml\\.([\\w.]+)\\.${name};`).exec(code);
  const pkg = imported
    ? imported[1]
    : file
        .replace(/\\/g, '/')
        .replace(/^.*\/net\/sourceforge\/plantuml\//, '')
        .replace(/\/[^/]+$/, '')
        .replace(/\//g, '.');
  return `${pkg.split('.')[0]}.${name}`;
}

/** Turns the expression given to `cmds.add(...)` into a stable identifier. */
function commandId(expr, vars, qualify = (name) => name) {
  const e = expr.replace(/\s+/g, ' ').trim();
  let m = /^new (\w+)\((.*)\)$/.exec(e);
  if (m) return withArgs(qualify(m[1]), m[2]);
  m = /^(\w+)\.ME$/.exec(e);
  if (m) return qualify(m[1]);
  m = /^(\w+)\.([A-Z][A-Z0-9_]*)$/.exec(e);
  if (m) return `${qualify(m[1])}.${m[2]}`;
  m = /^(\w+)(?:\.ME)?\.(create\w*)\((.*)\)$/.exec(e);
  if (m) {
    const base = vars.has(m[1]) ? vars.get(m[1]) : qualify(m[1]);
    return withArgs(`${base}.${m[2]}`, m[3]);
  }
  throw new Error(`unrecognised command expression: ${expr}`);
}

// --- commands ----------------------------------------------------------------

function methodBody(code, name) {
  const header = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*(?:final\\s+)?List<Command>\\s+(\\w+)\\s*\\)\\s*\\{`);
  const m = header.exec(code);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  return { param: m[1], body: code.slice(open + 1, matchBracket(code, open) - 1) };
}

function classFile(index, name) {
  const paths = index.get(name);
  if (!paths) throw new Error(`class not found: ${name}`);
  if (paths.length > 1) throw new Error(`class name is ambiguous: ${name} (${paths.join(', ')})`);
  return paths[0];
}

/** Lists the commands a method registers, following helper calls. */
function commandsOf(index, className, methodName, seen = new Set()) {
  const key = `${className}.${methodName}`;
  if (seen.has(key)) throw new Error(`recursive helper: ${key}`);
  seen.add(key);
  const file = classFile(index, className);
  const code = readFlavoured(file);
  const method = methodBody(code, methodName);
  if (!method) throw new Error(`method not found: ${key}`);
  const qualify = (name) => qualifier(index, code, file, name);
  const vars = new Map();
  const result = [];
  for (const statement of splitTopLevel(method.body, ';')) {
    const s = statement.replace(/\s+/g, ' ').trim();
    if (s === '') continue;
    let m = new RegExp(`^${method.param}\\.add\\((.*)\\)$`).exec(s);
    if (m) {
      result.push(commandId(m[1], vars, qualify));
      continue;
    }
    m = new RegExp(`^(?:(\\w+)\\.)?(\\w+)\\(\\s*${method.param}\\s*\\)$`).exec(s);
    if (m) {
      result.push(...commandsOf(index, m[1] ?? className, m[2], seen));
      continue;
    }
    m = /^(?:final )?(\w+)(?:<[^>]*>)? (\w+) = (.+)$/.exec(s);
    if (m) {
      vars.set(m[2], commandId(m[3], new Map(), qualify));
      continue;
    }
    throw new Error(`unrecognised statement in ${key}: ${s}`);
  }
  return result;
}

function diagramTypeOf(index, className) {
  let current = className;
  while (current) {
    const code = readFlavoured(classFile(index, current));
    const m = /\b(?:super|this)\s*\(\s*DiagramType\.(\w+)\s*\)/.exec(code);
    if (m) return m[1];
    const parent = new RegExp(`class\\s+${current}\\b[^{]*?\\bextends\\s+(\\w+)`).exec(code);
    current = parent ? parent[1] : undefined;
  }
  throw new Error(`diagram type not found for ${className}`);
}

// --- sections ----------------------------------------------------------------

function browserFactories(index) {
  const code = readFlavoured(classFile(index, 'PSystemBuilder2'));
  const names = [...code.matchAll(/factories\.add\(\s*new (\w+)\(/g)].map((m) => m[1]);
  return [...new Set(names)];
}

function directives(index) {
  const code = readFlavoured(classFile(index, 'DiagramType'));
  const list = [];
  for (const m of code.matchAll(/check\("(\w+)", text, p\)\)\s*return EnumSet\.of\(([^)]*)\)/g)) {
    list.push({ name: m[1], types: m[2].split(',').map((t) => t.trim()) });
  }
  if (list.length < 20) throw new Error(`too few @start directives: ${list.length}`);
  return list;
}

function ganttPhrases(index, subjects) {
  const phrases = [];
  for (const subject of subjects) {
    const code = readFlavoured(classFile(index, subject));
    let count = 0;
    for (const m of code.matchAll(/new VerbPhraseAction\(/g)) {
      const open = m.index + m[0].length - 1;
      const args = splitTopLevel(code.slice(open + 1, matchBracket(code, open) - 1), ',');
      const verb = /^Verbs\.(\w+)$/.exec(args[0]);
      if (!verb) throw new Error(`unrecognised verb in ${subject}: ${args[0]}`);
      // Words that must appear between verb and complement tell otherwise
      // identical phrases apart ("is off before" / "is off after").
      const required = args
        .slice(1, -1)
        .flatMap((a) => [...a.matchAll(/Words\.(usingle|uexactly2?|uoneOf)\(([^()]*)\)/g)])
        .map((w) => {
          const words = w[2].split(',').map((x) => x.trim().replace(/^Words\./, '').toLowerCase());
          return w[1] === 'uoneOf' ? words.join('|') : words.join(' ');
        });
      const complement = args[args.length - 1]
        .replace(/\s+/g, ' ')
        .replace(/^new (\w+)(?:<>)?\((.*)\)$/, (_, name, inner) => withArgs(name, inner))
        .replace(/^(\w+)\.(\w+)\(\)$/, '$1.$2');
      phrases.push([subject, verb[1], ...required, complement].join(' '));
      count++;
    }
    if (count === 0) throw new Error(`no verb phrases in ${subject}`);
  }
  return phrases;
}

function preprocessorLineTypes(index) {
  const code = readFlavoured(classFile(index, 'TLineType'));
  const body = /enum TLineType\s*\{([^;]*);/.exec(code);
  if (!body) throw new Error('TLineType constants not found');
  return body[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== 'PLAIN');
}

function builtins(index) {
  const code = readFlavoured(classFile(index, 'TContext'));
  const open = code.indexOf('{', code.indexOf('void addStandardFunctions('));
  const body = code.slice(open, matchBracket(code, open));
  const names = [];
  for (const m of body.matchAll(/functionsSet\.addFunction\(new (\w+)\(/g)) {
    const source = readFlavoured(classFile(index, m[1]));
    const signatures = [...source.matchAll(/new TFunctionSignature\("(%[^"]+)"/g)].map((s) => s[1]);
    if (signatures.length === 0) throw new Error(`no signature in ${m[1]}`);
    names.push(...signatures);
  }
  return [...new Set(names)];
}

function creoleCommands(index) {
  const code = readFlavoured(classFile(index, 'CommandCreoleBuilder'));
  return [...code.matchAll(/addCommand\((.+?)\);/g)].map((m) => {
    const call = /^(\w+)\.(\w+)\((.*)\)$/.exec(m[1].trim());
    if (!call) throw new Error(`unrecognised creole command: ${m[1]}`);
    return withArgs(`${call[1]}.${call[2]}`, call[3]);
  });
}

// --- main --------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const root = join(args.source, JAVA_ROOT);
if (!existsSync(root)) throw new Error(`not a PlantUML checkout: ${args.source}`);
const index = indexJava(root);
const git = (...a) => execFileSync('git', ['-C', args.source, ...a], { encoding: 'utf8' }).trim();

const factories = browserFactories(index).map((name) => {
  const code = readFlavoured(classFile(index, name));
  const commands = methodBody(code, 'initCommandsList') ? commandsOf(index, name, 'initCommandsList') : [];
  return { name, type: diagramTypeOf(index, name), commands };
});
const types = new Set(factories.map((f) => f.type));
const gantt = factories.find((f) => f.name === 'GanttDiagramFactory');
const subjects = gantt.commands
  .map((c) => /^NaturalGanttCommand\((\w+)\)$/.exec(c)?.[1])
  .filter((s) => s !== undefined);

const checklist = {
  upstream: {
    repository: 'plantuml/plantuml',
    tag: git('describe', '--tags', '--exact-match'),
    commit: git('rev-parse', 'HEAD'),
    build: 'TeaVM (browser), MIT flavour',
  },
  directives: directives(index).map((d) => ({ ...d, supported: d.types.some((t) => types.has(t)) })),
  factories,
  ganttPhrases: ganttPhrases(index, subjects),
  preprocessor: preprocessorLineTypes(index),
  builtins: builtins(index),
  creole: creoleCommands(index),
};

writeFileSync(args.out, JSON.stringify(checklist, null, 2) + '\n');
const commandCount = new Set(factories.flatMap((f) => f.commands)).size;
console.log(
  `${basename(args.out)}: ${checklist.upstream.tag}, ${factories.length} factories, ${commandCount} distinct commands, ` +
    `${checklist.ganttPhrases.length} gantt phrases, ${checklist.preprocessor.length} preprocessor line types, ` +
    `${checklist.builtins.length} builtins, ${checklist.creole.length} creole commands, ` +
    `${checklist.directives.filter((d) => d.supported).length}/${checklist.directives.length} directives supported`
);
