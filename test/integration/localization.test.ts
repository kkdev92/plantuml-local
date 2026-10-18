import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { join } from 'node:path';
import MarkdownIt from 'markdown-it';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContextStub } from './helpers/context-stub';
import { createVscodeStub } from './helpers/vscode-stub';

const require = createRequire(import.meta.url);
const stub = createVscodeStub();
const context = createContextStub();
const translations = JSON.parse(readFileSync(join(__dirname, '../../l10n/bundle.l10n.ja.json'), 'utf8')) as Record<string, string>;
const untranslated = new Set<string>();
let restore = (): void => undefined;
let extension: {
  activate(context: unknown): Promise<{ extendMarkdownIt(md: MarkdownIt): MarkdownIt }>;
  deactivate(): Promise<void>;
};
let md: MarkdownIt;

beforeAll(async () => {
  stub.l10n.t = (message, ...args) => {
    if (translations[message] === undefined) untranslated.add(message);
    return (translations[message] ?? message).replace(/\{(\d+)\}/g, (placeholder, index: string) =>
      args[Number(index)] === undefined ? placeholder : String(args[Number(index)])
    );
  };
  const moduleAny = Module as unknown as { _load(request: string, ...args: unknown[]): unknown };
  const originalLoad = moduleAny._load.bind(Module);
  moduleAny._load = (request, ...args) => request === 'vscode' ? stub : originalLoad(request, ...args);
  restore = () => { moduleAny._load = originalLoad; };
  extension = require(join(__dirname, '../../dist/extension.js')) as typeof extension;
  const api = await extension.activate(context);
  md = api.extendMarkdownIt(new MarkdownIt());
  stub._test.setConfiguration('logLevel', 'debug');
});

afterAll(async () => {
  await extension.deactivate();
  for (const subscription of context.subscriptions) subscription.dispose();
  restore();
});

describe('Japanese UI (dist)', () => {
  it('shows Japanese notifications and inline guidance', async () => {
    await stub._test.registeredCommands.get('plantumlLocal.clearCache')?.();
    expect(stub._test.notifications.info.at(-1)).toBe('PlantUML の描画キャッシュをクリアしました。');
    expect(stub._test.logs.some((line) => line.startsWith('info: PlantUML の描画キャッシュをクリアしました。'))).toBe(true);
    stub.workspace.isTrusted = false;
    try {
      await stub._test.registeredCommands.get('plantumlLocal.exportSvg')?.();
      expect(stub._test.notifications.warn.at(-1)).toContain('制限モードでは図を書き出せません。');
    } finally {
      stub.workspace.isTrusted = true;
    }
    expect(md.render('```plantuml\n\n```')).toContain('図のソースコードが入力されていません。');
    expect(md.render('```plantuml\n!include https://example.com/a.puml\n```'))
      .toContain('URL を指定したファイルやテーマの読み込み');
  });

  it('explains a real engine syntax error in Japanese above its original SVG', async () => {
    const source = '```plantuml\n@startuml\nAlice -> Bob\nthis is invalid ;;; [[[\n@enduml\n```';
    let html = md.render(source);
    for (let attempt = 0; attempt < 600 && html.includes('plantuml-loading'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      html = md.render(source);
    }
    expect(html).not.toContain('plantuml-loading');
    expect(html).toContain('<div class="plantuml-notice">図の書き方に誤りがあります。');
    expect(html).toContain('<svg');
    expect(html).not.toMatch(/\{\d+\}/);
    expect(stub._test.logs.some((line) => line.startsWith('debug: 描画用ワーカーを起動します。'))).toBe(true);
    expect(stub._test.logs.some((line) => /^debug: 図を描画しました（SVG のサイズ: \d+ バイト）。/.test(line))).toBe(true);
    expect([...untranslated]).toEqual([]);
  });

  it('explains failed exports in Japanese in the output channel the notification opens', async () => {
    const uri = 'file:///c/japanese/doc.md';
    stub._test.writtenFiles.set(uri, '```plantuml broken\n@startuml\nthis is invalid ;;; [[[\n@enduml\n```');
    const logsBefore = stub._test.logs.length;
    const calls = stub._test.commandCalls.length;
    stub._test.messageReply = '書き出す';
    stub._test.notificationReply = '出力を表示';
    try {
      await stub._test.registeredCommands.get('plantumlLocal.exportFolderSvg')?.(stub.Uri.parse('file:///c/japanese'));
    } finally {
      stub._test.messageReply = null;
      stub._test.notificationReply = null;
      stub._test.writtenFiles.delete(uri);
    }
    expect(stub._test.notifications.warn.at(-1)).toContain('理由は出力パネルで確認できます。');
    expect(stub._test.commandCalls.slice(calls).map((call) => call.id)).toContain(
      'workbench.action.output.show.kkdev92.plantuml-local.PlantUML Local.log'
    );
    const failure = stub._test.logs.slice(logsBefore).find((line) => line.includes('を書き出せませんでした:'));
    expect(failure).toContain('broken');
    expect(failure).toContain('3 行目の PlantUML エラー: 図の書き方に誤りがあります。');
    expect([...untranslated]).toEqual([]);
  });

  it.each([
    ['!theme missing-theme\nA -> B', 'テーマ missing-theme は利用できません。'],
    ['!include <C4/C4_Context>\nA -> B', '標準ライブラリ C4 はこの拡張機能に含まれていません。'],
    ['!import foo.zip\nA -> B', 'この拡張機能は !import に対応していません。'],
    ['start\n#pink:deprecated colour\nsecond line;\nstop', 'この構文は非推奨です。'],
    ['start\n:Hello;\nthis is invalid ;;; [[[', '「アクティビティ図」'],
  ])('explains engine messages for %s in Japanese', async (body, expected) => {
    const source = `\`\`\`plantuml\n@startuml\n${body}\n@enduml\n\`\`\``;
    let html = md.render(source);
    for (let attempt = 0; attempt < 600 && html.includes('plantuml-loading'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      html = md.render(source);
    }
    expect(html).not.toContain('plantuml-loading');
    expect(html).toContain('class="plantuml-notice"');
    expect(html).toContain(expected);
    expect(html).toContain('<svg');
    expect([...untranslated]).toEqual([]);
  });
});
