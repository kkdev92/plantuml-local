/**
 * Tokenizes text with the grammars from src/grammar the way VS Code does
 * (vscode-textmate with the Oniguruma WASM build) and checks the scopes
 * that parts of the text receive.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

import {
  DATA_INJECTION_SCOPE,
  grammars,
  JSON_INJECTION_SCOPE,
  MARKDOWN_FALLBACK_SCOPE,
  MARKDOWN_INJECTION_SCOPE,
  PLANTUML_SCOPE,
} from '../../../src/grammar';

const require = createRequire(import.meta.url);
export const MARKDOWN_SCOPE = 'text.html.markdown';

/**
 * An injection that claims every fence, whatever its language, the way some
 * extensions do (fixtures/README.md). VS Code registers such an extension
 * before this one when its folder name sorts first.
 */
export const CATCH_ALL_SCOPE = 'test.fence-catch-all';

/** VS Code's own grammars the PlantUML grammars embed or are embedded in. */
const FIXTURES: Record<string, string> = {
  [MARKDOWN_SCOPE]: 'markdown.tmLanguage.json',
  'source.json': 'JSON.tmLanguage.json',
  'source.yaml': 'yaml.tmLanguage.json',
  'source.yaml.1.0': 'yaml-1.0.tmLanguage.json',
  'source.yaml.1.1': 'yaml-1.1.tmLanguage.json',
  'source.yaml.1.2': 'yaml-1.2.tmLanguage.json',
  'source.yaml.1.3': 'yaml-1.3.tmLanguage.json',
  'source.yaml.embedded': 'yaml-embedded.tmLanguage.json',
  [CATCH_ALL_SCOPE]: 'fence-catch-all.tmLanguage.json',
};

/** Injection grammars, as package.json registers them. */
const INJECTIONS: Record<string, string[]> = {
  [MARKDOWN_SCOPE]: [
    MARKDOWN_INJECTION_SCOPE,
    MARKDOWN_FALLBACK_SCOPE,
    DATA_INJECTION_SCOPE,
    JSON_INJECTION_SCOPE,
  ],
  [PLANTUML_SCOPE]: [DATA_INJECTION_SCOPE, JSON_INJECTION_SCOPE],
};

let onigLib: Promise<textmate.IOnigLib> | undefined;

/** The Oniguruma WASM can be loaded once per process; every registry shares it. */
function getOnigLib(): Promise<textmate.IOnigLib> {
  onigLib ??= (async () => {
    const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
    return {
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    };
  })();
  return onigLib;
}

const registries = new Map<boolean, Promise<textmate.Registry>>();

/** With `catchAll`, the catch-all fence is injected into Markdown before this extension's grammars. */
function getRegistry(catchAll = false): Promise<textmate.Registry> {
  let registry = registries.get(catchAll);
  registry ??= (async () => {
    const own = new Map(grammars.map(({ grammar }) => [grammar.scopeName, grammar]));
    const injections = (scopeName: string): string[] | undefined =>
      catchAll && scopeName === MARKDOWN_SCOPE
        ? [CATCH_ALL_SCOPE, ...(INJECTIONS[scopeName] ?? [])]
        : INJECTIONS[scopeName];
    return new textmate.Registry({
      onigLib: getOnigLib(),
      loadGrammar: async (scopeName) => {
        const grammar = own.get(scopeName);
        if (grammar !== undefined) {
          return textmate.parseRawGrammar(JSON.stringify(grammar), `${scopeName}.json`);
        }
        const fixture = FIXTURES[scopeName];
        if (fixture !== undefined) {
          const path = join(__dirname, 'fixtures', fixture);
          return textmate.parseRawGrammar(readFileSync(path, 'utf8'), path);
        }
        return null;
      },
      getInjections: injections,
    });
  })();
  registries.set(catchAll, registry);
  return registry;
}

