import { describe, expect, it } from 'vitest';

import { diagramShape } from '../../src/core/shape';

const md = (...lines: string[]): string => lines.join('\n');

describe('diagramShape', () => {
  it('passes a single diagram through unchanged', () => {
    const source = md('@startuml', 'Alice -> Bob', '@enduml');
    expect(diagramShape(source)).toEqual({ kind: 'drawable', source, addedEnd: null });
  });

  it('passes a block without start or end lines through, as before', () => {
    const source = 'Alice -> Bob';
    expect(diagramShape(source)).toEqual({ kind: 'drawable', source, addedEnd: null });
  });

  it('tells a block holding two diagrams', () => {
    expect(diagramShape(md('@startuml', 'A -> B', '@enduml', '@startuml', 'C -> D', '@enduml'))).toEqual({
      kind: 'several',
    });
  });

  it('does not count a diagram commented out, as the engine does not', () => {
    const blockComment = md('@startuml', 'A -> B', '@enduml', "/'", '@startuml', 'C -> D', '@enduml', "'/");
    const lineComments = md('@startuml', 'A -> B', '@enduml', "' @startuml", "' C -> D", "' @enduml");
    expect(diagramShape(blockComment).kind).toBe('drawable');
    expect(diagramShape(lineComments).kind).toBe('drawable');
  });

  it('tells a diagram split into pages, but not newpage in a comment or as a word', () => {
    expect(diagramShape(md('@startuml', 'A -> B', 'newpage', 'C -> D', '@enduml'))).toEqual({ kind: 'pages' });
    expect(diagramShape(md('@startuml', 'A -> B', 'newpage The second page', '@enduml'))).toEqual({ kind: 'pages' });
    expect(diagramShape(md('@startuml', "/'", 'newpage', "'/", 'A -> B : newpage', '@enduml')).kind).toBe(
      'drawable'
    );
  });

  it('adds the end line a diagram lacks, matching its start', () => {
    expect(diagramShape(md('@startuml', 'A -> B'))).toEqual({
      kind: 'drawable',
      source: md('@startuml', 'A -> B', '@enduml'),
      addedEnd: '@enduml',
    });
    expect(diagramShape(md('@startmindmap', '* root'))).toMatchObject({ addedEnd: '@endmindmap' });
    expect(diagramShape(md('\\startuml', 'A -> B'))).toMatchObject({ addedEnd: '\\enduml' });
  });
});
