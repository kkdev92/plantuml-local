import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUDITED_LIBRARIES,
  AUDITED_THEMES,
  auditProblems,
  DYNAMIC_FUNCTIONS,
  percentNames,
  themesDigest,
  VOLATILE_FUNCTIONS,
} from '../../src/export/audit';
import { BUILTINS } from '../../src/grammar/preprocessor';

/** A library asset as assets/stdlib/ holds one: its files' texts by key. */
const asset = (entries: Record<string, string>): Uint8Array => new TextEncoder().encode(JSON.stringify({ entries }));

/** The libraries this extension ships, as assets/stdlib/ holds them. */
const shipped = (): Record<string, Uint8Array> => {
  const folder = join(__dirname, '../../assets/stdlib');
  return Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .map((name) => [name.slice(0, -'.json'.length), new Uint8Array(readFileSync(join(folder, name)))])
  );
};

describe('the audit lists', () => {
  it('name functions of the engine only, none allowed in a library also forbidden in it', () => {
    const engine = new Set(BUILTINS.map((name) => name.slice(1)));
    const listed = [
      ...Object.keys(VOLATILE_FUNCTIONS),
      ...DYNAMIC_FUNCTIONS,
      ...Object.values(AUDITED_LIBRARIES).flatMap(({ functions }) => functions),
      ...AUDITED_THEMES.functions,
    ];

    expect(listed.filter((name) => !engine.has(name))).toEqual([]);
    for (const { functions } of Object.values(AUDITED_LIBRARIES)) {
      expect(functions.filter((name) => Object.hasOwn(VOLATILE_FUNCTIONS, name) || DYNAMIC_FUNCTIONS.includes(name))).toEqual([]);
    }
  });
});

describe('percentNames', () => {
  it('finds each name after a percent sign once, called or not', () => {
    expect([...percentNames('%strlen("a") + %strlen ("b"), 100% %_x %é1 %%')].sort()).toEqual(['_x', 'strlen', 'é1']);
  });
});

describe('themesDigest', () => {
  it('goes by each theme\'s name and text, not by the order they were put together in', () => {
    const digest = themesDigest({ a: 'one', b: 'two' });

    expect(themesDigest({ b: 'two', a: 'one' })).toBe(digest);
    expect(new Set([digest, themesDigest({ a: 'one', c: 'two' }), themesDigest({ a: 'one', b: 'two!' }), themesDigest({ a: 'onetwo' })]).size).toBe(4);
  });
});

describe('auditProblems', () => {
  it('passes the C4 and Azure this extension ships', () => {
    const problems = auditProblems({ libraries: shipped(), themes: {} });

    expect(Object.keys(shipped()).sort()).toEqual(Object.keys(AUDITED_LIBRARIES).sort());
    expect(problems.filter((problem) => !problem.startsWith('theme'))).toEqual([]);
  });

  it('stops a library no one has audited, and an audited one that is no longer shipped', () => {
    const problems = auditProblems({ libraries: { other: asset({ a: 'A -> B' }) }, themes: {} });

    expect(problems).toContain('other: not audited');
    expect(problems).toContain('azure: audited, but not shipped');
    expect(problems).toContain('c4: audited, but not shipped');
  });

  it('stops an audited library that changed, that calls a function never allowed or not listed, or no longer calls one listed', () => {
    const problems = auditProblems({
      libraries: { ...shipped(), azure: asset({ a: '%load_json("x") %date() %eval("1") %lighten("#FFFFFF", 10)' }) },
      themes: {},
    }).filter((problem) => problem.startsWith('azure'));

    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/^azure: the asset has SHA-256 [0-9a-f]{64}, not the audited [0-9a-f]{64}$/);
    expect(problems.slice(1)).toEqual([
      'azure: calls %date, which an audited library may not',
      'azure: calls %eval, which an audited library may not',
      'azure: calls %lighten, which the audit does not list',
    ]);
    expect(
      auditProblems({ libraries: { ...shipped(), azure: asset({ a: 'nothing' }) }, themes: {} }).filter((problem) => problem.startsWith('azure'))
    ).toContain('azure: no longer calls %load_json, which the audit lists');
  });

  it('stops themes that changed, that call a function by a name put together, or that read the environment other than as listed', () => {
    const problems = auditProblems({
      libraries: shipped(),
      themes: {
        'carbon-gray': '%darken("#000000", 10) %lighten("#000000", 10) %not(1) %variable_exists("$x")',
        plain: '%getenv("LEGACY") %call_user_func("$f") %strlen("a")',
      },
    });

    expect(problems).toEqual([
      expect.stringMatching(/^themes: their digest is [0-9a-f]{64}, not the audited [0-9a-f]{64}$/),
      'theme plain: calls %call_user_func, which a theme may not',
      'themes: call %strlen, which the audit does not list',
      'theme plain: calls %getenv of the volatile functions, not as the audit lists',
      'theme carbon-gray: calls none of the volatile functions, not as the audit lists',
      'theme cerulean-outline: calls none of the volatile functions, not as the audit lists',
    ]);
  });
});
