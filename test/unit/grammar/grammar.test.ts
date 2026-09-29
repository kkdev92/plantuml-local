import { describe as group, expect, it } from 'vitest';

import { caseGroups } from './cases';
import { checkScopes, describe, tokenize } from './harness';

for (const [file, cases] of Object.entries(caseGroups)) {
  if (cases.length === 0) continue;
  group(`grammar: ${file}`, () => {
    for (const c of cases) {
      it(c.name, async () => {
        const failures = await checkScopes(c.source, c.expect);
        expect(failures, `${failures.join('\n')}\n\ntokens:\n${await describe(c.source)}`).toEqual([]);
      });

      it(`${c.name} — closes every rule by the end of the diagram`, async () => {
        const { endDepth } = await tokenize(c.source);
        expect(endDepth).toBe(1);
      });
    }
  });
}
