import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { errorMessage, type MessageLocalizer } from '../../src/core/messages';
import { findFileDiagrams, findPlantUmlBlocks, isValidBlockName } from '../../src/export/blocks';
import { withIncludeReason } from '../../src/includes/describe';

const root = join(__dirname, '../..');
const readJson = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, string>;
const japanese = readJson('l10n/bundle.l10n.ja.json');
const englishManifest = readJson('package.nls.json');
const japaneseManifest = readJson('package.nls.ja.json');
const placeholders = (text: string): string[] => [...text.matchAll(/\{\d+\}/g)].map(([value]) => value).sort();
const format = (text: string, args: string[]): string =>
  text.replace(/\{(\d+)\}/g, (placeholder, index: string) => args[Number(index)] ?? placeholder);
const english: MessageLocalizer = { t: (message, ...args) => format(message, args) };
const ja: MessageLocalizer = { t: (message, ...args) => format(japanese[message] ?? message, args) };

function sourceMessages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sourceMessages(path);
    if (!entry.name.endsWith('.ts')) return [];
    const found: string[] = [];
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ['debug', 'info', 'warn', 'error'].includes(node.expression.name.text)
        && /(?:^|\.)(?:log|logger)$/.test(node.expression.expression.getText(source))) {
        const message = node.arguments[0];
        expect(message !== undefined && (ts.isStringLiteral(message) || ts.isTemplateLiteral(message)),
          `${path}: log messages must use localised text`).toBe(false);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't') {
        const message = node.arguments[0];
        expect(message !== undefined && ts.isStringLiteral(message), `${path}: translation key must be literal`).toBe(true);
        if (message !== undefined && ts.isStringLiteral(message)) {
          found.push(message.text);
          for (const match of message.text.matchAll(/\{(\d+)\}/g)) {
            expect(node.arguments.length - 1, message.text).toBeGreaterThan(Number(match[1]));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  });
}

describe('localisation coverage', () => {
  it('has a Japanese translation for every runtime message and no obsolete keys', () => {
    expect(Object.keys(japanese).sort()).toEqual([...new Set(sourceMessages(join(root, 'src')))].sort());
    for (const [message, translated] of Object.entries(japanese)) {
      expect(translated.trim(), message).not.toBe('');
      expect(placeholders(translated), message).toEqual(placeholders(message));
    }
  });

  it('localises every manifest reference in both languages', () => {
    const manifest = readFileSync(join(root, 'package.json'), 'utf8');
    const keys = [...manifest.matchAll(/"%([^%]+)%"/g)].map(([, key]) => key).sort();
    expect(Object.keys(englishManifest).sort()).toEqual(keys);
    expect(Object.keys(japaneseManifest).sort()).toEqual(keys);
    for (const key of keys) {
      expect(englishManifest[key!]?.trim()).not.toBe('');
      expect(japaneseManifest[key!]?.trim()).not.toBe('');
    }
  });

  it('uses the translated command name in refresh instructions', () => {
    for (const [message, translated] of Object.entries(japanese)) {
      if (message.includes('PlantUML Local: Clear Render Cache and Re-render')) {
        expect(translated).toContain(`PlantUML Local: ${japaneseManifest['command.clearCache.title']}`);
      }
    }
  });

  it('provides naming examples that can be copied without including sentence punctuation', () => {
    for (const [message, translated] of Object.entries(japanese)) {
      if (!message.startsWith('Unnamed ')) continue;
      for (const text of [message, translated]) {
        const example = /["「]([^"」]+)["」]/.exec(text)?.[1];
        expect(example, text).toBeDefined();
        const diagrams = example?.startsWith('```')
          ? findPlantUmlBlocks(`${example}\n@startuml\nA -> B\n@enduml\n\`\`\``)
          : findFileDiagrams(`${example}\nA -> B\n@enduml`, 'example');
        const name = diagrams[0]?.name ?? '';
        expect(name).toBe('my-diagram');
        expect(isValidBlockName(name)).toBe(true);
      }
    }
  });
});

