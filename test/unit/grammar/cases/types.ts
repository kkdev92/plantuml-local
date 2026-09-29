import type { Expectation } from '../harness';

export interface GrammarCase {
  /** What the case shows; the test name. */
  name: string;
  /**
   * Checklist entries this case exercises, as `kind:id` — see
   * checklist.test.ts for the kinds.
   */
  covers: readonly string[];
  /** A whole diagram, as it would appear inside a ```plantuml fence. */
  source: string;
  expect: readonly Expectation[];
  /**
   * What the bundled engine makes of `source`: `'ok'` (the default) for a
   * diagram, or a pattern its error text must match. Checked by
   * test/integration/grammar-cases.test.ts.
   */
  render?: 'ok' | RegExp;
  /**
   * A pattern the engine's warnings must match, for a case that shows
   * syntax the engine accepts but warns about (deprecated forms). A case
   * without it must render without warnings.
   */
  warns?: RegExp;
}

/**
 * Template tag for diagram sources: keeps backslashes literal (PlantUML
 * uses `\n` in labels) and removes the common indentation and the first
 * and last blank lines.
 */
export function uml(strings: TemplateStringsArray, ...values: unknown[]): string {
  const lines = String.raw({ raw: strings.raw }, ...values).split('\n');
  while (lines[0]?.trim() === '') lines.shift();
  while (lines.at(-1)?.trim() === '') lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim() !== '').map((l) => /^ */.exec(l)?.[0].length ?? 0));
  return lines.map((l) => l.slice(indent)).join('\n');
}
