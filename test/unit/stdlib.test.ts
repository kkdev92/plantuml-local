import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BUNDLED_LIBRARIES, bundledLibrary } from '../../src/core/libraries';
import { installStdlib, rejectScriptLoad, watchLibraryReads } from '../../src/worker/stdlib';

const globals = globalThis as Record<string, unknown>;

function fixtureDir(json?: Record<string, unknown>): string {
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
      ...(json === undefined ? {} : { json }),
    })
  );
  return dir;
}

afterEach(() => {
  delete globals.PLANTUML_STDLIB;
  delete globals.PLANTUML_STDLIB_INFO;
  delete globals.PLANTUML_STDLIB_JSON;
  delete globals.__pl_script_state;
  delete globals.PLANTUML_STDLIB_LOADER;
  vi.useRealTimers();
});

describe('installStdlib', () => {
  it('exposes the globals the engine reads', () => {
    installStdlib(fixtureDir());

    expect(globals.PLANTUML_STDLIB).toHaveProperty('azure');
    expect(globals.PLANTUML_STDLIB_INFO).toHaveProperty('azure');
    expect(globals.PLANTUML_STDLIB_JSON).toHaveProperty('azure');
  });

  it('marks the library script as loaded so the engine never injects one', () => {
    installStdlib(fixtureDir());

    const state = globals.__pl_script_state as Record<string, { state: string }>;
    expect(state['azure.min.js']?.state).toBe('loaded');
  });

  it('serves every bundled library, by the lower-cased name the engine looks it up by', () => {
    installStdlib(fixtureDir());

    const state = globals.__pl_script_state as Record<string, { state: string }>;
    for (const name of ['azure', 'c4']) {
      expect(globals.PLANTUML_STDLIB).toHaveProperty(name);
      expect(globals.PLANTUML_STDLIB_INFO).toHaveProperty(name);
      expect(globals.PLANTUML_STDLIB_JSON).toHaveProperty(name);
      expect(state[`${name}.min.js`]?.state).toBe('loaded');
    }
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

  it('tells whoever watches of each file looked up, whether the library has it, until told to stop', () => {
    installStdlib(fixtureDir());
    const azure = (globals.PLANTUML_STDLIB as Record<string, Record<string, string[] | null>>).azure;
    const reads: [string, string, boolean][] = [];
    watchLibraryReads((library, key, found) => {
      reads.push([library, key, found]);
    });
    try {
      void azure['azurecommon'];
      void azure['compute/nosuchthing'];
      void azure['azurecommon'];
    } finally {
      watchLibraryReads(null);
    }
    void azure['compute/azurefunction'];

    expect(reads).toEqual([
      ['azure', 'azurecommon', true],
      ['azure', 'compute/nosuchthing', false],
      ['azure', 'azurecommon', true],
    ]);
  });

  it('serves a library’s JSON files parsed, by the key %load_json looks them up by', () => {
    // `%load_json('<azure/all.json>')` reads PLANTUML_STDLIB_JSON.azure.all
    // and writes the value back out as JSON text, so it must be the value
    // itself rather than the file's text.
    installStdlib(fixtureDir({ all: ['Compute'] }));
    const azure = (globals.PLANTUML_STDLIB_JSON as Record<string, Record<string, unknown>>).azure;

    expect(azure?.['all']).toEqual(['Compute']);
    expect(azure?.['nosuchthing']).toBeNull();
  });

  it('returns null for a JSON file named like a property every object has', () => {
    // A diagram names the file; the engine turns a function into no JSON
    // at all and stops the render.
    installStdlib(fixtureDir({ all: ['Compute'] }));
    const azure = (globals.PLANTUML_STDLIB_JSON as Record<string, Record<string, unknown>>).azure;

    expect(azure?.['constructor']).toBeNull();
    expect(azure?.['__proto__']).toBeNull();
    expect(azure?.['toString']).toBeNull();
  });

  it('returns null for every JSON file of a library that has none', () => {
    installStdlib(fixtureDir());
    const azure = (globals.PLANTUML_STDLIB_JSON as Record<string, Record<string, unknown>>).azure;

    expect(azure?.['all']).toBeNull();
  });

  it('answers for a script it does not have, on a later tick, so the engine appends none', () => {
    // `!include <aws/…>` is not bundled. Given no loader, the engine
    // appends a <script> to document.head for each such include.
    vi.useFakeTimers();
    installStdlib(fixtureDir());
    const loader = globals.PLANTUML_STDLIB_LOADER as (name: string, loaded: () => void, failed: (message: string) => void) => unknown;
    const loaded = vi.fn();
    const failed = vi.fn();

    // Anything but false: the engine takes the script as handled.
    expect(loader('aws.min.js', loaded, failed)).not.toBe(false);
    expect(failed).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(failed).toHaveBeenCalledWith('Failed to load aws.min.js');
    expect(loaded).not.toHaveBeenCalled();
  });

  it('does not read from disk until a library is actually used', () => {
    // A diagram without sprites should not pay for the 500 KB asset.
    installStdlib(join(tmpdir(), 'plantuml-stdlib-does-not-exist'));
    expect(globals.PLANTUML_STDLIB).toHaveProperty('azure');
    expect(globals.PLANTUML_STDLIB_JSON).toHaveProperty('azure');
  });
});

describe('the bundled libraries', () => {
  const root = join(__dirname, '../..');
  const sources = JSON.parse(readFileSync(join(root, 'assets/stdlib-sources.json'), 'utf8')) as {
    commit: string;
    libraries: Record<string, { asset: { path: string; sha256: string }; files: Record<string, string> }>;
  };
  const asset = (name: string): { library: string; entries: Record<string, string>; json?: Record<string, unknown> } =>
    JSON.parse(readFileSync(join(root, 'assets/stdlib', `${name}.json`), 'utf8')) as {
      library: string;
      entries: Record<string, string>;
      json?: Record<string, unknown>;
    };

  it('are the same in the table, the generated assets and the record of where they came from', () => {
    const names = BUNDLED_LIBRARIES.map((library) => library.name).sort();
    const assets = readdirSync(join(root, 'assets/stdlib'))
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort();
    expect(names).toEqual(['azure', 'c4']);
    expect(assets).toEqual(names);
    expect(Object.keys(sources.libraries).sort()).toEqual(names);
    for (const name of names) {
      expect(asset(name).library).toBe(name);
    }
  });

  it('are the assets the record was written for', () => {
    for (const [name, record] of Object.entries(sources.libraries)) {
      expect(record.asset.path).toBe(`assets/stdlib/${name}.json`);
      const bytes = readFileSync(join(root, record.asset.path));
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(record.asset.sha256);
    }
  });

  it('come from the commit the generator is pinned to', () => {
    const generator = readFileSync(join(root, 'scripts/generate-stdlib.mjs'), 'utf8');
    const pinned = /^const COMMIT = '([0-9a-f]{40})';$/m.exec(generator)?.[1];
    expect(pinned).toBeDefined();
    expect(sources.commit).toBe(pinned);
  });

  it('bundle exactly the files the table lists for a library bundled in part', () => {
    const partial = BUNDLED_LIBRARIES.filter((library) => library.files !== undefined);
    expect(partial.map((library) => library.name)).toEqual(['c4']);
    for (const library of partial) {
      const keys = Object.keys(asset(library.name).entries).sort();
      expect(keys).toEqual((library.files ?? []).map((file) => file.toLowerCase()).sort());
      expect(Object.keys(sources.libraries[library.name]?.files ?? {})).toHaveLength(keys.length);
    }
  });

  it('hand the engine no byte-order mark and no carriage return', () => {
    for (const { name } of BUNDLED_LIBRARIES) {
      for (const [key, text] of Object.entries(asset(name).entries)) {
        expect(text.charCodeAt(0), `${name}/${key}`).not.toBe(0xfeff);
        expect(text.includes(String.fromCharCode(13)), `${name}/${key}`).toBe(false);
      }
    }
  });

  it('hand the engine no line that is only @startuml or @enduml', () => {
    // PlantUML's standard library leaves these lines out of the files it
    // gives the engine, which reads one in an included file as a syntax
    // error. `azure/all` is written between them upstream.
    for (const { name } of BUNDLED_LIBRARIES) {
      for (const [key, text] of Object.entries(asset(name).entries)) {
        const markers = text.split('\n').filter((line) => /^@(?:startuml|enduml)$/.test(line.trim()));
        expect(markers, `${name}/${key}`).toEqual([]);
      }
    }
  });

  it('bundle the list of categories azure/all includes, each of which is bundled', () => {
    // `azure/all` reads the list with %load_json and includes the `all` of
    // each category in it.
    const azure = asset('azure');
    const categories = azure.json?.['all'];
    expect(Array.isArray(categories)).toBe(true);
    expect((categories as unknown[]).length).toBeGreaterThan(0);
    for (const category of categories as string[]) {
      expect(azure.entries, category).toHaveProperty([`${category.toLowerCase()}/all`]);
    }
    expect(Object.keys(sources.libraries.azure?.files ?? {})).toContain('stdlib/azure/all.json');
  });

  it('are looked up whatever the case an include writes them in', () => {
    expect(bundledLibrary('C4')?.name).toBe('c4');
    expect(bundledLibrary('c4')?.label).toBe('C4');
    expect(bundledLibrary('Azure')?.name).toBe('azure');
    expect(bundledLibrary('aws')).toBeUndefined();
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

  it('takes the element out of the document once it has reported the failure', async () => {
    const { document } = new Window();
    const element = document.createElement('script') as unknown as { onerror: ((message: string) => void) | null; src: string };
    rejectScriptLoad(element);
    const failed = new Promise<string>((resolve) => {
      element.onerror = resolve;
    });

    element.src = 'aws.min.js';
    document.head.appendChild(element as unknown as Parameters<typeof document.head.appendChild>[0]);
    await failed;

    expect(document.head.childNodes.length).toBe(0);
  });
});
