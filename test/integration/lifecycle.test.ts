import { existsSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';

import { createContextStub } from './helpers/context-stub';
import { createVscodeStub } from './helpers/vscode-stub';

/**
 * Deactivation releases what activation registered. Loads the built
 * dist/extension.js with a stubbed `vscode` module, as the other integration
 * tests do, and counts what is still registered on each side of `deactivate`.
 * Requires `npm run bundle`.
 */

const extensionPath = join(__dirname, '../../dist/extension.js');
const require = createRequire(import.meta.url);

let restoreLoad = (): void => undefined;

afterAll(() => {
  restoreLoad();
});

it('releases on deactivate every listener, provider and command activation registered', async () => {
  expect(existsSync(extensionPath), 'dist/extension.js missing — run `npm run bundle` first').toBe(true);
  const vscodeStub = createVscodeStub();
  // dist/extension.js is CJS; intercept its require('vscode').
  const moduleAny = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
  };
  const originalLoad = moduleAny._load.bind(Module);
  moduleAny._load = (request: string, ...rest: unknown[]): unknown =>
    request === 'vscode' ? vscodeStub : originalLoad(request, ...rest);
  restoreLoad = () => {
    moduleAny._load = originalLoad;
  };
  const extension = require(extensionPath) as {
    activate(context: unknown): Promise<unknown>;
    deactivate(): Promise<void>;
  };

  await extension.activate(createContextStub());

  // Every kind is counted while it is registered, so the empty answer below
  // means released rather than never counted.
  expect(Object.keys(vscodeStub._test.live())).toEqual(
    expect.arrayContaining([
      'commands.registerCommand',
      'languages.createDiagnosticCollection',
      'languages.registerCodeActionsProvider',
      'languages.registerCompletionItemProvider',
      'languages.registerDocumentSymbolProvider',
      'languages.registerFoldingRangeProvider',
      'window.onDidChangeActiveColorTheme',
      'window.onDidChangeActiveTextEditor',
      'window.onDidChangeTextEditorSelection',
      'window.registerWebviewPanelSerializer',
      'workspace.onDidChangeConfiguration',
      'workspace.onDidChangeTextDocument',
      'workspace.onDidCloseTextDocument',
      'workspace.onDidOpenTextDocument',
      'workspace.onDidSaveTextDocument',
    ])
  );

  await extension.deactivate();

  expect(vscodeStub._test.live()).toEqual({});
});
