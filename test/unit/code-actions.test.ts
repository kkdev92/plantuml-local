import { describe, expect, it } from 'vitest';

import { namesDiagram, unnamedAt, withName } from '../../src/language/code-actions';

describe('namesDiagram', () => {
  it('takes the opening line of a diagram block, or the start line of a diagram', () => {
    for (const line of ['```plantuml', '~~~puml orders', '> ```plantuml', '  - ```plantuml x']) {
      expect(namesDiagram(line, false), line).toBe(true);
    }
    for (const line of ['```plantumlx', '```js', 'plantuml', '@startuml']) {
      expect(namesDiagram(line, false), line).toBe(false);
    }
    expect(namesDiagram('@startuml(id=orders)', true)).toBe(true);
    expect(namesDiagram('@startmindmap', true)).toBe(true);
    expect(namesDiagram('A -> B', true)).toBe(false);
  });
});

describe('unnamedAt', () => {
  const markdown = [
    '```plantuml',
    'A -> B',
    '```',
    '',
    '```plantuml orders',
    'A -> B',
    '```',
    '',
    '> ```plantuml x.svg',
    '> A -> B',
    '> ```',
    '',
    '<!--',
    '```plantuml',
    '-->',
  ].join('\n');

  it('offers a name to a block without a usable one, on its opening line only', () => {
    expect(unnamedAt(markdown, 0, false, 'doc')).toEqual({ current: null });
    expect(unnamedAt(markdown, 1, false, 'doc')).toBeUndefined();
    expect(unnamedAt(markdown, 4, false, 'doc')).toBeUndefined();
    // A name that cannot be a file name, in a block quote.
    expect(unnamedAt(markdown, 8, false, 'doc')).toEqual({ current: 'x.svg' });
    // Not a block: inside an HTML comment.
    expect(unnamedAt(markdown, 13, false, 'doc')).toBeUndefined();
  });

  it('offers an id to every kind of diagram of a PlantUML file', () => {
    const file = [
      '@startuml(id=orders)',
      'A -> B',
      '@enduml',
      '@startuml',
      'C -> D',
      '@enduml',
      '@startuml(id=a b)',
      'E -> F',
      '@enduml',
      '@startmindmap',
      '* root',
      '@endmindmap',
      '@startjson(id=data)',
      '{"a": 1}',
      '@endjson',
    ].join('\n');

    expect(unnamedAt(file, 0, true, 'flows')).toBeUndefined();
    expect(unnamedAt(file, 3, true, 'flows')).toEqual({ current: null });
    expect(unnamedAt(file, 6, true, 'flows')).toEqual({ current: 'a b' });
    expect(unnamedAt(file, 9, true, 'flows')).toEqual({ current: null });
    expect(unnamedAt(file, 12, true, 'flows')).toBeUndefined();
  });

  it('leaves the only diagram of a file alone while the file name can name it', () => {
    const file = '@startuml\nA -> B\n@enduml';

    expect(unnamedAt(file, 0, true, 'flows')).toBeUndefined();
    expect(unnamedAt(file, 0, true, 'my flows')).toEqual({ current: null });
  });
});

describe('withName', () => {
  it('adds or replaces the word after the language, keeping the rest of the line', () => {
    expect(withName('```plantuml', 'orders', false)).toBe('```plantuml orders');
    expect(withName('```plantuml x.svg extra', 'orders', false)).toBe('```plantuml orders extra');
    expect(withName('> ```puml  ', 'orders', false)).toBe('> ```puml orders  ');
    expect(withName('```js', 'orders', false)).toBeNull();
  });

  it('adds or replaces the id after the start line of any kind of diagram', () => {
    expect(withName('@startuml', 'orders', true)).toBe('@startuml(id=orders)');
    expect(withName('  @startuml(id=a b) <<x>>', 'orders', true)).toBe('  @startuml(id=orders) <<x>>');
    expect(withName('@startmindmap', 'orders', true)).toBe('@startmindmap(id=orders)');
    expect(withName('@startgantt(id=a b)', 'plan', true)).toBe('@startgantt(id=plan)');
    expect(withName('A -> B', 'orders', true)).toBeNull();
  });
});
