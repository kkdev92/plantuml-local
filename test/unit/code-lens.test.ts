import { describe, expect, it } from 'vitest';

import { findFileDiagrams, findPlantUmlBlocks } from '../../src/export/blocks';
import { DIAGRAM_ACTIONS, diagramLenses, diagramTarget, targetBlock, type DiagramTarget } from '../../src/language/code-lens';

const lines = (...rows: string[]): string => rows.join(String.fromCharCode(10));

const FLOWS = lines('@startuml(id=first)', 'A -> B', '@enduml', '', '@startuml(id=second)', 'C -> D', '@enduml', '');

describe('diagramLenses', () => {
  it('offers the three actions above each diagram of a PlantUML file', () => {
    const lenses = diagramLenses(findFileDiagrams(FLOWS, 'flows'), true);
    expect(lenses.map((lens) => [lens.block.openLine, lens.block.name, lens.actions])).toEqual([
      [0, 'first', ['preview', 'svg', 'png']],
      [4, 'second', ['preview', 'svg', 'png']],
    ]);
  });

  it('offers nothing in a PlantUML file with no start line, whose lines are meant to be included', () => {
    expect(diagramLenses(findFileDiagrams(lines('!procedure $x()', 'A -> B', '!endprocedure'), 'shared'), true)).toEqual([]);
    // A start line after a comment line is one.
    const commented = diagramLenses(findFileDiagrams(lines("' flows", '@startuml', 'A -> B', '@enduml'), 'flows'), true);
    expect(commented.map((lens) => lens.block.openLine)).toEqual([1]);
  });

  it('offers the three actions above a Markdown block, and the preview only above one holding several diagrams', () => {
    const text = lines(
      '# Doc',
      '```plantuml orders',
      '@startuml',
      'A -> B',
      '@enduml',
      '```',
      '',
      '> ```puml',
      '> @startuml',
      '> A -> B',
      '> @enduml',
      '> @startuml',
      '> C -> D',
      '> @enduml',
      '> ```'
    );
    expect(diagramLenses(findPlantUmlBlocks(text), false).map((lens) => [lens.block.openLine, lens.actions])).toEqual([
      [1, ['preview', 'svg', 'png']],
      [7, ['preview']],
    ]);
  });
});

describe('diagramTarget', () => {
  const target: DiagramTarget = { action: 'svg', uri: 'file:///c/flows.puml', version: 3, line: 4, name: 'second' };

  it('takes a target as a lens hands it, with any of the actions', () => {
    for (const action of DIAGRAM_ACTIONS) {
      expect(diagramTarget({ ...target, action })).toEqual({ ...target, action });
    }
    expect(diagramTarget({ ...target, name: null })).toEqual({ ...target, name: null });
  });

  it('refuses anything else', () => {
    const others: unknown[] = [
      undefined,
      null,
      'svg',
      4,
      [],
      {},
      { ...target, action: 'delete' },
      { ...target, uri: 7 },
      { ...target, version: -1 },
      { ...target, version: 1.5 },
      { ...target, line: '4' },
      { ...target, name: 7 },
      { ...target, name: undefined },
    ];
    for (const value of others) {
      expect(diagramTarget(value), JSON.stringify(value)).toBeNull();
    }
  });
});

describe('targetBlock', () => {
  const blocks = findFileDiagrams(FLOWS, 'flows');
  const second: DiagramTarget = { action: 'svg', uri: 'file:///c/flows.puml', version: 1, line: 4, name: 'second' };

  it('takes the diagram on the line while the document is as it was', () => {
    expect(targetBlock(blocks, second, 1)?.name).toBe('second');
    expect(targetBlock(blocks, { ...second, line: 3 }, 1)).toBeNull();
  });

  it('finds a named diagram again once the document changed and its lines moved', () => {
    const grown = findFileDiagrams(FLOWS.replace('A -> B', lines('A -> B', 'B -> A')), 'flows');
    expect(targetBlock(grown, second, 2)).toMatchObject({ name: 'second', openLine: 5 });
    // The only diagram of a file is named after the file, so it is found again too.
    const only = findFileDiagrams(lines('', '@startuml', 'A -> B', '@enduml'), 'flows');
    expect(targetBlock(only, { ...second, line: 0, name: 'flows' }, 2)?.openLine).toBe(1);
  });

  it('finds no diagram once the document changed when the name is gone or shared, or there was none', () => {
    expect(targetBlock(findFileDiagrams(FLOWS.replace('(id=second)', '(id=third)'), 'flows'), second, 2)).toBeNull();
    expect(targetBlock(findFileDiagrams(FLOWS.replace('(id=first)', '(id=second)'), 'flows'), second, 2)).toBeNull();
    expect(targetBlock(blocks, { ...second, name: null }, 2)).toBeNull();
  });
});
