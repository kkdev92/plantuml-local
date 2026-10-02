import { describe, expect, it } from 'vitest';

import { TEMPLATES } from '../../src/language/completion';
import { templatePlace } from '../../src/language/templates';

const { kind, diagram } = TEMPLATES[0]!;
const fenced = `\`\`\`plantuml \${1:${kind}-diagram}\n${diagram}\n\`\`\``;
const markdown = (text: string, line: number): ReturnType<typeof templatePlace> =>
  templatePlace(text, line, false, kind, diagram);
const plantUml = (text: string, line: number): ReturnType<typeof templatePlace> =>
  templatePlace(text, line, true, kind, diagram);

describe('templatePlace in a Markdown document', () => {
  it('puts a whole block on the empty line of the cursor, or on the line after its line, apart from the text', () => {
    const text = '# Title\n\nSome text\n';

    expect(markdown(text, 1)).toEqual({ kind: 'insert', line: 1, character: 0, text: `\n${fenced}\n` });
    expect(markdown(text, 2)).toEqual({ kind: 'insert', line: 3, character: 0, text: `\n${fenced}\n` });
    expect(markdown('# Title\n\n\nSome text\n', 2)).toEqual({ kind: 'insert', line: 2, character: 0, text: `${fenced}\n` });
    // After the last line, when the document does not end with a line break.
    expect(markdown('Some text', 0)).toEqual({ kind: 'insert', line: 0, character: 9, text: `\n\n${fenced}` });
  });

  it('keeps a template in the quote the cursor is in', () => {
    const place = markdown('> quoted\n> \n', 1);

    expect(place).toMatchObject({ kind: 'insert', line: 1, character: 0 });
    const lines = (place as { text: string }).text.split('\n').slice(0, -1);
    expect(lines.every((line) => line.startsWith('>'))).toBe(true);
    // Apart from the quoted text, by a line of the quote.
    expect(lines.slice(0, 2)).toEqual(['>', '> ```plantuml ${1:sequence-diagram}']);
  });

  it('keeps a template in the list item the cursor is in, lined up with its text', () => {
    const inItem = (prefix: string): string => fenced.replace(/^/gm, prefix);

    // On an item's first line, its marker counts as indentation.
    expect(markdown('- item\n', 0)).toEqual({ kind: 'insert', line: 1, character: 0, text: `\n${inItem('  ')}\n` });
    expect(markdown('1. one\n', 0)).toEqual({ kind: 'insert', line: 1, character: 0, text: `\n${inItem('   ')}\n` });
    expect(markdown('1. one\n   - two\n', 1)).toEqual({ kind: 'insert', line: 2, character: 0, text: `\n${inItem('     ')}\n` });
    expect(markdown('> - item\n', 0)).toEqual({ kind: 'insert', line: 1, character: 0, text: `>\n${inItem('>   ')}\n` });
    // Five spaces after the marker make the item's text code, where no diagram starts.
    expect(markdown('-     code\n', 0)).toEqual({ kind: 'refused', reason: 'elsewhere' });
  });

  it('fills an empty block with the diagram alone', () => {
    expect(markdown('```plantuml\n```\n', 0)).toEqual({ kind: 'insert', line: 1, character: 0, text: `${diagram}\n` });
    expect(markdown('```plantuml\n\n```\n', 1)).toEqual({ kind: 'insert', line: 2, character: 0, text: `${diagram}\n` });
  });

  it('offers a block that holds a diagram a new block after it', () => {
    expect(markdown('```plantuml\nA -> B\n```\nafter\n', 1)).toEqual({
      kind: 'after',
      line: 3,
      character: 0,
      text: `\n${fenced}\n\n`,
    });
  });

  it('refuses a block without its end, another language and an HTML comment', () => {
    expect(markdown('```plantuml\nA -> B\n', 1)).toEqual({ kind: 'refused', reason: 'diagram' });
    expect(markdown('```js\nlet a;\n```\n', 1)).toEqual({ kind: 'refused', reason: 'elsewhere' });
    expect(markdown('<!--\ncomment\n-->\n', 1)).toEqual({ kind: 'refused', reason: 'elsewhere' });
  });
});

describe('templatePlace in a PlantUML file', () => {
  const file = '@startuml\nA -> B\n@enduml\n\n@startuml\nC -> D\n@enduml\n';

  it('puts the diagram between diagrams, apart from them', () => {
    expect(plantUml(file, 3)).toEqual({ kind: 'insert', line: 3, character: 0, text: `\n${diagram}\n` });
    expect(plantUml('', 0)).toEqual({ kind: 'insert', line: 0, character: 0, text: `${diagram}\n` });
  });

  it('refuses a diagram and a comment', () => {
    expect(plantUml(file, 1)).toEqual({ kind: 'refused', reason: 'diagram' });
    expect(plantUml("' a comment\n", 0)).toEqual({ kind: 'refused', reason: 'elsewhere' });
  });
});
