import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { protect } from '../../src/language/protected';
import { aliasesOf, WORD_PATTERN, wordAt, wordsOf } from '../../src/language/words';

const aliases = (lines: readonly string[]): { name: string; display: string }[] =>
  aliasesOf(lines, protect(lines, false));
const words = (lines: readonly string[]): string[] => wordsOf(protect(lines, false));

describe('WORD_PATTERN', () => {
  it("is VS Code's default word definition", () => {
    // DEFAULT_WORD_REGEXP in src/vs/editor/common/core/wordHelper.ts (VS Code 1.143.1), as written in its comment.
    const vscode = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;

    expect(WORD_PATTERN.source).toBe(vscode.source);
    expect(WORD_PATTERN.flags).toBe(vscode.flags);
  });

  it('is the one the PlantUML language uses: its configuration sets no word pattern of its own', () => {
    const configuration = JSON.parse(readFileSync(join(__dirname, '../../language-configuration.json'), 'utf8')) as object;

    expect(configuration).not.toHaveProperty('wordPattern');
  });
});

describe('wordAt', () => {
  it('finds the word around the cursor, from where it starts to where it ends', () => {
    expect(wordAt('A -> Server', 7)).toEqual({ word: 'Server', start: 5, end: 11 });
    expect(wordAt('A -> Server', 11)).toEqual({ word: 'Server', start: 5, end: 11 });
    expect(wordAt('A -> Server', 5)).toEqual({ word: 'Server', start: 5, end: 11 });
    expect(wordAt('注文係 -> B', 2)).toEqual({ word: '注文係', start: 0, end: 3 });
  });

  it('gives an empty word at the cursor between separators', () => {
    expect(wordAt('A -> Server', 4)).toEqual({ word: '', start: 4, end: 4 });
    expect(wordAt('', 0)).toEqual({ word: '', start: 0, end: 0 });
  });
});

describe('wordsOf', () => {
  it('lists the words of the code once each, in order, not the numbers, as VS Code leaves them out', () => {
    expect(words(['A -> B : hello', '@100', 'A -> B : 1.5 0x1F 1e3 -2 Infinity 1a', 'B -> A : hello'])).toEqual([
      'A',
      'B',
      'hello',
      '1a',
    ]);
  });

  it('stops past as many words as VS Code lists', () => {
    const line = Array.from({ length: 10_005 }, (_, index) => `w${String(index)}`).join(' ');

    expect(words([line])).toHaveLength(10_001);
  });

  it('takes no word from protected text, and cuts words of any script', () => {
    expect(words(['participant "注文係" as A', "' commented", 'note left : noted', '利用者 -> A'])).toEqual([
      'participant',
      'as',
      'A',
      'note',
      'left',
      '利用者',
    ]);
  });
});

describe('aliasesOf', () => {
  it('takes the unquoted side of `as` for the alias and the quoted side for what is shown', () => {
    expect(
      aliases([
        'participant "注文係" as A',
        'participant App as "Web App"',
        'create participant "Late" as late',
        'abstract class "Long name" as LN',
        'rectangle "Shop" as shop {',
        'concise "Web User" as WU',
        'note "some text" as N1',
      ])
    ).toEqual([
      { name: 'A', display: '注文係' },
      { name: 'App', display: 'Web App' },
      { name: 'late', display: 'Late' },
      { name: 'LN', display: 'Long name' },
      { name: 'shop', display: 'Shop' },
      { name: 'WU', display: 'Web User' },
      { name: 'N1', display: 'some text' },
    ]);
  });

  it('reads the bracketed names of description diagrams as what is shown', () => {
    expect(aliases(['component [Web] as web', '(Place order) as place', ':User: as u'])).toEqual([
      { name: 'web', display: 'Web' },
      { name: 'place', display: 'Place order' },
      { name: 'u', display: 'User' },
    ]);
  });

  it('leaves out a declaration whose quotes do not tell the alias apart, and an alias declared twice over', () => {
    expect(aliases(['participant Server as B'])).toEqual([]);
    expect(aliases(['usecase "One" as u1', 'usecase "Two" as u1', 'actor "Same" as a', 'actor "Same" as a'])).toEqual([
      { name: 'a', display: 'Same' },
    ]);
  });

  it('takes no alias from a message, a comment or a note', () => {
    expect(
      aliases(['A -> B : call "foo" as bar', "' participant \"x\" as y", 'note left', 'participant "x" as z', 'end note'])
    ).toEqual([]);
  });
});