/** Depth of the rule stack after each line, for a grammar given as an object. */
export async function stackDepths(grammar: { scopeName: string }, lines: readonly string[]): Promise<number[]> {
  const registry = new textmate.Registry({
    onigLib: getOnigLib(),
    loadGrammar: async () => textmate.parseRawGrammar(JSON.stringify(grammar), `${grammar.scopeName}.json`),
  });
  const loaded = await registry.loadGrammar(grammar.scopeName);
  if (loaded === null) {
    throw new Error(`grammar not found: ${grammar.scopeName}`);
  }
  let stack = textmate.INITIAL;
  return lines.map((line) => {
    stack = loaded.tokenizeLine(line, stack).ruleStack;
    return (stack as unknown as { depth: number }).depth;
  });
}

export interface Token {
  line: number;
  start: number;
  end: number;
  text: string;
  scopes: string[];
}

export interface Tokenized {
  lines: string[];
  tokens: Token[];
  /** Depth of the rule stack after the last line; 1 means every rule was closed. */
  endDepth: number;
}

export async function tokenize(source: string, scopeName = PLANTUML_SCOPE, catchAll = false): Promise<Tokenized> {
  const grammar = await (await getRegistry(catchAll)).loadGrammar(scopeName);
  if (grammar === null) {
    throw new Error(`grammar not found: ${scopeName}`);
  }
  const lines = source.split('\n');
  const tokens: Token[] = [];
  let stack = textmate.INITIAL;
  lines.forEach((line, index) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    for (const t of result.tokens) {
      const end = Math.min(t.endIndex, line.length);
      if (end > t.startIndex) {
        tokens.push({ line: index, start: t.startIndex, end, text: line.slice(t.startIndex, end), scopes: t.scopes });
      }
    }
  });
  return { lines, tokens, endDepth: (stack as unknown as { depth: number }).depth };
}

/**
 * `[text, scopes]`: every non-blank character of the next occurrence of
 * `text` carries each scope (or a more specific scope under it); `!scope`
 * asserts the opposite. Several conditions are separated by spaces.
 * Occurrences are searched in order, each after the previous one.
 */
export type Expectation = readonly [text: string, scopes: string];

function hasScope(scopes: readonly string[], wanted: string): boolean {
  return scopes.some((s) => s === wanted || s.startsWith(`${wanted}.`));
}

/** Returns one message per unmet expectation (empty when all hold). */
export async function checkScopes(
  source: string,
  expectations: readonly Expectation[],
  scopeName = PLANTUML_SCOPE,
  catchAll = false
): Promise<string[]> {
  const { lines, tokens } = await tokenize(source, scopeName, catchAll);
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const scopesAt = (position: number): Token | undefined => {
    let line = offsets.length - 1;
    while (line > 0 && (offsets[line] ?? 0) > position) line--;
    const column = position - (offsets[line] ?? 0);
    return tokens.find((t) => t.line === line && t.start <= column && column < t.end);
  };

  const failures: string[] = [];
  let cursor = 0;
  for (const [text, specs] of expectations) {
    const at = source.indexOf(text, cursor);
    if (at === -1) {
      failures.push(`${JSON.stringify(text)}: not found after offset ${cursor}`);
      continue;
    }
    cursor = at + text.length;
    for (const spec of specs.split(' ')) {
      const negate = spec.startsWith('!');
      const wanted = negate ? spec.slice(1) : spec;
      for (let i = at; i < at + text.length; i++) {
        if (/\s/.test(source.charAt(i))) continue;
        const token = scopesAt(i);
        const scopes = token?.scopes ?? [];
        if (hasScope(scopes, wanted) === negate) {
          failures.push(
            `${JSON.stringify(text)} should ${negate ? 'not ' : ''}have ${wanted}; ` +
              `${JSON.stringify(token?.text ?? source[i])} has ${scopes.join(' ')}`
          );
          break;
        }
      }
    }
  }
  return failures;
}

/** Readable token listing, for writing expectations and for failure output. */
export async function describe(source: string, scopeName = PLANTUML_SCOPE): Promise<string> {
  const { tokens } = await tokenize(source, scopeName);
  const base = new Set([scopeName, 'meta.embedded.block.plantuml']);
  return tokens
    .filter((t) => t.text.trim() !== '')
    .map((t) => `${t.line}:${t.start} ${JSON.stringify(t.text)} ${t.scopes.filter((s) => !base.has(s)).join(' ')}`)
    .join('\n');
}

export { PLANTUML_SCOPE };
