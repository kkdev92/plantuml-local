/**
 * The words of a diagram, cut as VS Code cuts them for its own word-based
 * suggestions, and the aliases its declarations give names to.
 *
 * VS Code offers the words of every open document of the language
 * (`editor.wordBasedSuggestions`), so the names of one diagram show in
 * another, and in Markdown the words of the prose show in a diagram. The
 * completion offers the words of the diagram at the cursor instead, cut and
 * left out the way VS Code does it (`$textualSuggest` in
 * src/vs/editor/common/services/editorWebWorker.ts, VS Code 1.143.1): every
 * match of the word pattern on each line, once, without the word at the
 * cursor or any word that reads as a number. Words in protected text are
 * left out (src/language/protected.ts).
 */

import { declaredAlias } from './symbols';
import type { CodeLine } from './protected';

/** USUAL_WORD_SEPARATORS in src/vs/editor/common/core/wordHelper.ts. */
const SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';

/**
 * VS Code's default word pattern (DEFAULT_WORD_REGEXP, built as
 * createWordRegExp builds it): a decimal number, or a run of what is
 * neither a separator nor white space. The PlantUML language uses it, as
 * its configuration sets no word pattern of its own.
 */
export const WORD_PATTERN = new RegExp(
  `(-?\\d*\\.\\d\\w*)|([^${[...SEPARATORS].map((separator) => `\\${separator}`).join('')}\\s]+)`,
  'g'
);

/** The most words VS Code lists (`_suggestionsLimit`). */
const LIMIT = 10_000;

/**
 * The word around column `column` of `text`, and the columns it spans: the
 * first match that starts at or before the column and ends at or after it,
 * as getWordAtText finds it. An empty word at the column when there is none.
 */
export function wordAt(text: string, column: number): { word: string; start: number; end: number } {
  for (const match of text.matchAll(WORD_PATTERN)) {
    const end = match.index + match[0].length;
    if (match.index <= column && end >= column) {
      return { word: match[0], start: match.index, end };
    }
  }
  return { word: '', start: column, end: column };
}

/** The words of the code of `lines`, each once, in the order they first appear. */
export function wordsOf(lines: readonly CodeLine[]): string[] {
  const words = new Set<string>();
  for (const { code, whole } of lines) {
    if (whole) {
      continue;
    }
    for (const [word] of code.matchAll(WORD_PATTERN)) {
      if (Number.isNaN(Number(word))) {
        words.add(word);
        if (words.size > LIMIT) {
          return [...words];
        }
      }
    }
  }
  return [...words];
}

/** A keyword before a declaration's names, and the space after it. */
const KEYWORD = /[\p{L}\p{N}_]+\s+/uy;

/**
 * The aliases `lines` declare, each with the name the diagram shows for it,
 * in the order they are first declared: the identifier on one side of `as`
 * with a quoted or bracketed name on the other, after the keywords that
 * start the line (`participant "Web" as W`, `[Web] as W`). `code` tells
 * the protected text of the lines apart; a line that is all protected text
 * declares nothing. An alias declared with two names shown is left out, as
 * is one that VS Code would cut into more than one word: the suggestion
 * replaces the word at the cursor.
 */
export function aliasesOf(lines: readonly string[], code: readonly CodeLine[]): { name: string; display: string }[] {
  const displays = new Map<string, Set<string>>();
  lines.forEach((line, index) => {
    if (code[index]?.whole !== false) {
      return;
    }
    // The names follow the keywords, as many as there are: try after each.
    KEYWORD.lastIndex = line.length - line.trimStart().length;
    for (let at = KEYWORD.lastIndex; ; at = KEYWORD.lastIndex) {
      const declared = declaredAlias(line.slice(at));
      if (declared !== null) {
        if (declared !== 'undecided') {
          displays.set(declared.alias, (displays.get(declared.alias) ?? new Set()).add(declared.display));
        }
        return;
      }
      if (KEYWORD.exec(line) === null) {
        return;
      }
    }
  });
  return [...displays]
    .filter(([name, shown]) => shown.size === 1 && wordAt(name, 0).word === name)
    .map(([name, shown]) => ({ name, display: [...shown][0] ?? '' }));
}
