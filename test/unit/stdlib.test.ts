import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installStdlib, rejectScriptLoad } from '../../src/worker/stdlib';

const globals = globalThis as Record<string, unknown>;

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'plantuml-stdlib-'));
  writeFileSync(
    join(dir, 'azure.json'),
    JSON.stringify({
      library: 'azure',
      license: 'MIT',
      entries: {
        azurecommon: '!define AZURE_COLOR #0072C6\nskinparam shadowing false',
        'compute/azurefunction': 'sprite $AzureFunction [8x8/16] {\n}',
      },
    })
  );
  return dir;
}

afterEach(() => {
  delete globals.PLANTUML_STDLIB;
  delete globals.PLANTUML_STDLIB_INFO;
  delete globals.PLANTUML_STDLIB_JSON;
  delete globals.__pl_script_state;
  vi.useRealTimers();
});

describe('installStdlib', () => {
  it('exposes the globals the engine reads', () => {
    installStdlib(fixtureDir());

    expect(globals.PLANTUML_STDLIB).toHaveProperty('azure');
    expect(globals.PLANTUML_STDLIB_INFO).toHaveProperty('azure');
    expect(globals.PLANTUML_STDLIB_JSON).toBeDefined();
  });

  it('marks the library script as loaded so the engine never injects one', () => {
    installStdlib(fixtureDir());

    const state = globals.__pl_script_state as Record<string, { state: string }>;
    expect(state['azure.min.js']?.state).toBe('loaded');
  });

  it('serves file contents as an array of lines', () => {
    // The engine rejects a single string with newlines ("Fatal parsing
    // error"); it requires one array entry per line.
    installStdlib(fixtureDir());
    const azure = (globals.PLANTUML_STDLIB as Record<string, Record<string, string[] | null>>).azure;

    expect(azure['azurecommon']).toEqual(['!define AZURE_COLOR #0072C6', 'skinparam shadowing false']);
  });

  it('resolves nested include paths lower-cased and without the extension', () => {
    installStdlib(fixtureDir());
    const azure = (globals.PLANTUML_STDLIB as Record<string, Record<string, string[] | null>>).azure;

    expect(azure['compute/azurefunction']?.[0]).toContain('sprite $AzureFunction');
  });

  it('returns null for a file the library does not have', () => {
    installStdlib(fixtureDir());
    const azure = (globals.PLANTUML_STDLIB as Record<string, Record<string, string[] | null>>).azure;

    expect(azure['compute/nosuchthing']).toBeNull();
  });

  it('does not read from disk until a library is actually used', () => {
    // A diagram without sprites should not pay for the 500 KB asset.
    installStdlib(join(tmpdir(), 'plantuml-stdlib-does-not-exist'));
    expect(globals.PLANTUML_STDLIB).toHaveProperty('azure');
  });
});

describe('rejectScriptLoad', () => {
  it('reports failure instead of leaving the render hanging', async () => {
    // `!include <aws/…>` is not bundled, so the engine falls back to
    // injecting a script. Without this the render waits for the timeout.
    const element: { onerror: ((message: string) => void) | null; src?: string } = { onerror: null };
    rejectScriptLoad(element);

    const failed = new Promise<string>((resolve) => {
      element.onerror = resolve;
    });
    element.src = 'aws.min.js';

    await expect(failed).resolves.toContain('aws.min.js');
  });

  it('reads back as empty rather than the assigned URL', () => {
    const element: { onerror: null; src?: string } = { onerror: null };
    rejectScriptLoad(element);
    element.src = 'aws.min.js';

    expect(element.src).toBe('');
  });
});
