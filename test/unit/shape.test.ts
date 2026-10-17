import { describe, expect, it } from 'vitest';

import { diagramShape } from '../../src/core/shape';

const md = (...lines: string[]): string => lines.join('\n');

describe('diagramShape', () => {
  it('passes a single diagram through unchanged', () => {
    const source = md('@startuml', 'Alice -> Bob', '@enduml');
    expect(diagramShape(source)).toEqual({ kind: 'drawable', source, addedEnd: null, startLine: 0, before: null });
  });

  it('passes a block without start or end lines through, as before', () => {
    const source = 'Alice -> Bob';
    expect(diagramShape(source)).toEqual({ kind: 'drawable', source, addedEnd: null, startLine: null, before: null });
  });

  it('tells a block holding two diagrams, at the second start line', () => {
    expect(diagramShape(md('@startuml', 'A -> B', '@enduml', '@startuml', 'C -> D', '@enduml'))).toEqual({
      kind: 'several',
      line: 3,
    });
  });

  it('does not count a diagram commented out, as the engine does not', () => {
    const blockComment = md('@startuml', 'A -> B', '@enduml', "/'", '@startuml', 'C -> D', '@enduml', "'/");
    const lineComments = md('@startuml', 'A -> B', '@enduml', "' @startuml", "' C -> D", "' @enduml");
    expect(diagramShape(blockComment).kind).toBe('drawable');
    expect(diagramShape(lineComments).kind).toBe('drawable');
  });

  it('tells a diagram split into pages, at the newpage line, but not newpage in a comment or as a word', () => {
    expect(diagramShape(md('@startuml', 'A -> B', 'newpage', 'C -> D', '@enduml'))).toEqual({ kind: 'pages', line: 2 });
    expect(diagramShape(md('@startuml', 'A -> B', 'newpage The second page', '@enduml'))).toEqual({
      kind: 'pages',
      line: 2,
    });
    expect(diagramShape(md('@startuml', "/'", 'newpage', "'/", 'A -> B : newpage', '@enduml')).kind).toBe(
      'drawable'
    );
  });

  it('adds the end line a diagram lacks, matching its start', () => {
    expect(diagramShape(md("' a title comment", '@startuml', 'A -> B'))).toEqual({
      kind: 'drawable',
      source: md("' a title comment", '@startuml', 'A -> B', '@enduml'),
      addedEnd: '@enduml',
      startLine: 1,
      before: null,
    });
    expect(diagramShape(md('@startmindmap', '* root'))).toMatchObject({ addedEnd: '@endmindmap' });
    expect(diagramShape(md('\\startuml', 'A -> B'))).toMatchObject({ addedEnd: '\\enduml' });
  });

  it('notes the first line above the start line, which the engine leaves out', () => {
    expect(diagramShape(md('title Before', '', '@startuml', 'A -> B', '@enduml'))).toMatchObject({
      kind: 'drawable',
      before: { line: 0, start: '@startuml' },
    });
    expect(diagramShape(md('', "' a comment", "/' a", "block '/", '!$x = 1', '@startmindmap', '* root'))).toMatchObject({
      before: { line: 4, start: '@startmindmap' },
    });
    // Blank lines and comments are nothing to leave out. Without a start line
    // the engine keeps every line, and it reads no start line with `\`.
    expect(diagramShape(md('', "' a comment", '@startuml', 'A -> B', '@enduml'))).toMatchObject({ before: null });
    expect(diagramShape(md('title Alone', 'A -> B'))).toMatchObject({ before: null });
    expect(diagramShape(md('title Before', '\\startuml', 'A -> B', '\\enduml'))).toMatchObject({ before: null });
  });
});
