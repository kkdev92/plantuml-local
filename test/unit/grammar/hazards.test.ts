import { describe, expect, it } from 'vitest';

import { grammars, SUPPORTED_DIAGRAMS, type Rule } from '../../../src/grammar';
import { stackDepths, tokenize } from './harness';

/**
 * Patterns that make tokenizing slow grow with the square of the line
 * length: a look-around that scans to the end of the line, placed where the
 * engine tries it at every position (before the line-start anchor). A
 * 10 000-character line took 300 ms with one such pattern and 16 ms
 * without. This checks the shape of every pattern instead of timing one.
 */
function* patterns(rule: Rule, path: string): Generator<[string, string]> {
  for (const key of ['match', 'begin', 'end', 'while'] as const) {
    const value = rule[key];
    if (value !== undefined) yield [`${path}.${key}`, value];
  }
  for (const [i, child] of (rule.patterns ?? []).entries()) yield* patterns(child, `${path}.patterns[${i}]`);
  for (const key of ['captures', 'beginCaptures', 'endCaptures', 'whileCaptures'] as const) {
    for (const [n, capture] of Object.entries(rule[key] ?? {})) yield* patterns(capture, `${path}.${key}[${n}]`);
  }
}

/** The group that opens `source` at `start`, including its parentheses. */
function group(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') {
      i++;
    } else if (source[i] === '(') {
      depth++;
    } else if (source[i] === ')' && --depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function* allPatterns(): Generator<[string, string]> {
  for (const { grammar } of grammars) {
    const roots: [string, Rule][] = [
      ...grammar.patterns.map((p, i): [string, Rule] => [`patterns[${i}]`, p]),
      ...Object.entries(grammar.repository),
    ];
    for (const [name, rule] of roots) yield* patterns(rule, `${grammar.scopeName}#${name}`);
  }
}

/** Whether a pattern opens with a look-around that scans to the end of the line. */
function opensWithLineScan(source: string): boolean {
  // Inline options such as (?S) and (?i) come first and change nothing here.
  const body = source.replace(/^(?:\(\?[a-zA-Z]+\))+/, '');
  return /^\(\?<?[=!]/.test(body) && /\.[*+]/.test(group(body, 0));
}

describe('grammar patterns', () => {
  it('have no leading look-around that scans the whole line', () => {
    // Positive controls: the check sees through the inline options.
    expect(opensWithLineScan('(?S)(?!.*\\{\\s*$)x')).toBe(true);
    expect(opensWithLineScan('(?S)(?i)(?=.*;)y')).toBe(true);

    const offenders: string[] = [];
    for (const [where, source] of allPatterns()) {
      if (opensWithLineScan(source)) offenders.push(`${where}: ${source.slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A look-behind of unbounded length is tried back to the line start from
   * every position: `(?<=^[\s>]*)` in the line-start anchor made a
   * 10 000-character line take seconds. Bounded ones (`{0,32}`) are fine.
   */
  it('have no look-behind of unbounded length', () => {
    const offenders: string[] = [];
    for (const [where, source] of allPatterns()) {
      for (const m of source.matchAll(/\(\?<[=!]/g)) {
        const inner = group(source, m.index).slice(4, -1).replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, 'x');
        if (/[*+]|\{\d+,\}/.test(inner)) offenders.push(`${where}: ${group(source, m.index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A match that consumes nothing makes vscode-textmate assume an endless
   * loop and drop the rule it is in. Rules that could match an empty line
   * closed nwdiag, packetdiag and regex diagrams at their first blank line.
   * Each match rule goes alone into the body of a begin/end rule here, which
   * must survive every line up to its end.
   */
  it('have no match rule that drops the rule it is in', async () => {
    const lines = ['@start', '', '   ', 'x', 'Alice -> Bob : hi', '}', '@end'];
    const offenders: string[] = [];
    for (const [where, match] of matchRules()) {
      const box = {
        scopeName: 'source.box',
        patterns: [{ name: 'meta.box', begin: '^@start$', end: '^@end$', patterns: [{ match }] }],
        repository: {},
      };
      const depths = await stackDepths(box, lines);
      if (depths.slice(0, -1).some((depth) => depth < 2)) offenders.push(`${where}: ${match.slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });
});

/** Every `match` rule outside captures, which are tokenized on their own. */
function* matchRules(): Generator<[string, string]> {
  function* walk(rule: Rule, path: string): Generator<[string, string]> {
    if (rule.match !== undefined) yield [path, rule.match];
    for (const [i, child] of (rule.patterns ?? []).entries()) yield* walk(child, `${path}.patterns[${i}]`);
  }
  for (const { grammar } of grammars) {
    for (const [i, rule] of grammar.patterns.entries()) yield* walk(rule, `${grammar.scopeName}#patterns[${i}]`);
    for (const [name, rule] of Object.entries(grammar.repository)) yield* walk(rule, `${grammar.scopeName}#${name}`);
  }
}

/** A line or two every kind of diagram accepts. */
const BODIES: Record<string, string> = {
  uml: 'Alice -> Bob : hi',
  gantt: '[Design] requires 5 days',
  project: '[Design] requires 5 days',
  mindmap: '* root',
  wbs: '* root',
  nwdiag: 'nwdiag {\n  network dmz {\n    web01;\n  }\n}',
  creole: '**bold**',
  chart: 'h-axis [a, b]\nbar [1, 2]',
  packetdiag: '0-3: Source Port',
  json: '{ "a": 1 }',
  yaml: 'a: 1',
  ebnf: 'rule = "a";',
  regex: 'a+b',
};

describe('diagrams', () => {
  it('keep blank lines inside the diagram, for every @start type', async () => {
    const names = SUPPORTED_DIAGRAMS.flatMap((kind) => kind.names);
    expect(names.filter((name) => BODIES[name] === undefined)).toEqual([]);

    const failures: string[] = [];
    for (const name of names) {
      const source = [`@start${name}`, '', '   ', BODIES[name], '', `@end${name}`].join('\n');
      const { tokens, endDepth } = await tokenize(source);
      const end = tokens.filter((t) => t.text.startsWith('@end'));
      if (endDepth !== 1 || !end.some((t) => t.scopes.some((s) => s.startsWith('keyword.control.diagram')))) {
        failures.push(`@start${name}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
