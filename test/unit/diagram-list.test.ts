import { describe, expect, it } from 'vitest';

import { listDiagrams } from '../../src/language/diagram-list';

const md = (...lines: string[]): string => lines.join(String.fromCharCode(10));

describe('listDiagrams', () => {
  it('lists each block in source order, named or not, with its fence line and what tells it apart', () => {
    const text = md(
      '# Orders',
      '',
      '```plantuml orders',
      '@startuml',
      'title Placing an order',
      'Alice -> Bob : order',
      '@enduml',
      '```',
      '',
      '## Notes',
      '',
      '> ```puml',
      '> @startuml',
      '> Carol -> Dave : quoted',
      '> @enduml',
      '> ```',
      '',
      '- item',
      '  ```plantuml',
      '  @startmindmap',
      '  * Root',
      '  @endmindmap',
      '  ```',
      ''
    );
    expect(listDiagrams(text)).toEqual([
      { name: 'orders', line: 2, kind: null, heading: 'Orders', title: 'Placing an order', summary: 'Alice -> Bob : order' },
      { name: null, line: 11, kind: null, heading: 'Notes', title: null, summary: 'Carol -> Dave : quoted' },
      { name: null, line: 18, kind: 'mindmap', heading: 'Notes', title: null, summary: '* Root' },
    ]);
  });

  it('takes the kind from the start line, and none from @startuml or a block without one', () => {
    const kinds = (source: string): string | null => listDiagrams(md('```plantuml', ...source.split('\n'), '```'))[0]?.kind ?? null;
    expect(kinds('@startjson\n{}\n@endjson')).toBe('json');
    expect(kinds('@startgantt\n[a] lasts 1 day\n@endgantt')).toBe('gantt');
    expect(kinds("' a comment\n@startsalt\n{ x }\n@endsalt")).toBe('salt');
    expect(kinds('@startuml\nA -> B\n@enduml')).toBeNull();
    expect(kinds('A -> B')).toBeNull();
    // Named by the start line, not by a line inside a comment.
    expect(kinds("/'\n@startwbs\n'/\n@startuml\nA -> B\n@enduml")).toBeNull();
  });

  it('skips a heading that is a line of a code block, and a heading in the front matter', () => {
    const text = md('---', '# not a heading', '---', '```js', '# nor this', '```', '', '```plantuml', 'A -> B', '```');
    expect(listDiagrams(text)[0]).toMatchObject({ heading: null, summary: 'A -> B' });
    const headed = md('## Real', '', '```text', '# code', '```', '', '```plantuml', 'A -> B', '```');
    expect(listDiagrams(headed)[0]?.heading).toBe('Real');
  });

  it('summarises the first source line after the start line, shortened, and none for an empty block', () => {
    const long = `Alice -> Bob : ${'x'.repeat(80)}`;
    const text = md('```plantuml', '@startuml', '', long, '@enduml', '```', '', '```plantuml', '```');
    const [first, empty] = listDiagrams(text);
    expect(first?.summary).toHaveLength(60);
    expect(first?.summary?.endsWith('…')).toBe(true);
    expect(first?.title).toBeNull();
    expect(empty).toMatchObject({ name: null, line: 7, kind: null, title: null, summary: null });
  });
});
