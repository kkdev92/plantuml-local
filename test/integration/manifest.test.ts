import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';

import { assertManifestMatches, type DeclaredContributions } from '@kkdev92/vscode-ext-kit/testing';

import { createVscodeStub } from './helpers/vscode-stub';

/**
 * package.json against what src declares, with the kit's own check.
 *
 * `assertManifestMatches` compares the part both sides state: command ids, and
 * each setting's type, default, allowed values and scope. It also holds
 * `engines.vscode` to the floor of the kit this extension is built on, which
 * nothing else compares. The declarations live in src/extension.ts, which
 * imports `vscode`, so this reads them from the built bundle the way the other
 * integration tests do. Requires `npm run bundle`.
 */

const extensionPath = join(__dirname, '../../dist/extension.js');
const require = createRequire(import.meta.url);
const manifest: unknown = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

let declared: Record<string, unknown> = {};
let restore = (): void => undefined;

beforeAll(() => {
  const vscodeStub = createVscodeStub();
  // dist/extension.js is CJS; intercept its require('vscode').
  const moduleAny = Module as unknown as {
    _load: (request: string, ...rest: unknown[]) => unknown;
  };
  const originalLoad = moduleAny._load.bind(Module);
  moduleAny._load = (request: string, ...rest: unknown[]): unknown =>
    request === 'vscode' ? vscodeStub : originalLoad(request, ...rest);
  restore = () => {
    moduleAny._load = originalLoad;
  };
  declared = require(extensionPath) as Record<string, unknown>;
});

afterAll(() => {
  restore();
});

/** Every command contract the bundle exports. */
function contracts(): { readonly descriptor: { readonly id: string } }[] {
  return Object.values(declared).filter(
    (value): value is { readonly descriptor: { readonly id: string } } =>
      typeof value === 'object' && value !== null && 'descriptor' in value
  );
}

describe('package.json', () => {
  it('agrees with what src declares', () => {
    assertManifestMatches(manifest, {
      settings: [declared['Settings']] as DeclaredContributions['settings'],
      commands: contracts(),
      engines: true,
    });
  });
});
