import { describe, expect, it } from 'vitest';

import { declarations, type Declaration } from '../../src/language/symbols';

interface Tree {
  name: string;
  detail?: string;
  keyword: string;
  lines: [number, number];
  children?: Tree[];
}

/** The declarations of a file given as lines, without the empty parts. */
function outline(lines: readonly string[]): Tree[] {
  const tree = (declared: Declaration): Tree => ({
    name: declared.name,
    ...(declared.detail === '' ? {} : { detail: declared.detail }),
    keyword: declared.keyword,
    lines: [declared.start, declared.end],
    ...(declared.children.length === 0 ? {} : { children: declared.children.map(tree) }),
  });
  return declarations(lines.join('\n')).map(tree);
}

describe('declarations', () => {
  it('lists each diagram, named by its id or by its start line, and not the data of a YAML one', () => {
    expect(
      outline([
        '@startuml(id=orders)',
        'participant A',
        '@enduml',
        '',
        '@startuml',
        'class B',
        '@enduml',
        '@startyaml',
        'class Foo: bar',
        '@endyaml',
      ])
    ).toEqual([
      {
        name: 'orders',
        detail: '@startuml',
        keyword: 'diagram',
        lines: [0, 2],
        children: [{ name: 'A', keyword: 'participant', lines: [1, 1] }],
      },
      { name: '@startuml', keyword: 'diagram', lines: [4, 6], children: [{ name: 'B', keyword: 'class', lines: [5, 5] }] },
      { name: '@startyaml', keyword: 'diagram', lines: [7, 9] },
    ]);
  });

  it('names a declaration by its alias, with the name the diagram shows as the detail', () => {
    expect(
      outline([
        '@startuml',
        'participant "Web App" as App',
        'participant Api as "Public API"',
        'actor Alice as A',
        'participant "Long Name"',
        'database DB #red',
        'create participant Late',
        '@enduml',
      ])[0]?.children
    ).toEqual([
      { name: 'App', detail: 'Web App', keyword: 'participant', lines: [1, 1] },
      { name: 'Api', detail: 'Public API', keyword: 'participant', lines: [2, 2] },
      { name: 'A', detail: 'Alice', keyword: 'actor', lines: [3, 3] },
      { name: 'Long Name', keyword: 'participant', lines: [4, 4] },
      { name: 'DB', keyword: 'database', lines: [5, 5] },
      { name: 'Late', keyword: 'participant', lines: [6, 6] },
    ]);
  });

  it('leaves out names in relations, comments and notes, and what a procedure declares', () => {
    expect(
      outline([
        '!procedure $make()',
        '  class Inner',
        '!endprocedure',
        '@startuml',
        'A --> B',
        "' class Commented",
        "/'",
        'class InBlockComment',
        "'/",
        'note left of A',
        'class InNote',
        'end note',
        '$make()',
        'class Real',
        '@enduml',
      ])
    ).toEqual([
      { name: '@startuml', keyword: 'diagram', lines: [3, 14], children: [{ name: 'Real', keyword: 'class', lines: [13, 13] }] },
    ]);
  });

  it('puts what a { … } body declares under the declaration it belongs to', () => {
    expect(
      outline([
        '@startuml',
        'package P {',
        '  class C',
        '  namespace N {',
        '    interface I',
        '  }',
        '}',
        'rectangle R {',
        '  class D',
        '}',
        'class E {',
        '  +field : int',
        '}',
        '@enduml',
      ])[0]?.children
    ).toEqual([
      {
        name: 'P',
        keyword: 'package',
        lines: [1, 6],
        children: [
          { name: 'C', keyword: 'class', lines: [2, 2] },
          { name: 'N', keyword: 'namespace', lines: [3, 5], children: [{ name: 'I', keyword: 'interface', lines: [4, 4] }] },
        ],
      },
      // `rectangle` is not one of the keywords read, so its body sits under the diagram.
      { name: 'D', keyword: 'class', lines: [8, 8] },
      { name: 'E', keyword: 'class', lines: [10, 12] },
    ]);
  });

  it('reads the names of each kind of diagram', () => {
    expect(
      outline([
        '@startuml',
        'usecase (Place order) as UC1',
        'component [Web Server] as WS',
        'actor :Customer: as Cu',
        'node "Server 1" as S1',
        'abstract class Shape',
        'enum Color',
        'annotation Marker',
        'state "Waiting for payment" as Waiting {',
        '  state Paid',
        '}',
        '@enduml',
      ])[0]?.children
    ).toEqual([
      { name: 'UC1', detail: 'Place order', keyword: 'usecase', lines: [1, 1] },
      { name: 'WS', detail: 'Web Server', keyword: 'component', lines: [2, 2] },
      { name: 'Cu', detail: 'Customer', keyword: 'actor', lines: [3, 3] },
      { name: 'S1', detail: 'Server 1', keyword: 'node', lines: [4, 4] },
      { name: 'Shape', keyword: 'abstract', lines: [5, 5] },
      { name: 'Color', keyword: 'enum', lines: [6, 6] },
      { name: 'Marker', keyword: 'annotation', lines: [7, 7] },
      {
        name: 'Waiting',
        detail: 'Waiting for payment',
        keyword: 'state',
        lines: [8, 10],
        children: [{ name: 'Paid', keyword: 'state', lines: [9, 9] }],
      },
    ]);
  });

  it('ends a diagram, and a body, left open where the next diagram starts', () => {
    expect(outline(['@startuml', 'package P {', '  class C', '@startuml', 'class D'])).toEqual([
      {
        name: '@startuml',
        keyword: 'diagram',
        lines: [0, 2],
        children: [{ name: 'P', keyword: 'package', lines: [1, 2], children: [{ name: 'C', keyword: 'class', lines: [2, 2] }] }],
      },
      { name: '@startuml', keyword: 'diagram', lines: [3, 4], children: [{ name: 'D', keyword: 'class', lines: [4, 4] }] },
    ]);
  });

  it('lists what a file without diagrams declares, and nothing for plain text', () => {
    expect(outline(['class Shared', 'A -> B'])).toEqual([{ name: 'Shared', keyword: 'class', lines: [0, 0] }]);
    expect(outline(['A -> B', 'B -> C : class X'])).toEqual([]);
  });
});
