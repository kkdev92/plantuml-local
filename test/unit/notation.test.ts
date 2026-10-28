import { describe, expect, it } from 'vitest';

import { notationLabel, unsupportedKinds, unsupportedNotations, type UnsupportedNotation } from '../../src/core/notation';

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

describe('unsupportedNotations and images', () => {
  // The first ten base64 characters of every PNG, then a few more.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91Jpz';
  const imageLines = (...lines: string[]): number[] =>
    unsupportedNotations(md('@startuml', ...lines, '@enduml'))
      .filter((use) => use.kind === 'image')
      .map((use) => use.line);

  it.each([
    ['a file', 'A -> B : see <img:pic.png> here'],
    ['a file after a space', 'A -> B : see <img pic.png> here'],
    ['a file with src=', 'A -> B : see <img src="pic.png"> here'],
    ['a file with src= and spaces', 'A -> B : see <img src = "pic.png"> here'],
    ['a file with a scale', 'A -> B : see <img:pic.png{scale=0.5}> here'],
    ['a URL', 'A -> B : <img:https://example.com/pic.png>'],
    ['mg in another case', 'A -> B : <iMG:pic.png>'],
    ['inline JPEG', 'A -> B : <img:data:image/jpeg;base64,/9j/4AAQSkZJRg==>'],
    ['inline SVG', 'A -> B : <img:data:image/svg+xml;base64,PHN2Zz4=>'],
    ['data labelled PNG that is not one', 'A -> B : <img:data:image/png;base64,/9j/4AAQSkZJRg==>'],
    ['C4 sprite, quoted', 'Person(p, "Customer", $sprite="img:pic.png")'],
    ['C4 sprite, in single quotes', "Person(p, \"Customer\", $sprite='img:pic.png')"],
    ['C4 sprite, unquoted', 'Person(p, "Customer", $sprite=img:pic.png)'],
    ['C4 sprite, by position', 'Person(p, "Customer", "Buys", "img:https://example.com/u.png")'],
    ['C4 sprite, with a scale', 'Person(p, "Customer", $sprite = "img:pic.png{scale=0.5}")'],
    ['a variable C4 is given', '!$sprite = "img:pic.png"'],
    ['an image in a C4 label', 'Person(p, "<img:pic.png> Customer")'],
    ['a tag', 'AddElementTag("v", $sprite="img:pic.png", $legendText="tagged")'],
  ])('finds an image the engine does not draw: %s', (_what, line) => {
    expect(imageLines(line)).toEqual([1]);
  });

  it.each([
    ['inline PNG', `A -> B : see <img:${PNG}> here`],
    ['inline PNG with src= and quotes', `A -> B : <img src="${PNG}">`],
    ['inline PNG with a scale', `A -> B : <img:${PNG}{scale=2}>`],
    ['inline PNG as a C4 sprite', `Person(p, "Customer", $sprite="img:${PNG}")`],
    ['inline PNG as a C4 sprite with a scale', `Person(p, "Customer", $sprite="img:${PNG}{scale=0.5}")`],
    ['<img in another case, which is text', 'A -> B : <Img:pic.png> <IMG:pic.png>'],
    ['an image never closed', 'A -> B : <img:pic.png here'],
    ['braces where the image goes', 'A -> B : <img:{pic}.png>'],
    ['img: inside a label', 'note right of B : "see img: here"'],
    ['a sprite C4 does not take for an image', 'Person(p, "Customer", $sprite="IMG:pic.png")'],
  ])('leaves alone what the engine draws: %s', (_what, line) => {
    expect(imageLines(line)).toEqual([]);
  });

  it('finds a line with an inline PNG and an image it does not draw, once', () => {
    expect(imageLines(`A -> B : <img:${PNG}> <img:pic.png> <img:other.png>`)).toEqual([1]);
  });

  it('skips comments and the rows of a sprite', () => {
    expect(imageLines("' A -> B : <img:pic.png>", "/'", '<img:pic.png>', "'/", 'A -> B')).toEqual([]);
    expect(imageLines('sprite $s [16x16/16] {', '<img:pic.png>', '}', 'A -> B : <$s>')).toEqual([]);
  });

  it('finds images in any diagram, not only UML ones', () => {
    expect(unsupportedNotations(md('@startmindmap', '* <img:pic.png>', '@endmindmap'))).toEqual([{ kind: 'image', line: 1 }]);
  });
});

describe('unsupportedKinds', () => {
  it('names each kind once, formulas first', () => {
    expect(
      unsupportedKinds(md('@startuml', 'note left', '{{', '}}', 'end note', 'A -> B : <latex>x</latex> <math>y</math> <math>z</math>', '@enduml'))
    ).toEqual(['math', 'latex', 'embedded']);
    expect(unsupportedKinds(md('@startuml', 'A -> B : <img:a.png>', 'A -> B : <img:b.png> <math>x</math>', '@enduml'))).toEqual(['math', 'image']);
    expect(unsupportedKinds(md('@startuml', 'A -> B', '@enduml'))).toEqual([]);
  });
});

describe('notationLabel', () => {
  const labels = { formula: (tag: string): string => `formula ${tag}`, embeddedDiagram: 'embedded', image: 'image' };

  it('says what each kind leaves out', () => {
    expect(['math', 'latex', 'embedded', 'image'].map((kind) => notationLabel(kind as UnsupportedNotation, labels))).toEqual([
      'formula <math>',
      'formula <latex>',
      'embedded',
      'image',
    ]);
  });
});
