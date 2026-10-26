import { describe, expect, it } from 'vitest';

import { unsupportedKinds, unsupportedNotations } from '../../src/core/notation';

const md = (...lines: string[]): string => lines.join(String.fromCharCode(10));

describe('unsupportedNotations', () => {
  it('finds a formula wherever it stands, on its line', () => {
    expect(
      unsupportedNotations(md('@startuml', 'Alice -> Bob : x <math>a^2</math>', 'note left', '<latex>b</latex>', 'end note', '@enduml'))
    ).toEqual([
      { kind: 'math', line: 1 },
      { kind: 'latex', line: 3 },
    ]);
    expect(unsupportedNotations(md('@startjson', '{"a": "<math>x</math>"}', '@endjson'))).toEqual([{ kind: 'math', line: 1 }]);
    expect(unsupportedNotations(md('@startmindmap', '* a', '** <math>x</math>', '@endmindmap'))).toEqual([{ kind: 'math', line: 2 }]);
  });

  it('takes a line starting with {{ in a UML diagram as an embedded diagram: in a note, a legend, a class body', () => {
    expect(unsupportedNotations(md('@startuml', 'A -> B', 'note left', 'text', '{{', 'C -> D', '}}', 'end note', '@enduml'))).toEqual([
      { kind: 'embedded', line: 4 },
    ]);
    expect(unsupportedNotations(md('@startuml', 'legend', '{{', 'C -> D', '}}', 'endlegend', '@enduml'))).toEqual([{ kind: 'embedded', line: 2 }]);
    // Without a start line, the engine reads a UML diagram.
    expect(unsupportedNotations(md('class Box {', '{{', 'C -> D', '}}', '}'))).toEqual([{ kind: 'embedded', line: 1 }]);
  });

  it('leaves alone what the engine draws: braces in Salt, {{x}} in a label, comments, the rows of a sprite', () => {
    expect(unsupportedNotations(md('@startsalt', '{', 'a', '{{', 'b', '}}', '}', '@endsalt'))).toEqual([]);
    expect(unsupportedNotations(md('@startuml', 'A -> B : {{x}}', '@enduml'))).toEqual([]);
    expect(unsupportedNotations(md('@startuml', "' <math>x</math>", "/'", '{{', "'/", 'A -> B', '@enduml'))).toEqual([]);
    expect(unsupportedNotations(md('@startuml', 'sprite $s [16x16/16] {', 'FFFF', '{{FF', '}', 'A -> B : <$s>', '@enduml'))).toEqual([]);
    expect(unsupportedNotations(md('@startjson', '{{', '@endjson'))).toEqual([]);
  });
});

describe('unsupportedKinds', () => {
  it('names each kind once, formulas first', () => {
    expect(
      unsupportedKinds(md('@startuml', 'note left', '{{', '}}', 'end note', 'A -> B : <latex>x</latex> <math>y</math> <math>z</math>', '@enduml'))
    ).toEqual(['math', 'latex', 'embedded']);
    expect(unsupportedKinds(md('@startuml', 'A -> B', '@enduml'))).toEqual([]);
  });
});