describe('renderer error messages', () => {
  it.each([
    'Rendering timed out',
    'Render worker exited',
    'Extension deactivated',
    'PlantUML rendering failed',
    'PlantUML did not return an SVG document',
    'PNG encoding failed',
    'Network access is disabled in the PlantUML render worker (fetch)',
    'Syntax Error? (Assumed diagram type: sequence)',
    'Syntax error!',
    'Your data does not sound like JSON data',
    'No diagram found',
    'Empty description (Assumed diagram type: sequence)',
    'Cannot import',
    'Cannot load theme missing-theme',
    'cannot include <C4/C4_Context>',
    "This syntax is deprecated, you must add <<#pink>> at the end of the line, after the ';'",
    'Diagram not supported by this release of PlantUML',
    'Diagram not supported by this release of PlantUML: "@startdot" is not recognized',
    'java.lang.RuntimeException: Unsupported diagram type',
    'Infinite loop?',
    'For some reason, dot/GraphViz has crashed.',
    'Rendering abandoned after 20 rounds of loading resources; still missing: s20.puml (from C:\\docs\\s19.puml)',
    'cannot include notes.puml',
  ])('explains %s in English and Japanese', (raw) => {
    const en = errorMessage(raw, english);
    const translated = errorMessage(raw, ja);
    expect(en).not.toBe(raw);
    expect(translated).not.toBe(en);
    expect(translated).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    expect(translated).not.toMatch(/\{\d+\}/);
  });

  it('keeps size information without suggesting engine options unavailable to users', () => {
    const raw = 'java.lang.RuntimeException: Diagram too large for browser rendering: 155x10886 (max 8192; override via the maxSvgSize option)';
    expect(errorMessage(raw, english)).toBe('The diagram is 155 × 10886 pixels. The maximum width or height is 8192 pixels. Reduce the diagram size.');
    expect(errorMessage(raw, ja)).toBe('図のサイズは 155 × 10886 ピクセルです。幅・高さはそれぞれ 8192 ピクセルまでに収めてください。');
  });

  it('preserves file paths, theme names, and already translated include reasons', () => {
    expect(errorMessage('cannot include styles/common.puml: ファイルが見つかりません。', ja))
      .toBe('styles/common.puml を読み込めません: ファイルが見つかりません。');
    expect(errorMessage('Cannot load theme ocean in styles: ファイルが見つかりません。', ja))
      .toBe('styles からテーマ ocean を読み込めません: ファイルが見つかりません。');
    // No reason: the engine did not ask for the file, as with !includeurl.
    expect(errorMessage('cannot include C:\\docs\\common.puml', ja))
      .toBe('C:\\docs\\common.puml を読み込めません。ワークスペース内のファイルを !include で指定してください。');
  });

  it('counts the files an engine stopped loading at, without the paths it was missing', () => {
    const raw = 'Rendering abandoned after 20 rounds of loading resources; still missing: s20.puml (from C:\\docs\\s19.puml)';
    expect(errorMessage(raw, english)).toBe(
      'The bundled PlantUML loads the files a diagram includes one at a time and stops after 20. This diagram includes more files than that, counting nested includes. Reduce the number of included files.'
    );
    expect(errorMessage(raw, ja)).toContain('20 個で読み込みを止めます');
    expect(errorMessage(raw, ja)).not.toContain('C:\\docs');
  });

  it('preserves unknown engine and operating system errors verbatim', () => {
    const raw = 'EACCES: permission denied, open /workspace/private.puml';
    expect(errorMessage(raw, ja)).toBe(raw);
    expect(errorMessage(`${raw} (custom.puml, line 7)`, ja)).toBe(`${raw} (custom.puml, line 7)`);
  });

  it('localises known diagram types without relying on English articles', () => {
    const raw = 'Syntax Error? (Assumed diagram type: activity)';
    expect(errorMessage(raw, english)).toBe('Syntax error. Detected diagram type: Activity diagram. Check the syntax for that type.');
    expect(errorMessage(raw, ja)).toContain('「アクティビティ図」');
    expect(errorMessage('Syntax Error? (Assumed diagram type: custom)', ja)).toContain('「custom」');
  });

  it('keeps the location of an error inside an included file', () => {
    const raw = 'Syntax Error? (Assumed diagram type: sequence) (<azure/shared.puml>, line 12)';
    expect(errorMessage(raw, ja)).toBe('図の書き方に誤りがあります。PlantUML は「シーケンス図」として解釈しています。この種類の図で使える構文か確認してください。（<azure/shared.puml> の 12 行目）');
    expect(errorMessage(raw, english)).toContain('(<azure/shared.puml>, line 12)');
  });

  it('keeps both the reason and source location when an include inside another file fails', () => {
    const raw = 'cannot include absent.puml (parts/parent.puml, line 7)';
    const failed = new Map([['absent.puml', 'ファイルが見つかりません。']]);
    expect(errorMessage(withIncludeReason(raw, failed), ja))
      .toBe('absent.puml を読み込めません: ファイルが見つかりません。（parts/parent.puml の 7 行目）');
    const theme = 'Cannot load theme local in themes (parts/parent.puml, line 8)';
    const themes = new Map([['themes/puml-theme-local.puml', 'ファイルが見つかりません。']]);
    expect(errorMessage(withIncludeReason(theme, themes), ja))
      .toBe('themes/puml-theme-local.puml を読み込めません: ファイルが見つかりません。（parts/parent.puml の 8 行目）');
    expect(withIncludeReason(raw, new Map())).toBe(raw);
  });

  it("words a failed include as the Markdown preview's note does, for the file the engine asked for", () => {
    const note = (path: string, reason: string): string => ja.t('Could not include {0}: {1}', path, reason);
    const failed = new Map([
      ['parts.puml', 'ファイルが見つかりません。'],
      ['themes/puml-theme-local.puml', 'ファイルが見つかりません。'],
    ]);
    expect(errorMessage(withIncludeReason('cannot include parts.puml!PART', failed), ja))
      .toBe(note('parts.puml', 'ファイルが見つかりません。'));
    expect(errorMessage(withIncludeReason('Cannot load theme local in themes', failed), ja))
      .toBe(note('themes/puml-theme-local.puml', 'ファイルが見つかりません。'));
  });

  it('keeps parentheses in the names of requested files and error locations', () => {
    const raw = 'cannot include parts (shared).puml (docs (draft)/parent.puml, line 7)';
    const failed = new Map([['parts (shared).puml', 'ファイルが見つかりません。']]);
    expect(errorMessage(withIncludeReason(raw, failed), ja))
      .toBe('parts (shared).puml を読み込めません: ファイルが見つかりません。（docs (draft)/parent.puml の 7 行目）');
    const syntax = 'Syntax Error? (Assumed diagram type: activity) (docs (draft)/parent.puml, line 8)';
    expect(errorMessage(syntax, ja)).toContain('「アクティビティ図」');
    expect(errorMessage(syntax, ja)).toContain('（docs (draft)/parent.puml の 8 行目）');
  });

  it('distinguishes an unavailable library from a missing entry in the bundled Azure library', () => {
    expect(errorMessage('cannot include <C4/C4_Context>', ja)).toContain('標準ライブラリ C4 はこの拡張機能に含まれていません。');
    expect(errorMessage('cannot include <azure/NoSuchThing>', ja)).toContain('<azure/NoSuchThing> を読み込めません。');
  });

  it('explains missing diagram or section selectors without hiding a known file failure', () => {
    const raw = 'cannot include parts.puml!DETAIL';
    expect(errorMessage(raw, english)).toContain('diagram or section selected after "!"');
    expect(errorMessage(raw, ja)).toContain('! の後に指定した図やセクション');
    expect(errorMessage(`${raw}: ファイルが見つかりません。`, ja))
      .toBe('parts.puml!DETAIL を読み込めません: ファイルが見つかりません。');
  });
});
