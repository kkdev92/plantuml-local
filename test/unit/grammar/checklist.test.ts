import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { BUILTINS, SUPPORTED_DIAGRAMS } from '../../../src/grammar';
import { allCases } from './cases';
import checklist from './checklist.json';
import { checkScopes } from './harness';

/**
 * checklist.json lists what the bundled engine accepts: the commands of
 * every diagram factory in its browser build, the gantt sentences, the
 * preprocessor line types and builtins, the creole markup. It is generated
 * from the upstream sources (scripts/extract-grammar-checklist.mjs). Every
 * entry must be exercised by a grammar case — a real diagram whose tokens
 * are asserted and which the engine renders.
 *
 * Case `covers` entries are `kind:id`:
 *   command:<id>       a command of any factory (ids are shared)
 *   gantt:<phrase>     a gantt subject / verb / complement combination
 *   preprocessor:<T>   a preprocessor line type (TLineType)
 *   creole:<id>        a creole markup command
 *   factory:<name>     a factory without commands (JSON, YAML, creole, version)
 * Builtins and @start directives are found in the case sources.
 */

const required = new Set<string>([
  ...checklist.factories.flatMap((f) => f.commands.map((c) => `command:${c}`)),
  ...checklist.factories.filter((f) => f.commands.length === 0).map((f) => `factory:${f.name}`),
  ...checklist.ganttPhrases.map((p) => `gantt:${p}`),
  ...checklist.preprocessor.map((t) => `preprocessor:${t}`),
  ...checklist.creole.map((c) => `creole:${c}`),
]);

const covered = new Set(allCases.flatMap((c) => c.covers));

describe('grammar checklist', () => {
  it('matches the bundled engine version', () => {
    const require = createRequire(import.meta.url);
    const { version } = require('@plantuml/core/package.json') as { version: string };
    expect(checklist.upstream.tag, 'regenerate test/unit/grammar/checklist.json for the new engine').toBe(`v${version}`);
  });

  it('has every entry covered by a grammar case', () => {
    const missing = [...required].filter((id) => !covered.has(id)).sort();
    expect(missing).toEqual([]);
  });

  it('has no case covering an entry that does not exist', () => {
    const unknown = [...covered].filter((id) => !required.has(id)).sort();
    expect(unknown).toEqual([]);
  });

  it('uses every supported @start directive in some case, and no unsupported one', () => {
    const used = new Set(
      allCases.flatMap((c) => [...c.source.matchAll(/^\s*[@\\]start(\w+)/gm)].map((m) => (m[1] ?? '').toLowerCase()))
    );
    for (const d of checklist.directives) {
      if (d.supported) expect(used.has(d.name), `@start${d.name}`).toBe(true);
    }
  });

  it('marks the @start directives the engine does not render', async () => {
    const unsupported = checklist.directives.filter((d) => !d.supported).map((d) => d.name);
    expect(unsupported.length).toBeGreaterThan(0);
    for (const name of unsupported) {
      const failures = await checkScopes(`@start${name}\nx\n@end${name}`, [
        [name, 'invalid.illegal.unsupported-diagram'],
        [`@end${name}`, 'keyword.control.diagram'],
      ]);
      expect(failures, `@start${name}`).toEqual([]);
    }
  });

  it('knows exactly the supported @start directives', () => {
    const names = SUPPORTED_DIAGRAMS.flatMap((kind) => kind.names).sort();
    const supported = checklist.directives.filter((d) => d.supported).map((d) => d.name).sort();
    expect(names).toEqual(supported);
  });

  it('knows exactly the builtin functions', () => {
    expect([...BUILTINS].sort()).toEqual([...checklist.builtins].sort());
  });

  it('highlights every builtin function', async () => {
    const source = ['@startuml', ...checklist.builtins.map((b) => `!$x = ${b}()`), '@enduml'].join('\n');
    const failures = await checkScopes(
      source,
      checklist.builtins.map((b) => [b, 'support.function.builtin'] as const)
    );
    expect(failures).toEqual([]);
  });

  it('uses every builtin function in a case the engine renders', () => {
    const sources = allCases.filter((c) => c.render === undefined || c.render === 'ok').map((c) => c.source);
    const unused = checklist.builtins.filter((b) => !sources.some((s) => s.includes(`${b}(`)));
    expect(unused).toEqual([]);
  });
});
