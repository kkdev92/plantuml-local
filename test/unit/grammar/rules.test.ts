import { describe, expect, it } from 'vitest';

import { merge, named, scope } from '../../../src/grammar/rules';

describe('grammar building blocks', () => {
  it('suffixes every scope with the language', () => {
    expect(scope('keyword.other')).toBe('keyword.other.plantuml');
    expect(named('variable.other punctuation.definition.variable')).toEqual({
      name: 'variable.other.plantuml punctuation.definition.variable.plantuml',
    });
  });

  it('refuses a repository entry defined twice', () => {
    expect(merge({ a: { match: 'x' } }, { b: { match: 'y' } })).toEqual({ a: { match: 'x' }, b: { match: 'y' } });
    expect(() => merge({ a: { match: 'x' } }, { a: { match: 'y' } })).toThrow('defined twice: a');
  });
});
