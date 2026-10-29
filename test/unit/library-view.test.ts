import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { splitLines } from '../../src/core/lines';
import type { Declaration } from '../../src/language/declarations';
import { libraryOfPath, libraryPath, libraryText, LIBRARY_SCHEME } from '../../src/language/library-view';

const assets = join(__dirname, '../../assets');

describe('libraryPath and libraryOfPath', () => {
  it('name a file as an include does, in the case upstream writes it when that is known', () => {
    expect(libraryPath('c4', 'c4_context')).toBe('/C4/C4_Context.puml');
    expect(libraryPath('azure', 'compute/azurefunction', 'Compute/AzureFunction')).toBe(
      '/azure/Compute/AzureFunction.puml'
    );
    expect(libraryPath('azure', 'compute/azurefunction')).toBe('/azure/compute/azurefunction.puml');
    expect(LIBRARY_SCHEME).toBe('plantuml-local-library');
  });

  it('read the library and the key back, in lower case, and nothing for what names no bundled file', () => {
    expect(libraryOfPath('/C4/C4_Context.puml')).toEqual({ library: 'c4', key: 'c4_context' });
    expect(libraryOfPath('/azure/Compute/AzureFunction.puml')).toEqual({
      library: 'azure',
      key: 'compute/azurefunction',
    });
    expect(libraryOfPath('/other/x.puml')).toBeNull();
    expect(libraryOfPath('/C4/C4.txt')).toBeNull();
    expect(libraryOfPath('/C4/.puml')).toBeNull();
    expect(libraryOfPath('/C4')).toBeNull();
  });
});

describe('libraryText', () => {
  it('reads the text bundled of a file, and nothing for a file or a library not bundled', async () => {
    expect((await libraryText(join(assets, 'stdlib'), 'c4', 'c4_context'))?.startsWith('!include <C4/C4>')).toBe(true);
    expect(await libraryText(join(assets, 'stdlib'), 'C4', 'nope')).toBeNull();
    expect(await libraryText(join(assets, 'stdlib'), 'c4', 'constructor')).toBeNull();
    expect(await libraryText(join(assets, 'stdlib'), 'other', 'x')).toBeNull();
  });

  it('has each declaration of the index on its line, at its columns', async () => {
    let checked = 0;
    for (const library of ['c4', 'azure']) {
      const { declarations } = JSON.parse(readFileSync(join(assets, 'declarations', `${library}.json`), 'utf8')) as {
        declarations: Record<string, Declaration[]>;
      };
      // The view reads the whole of a library's texts for each file it opens: read them once here.
      const { entries } = JSON.parse(readFileSync(join(assets, 'stdlib', `${library}.json`), 'utf8')) as {
        entries: Record<string, string>;
      };
      const keys = Object.keys(declarations);
      for (const key of [keys[0] ?? '', keys[keys.length - 1] ?? '']) {
        expect(await libraryText(join(assets, 'stdlib'), library, key)).toBe(entries[key]);
      }
      for (const [key, declared] of Object.entries(declarations)) {
        const lines = splitLines(entries[key] ?? '');
        for (const declaration of declared) {
          const line = lines[declaration.line] ?? '';
          if (declaration.type === 'definition') {
            expect(line.slice(declaration.start, declaration.end), `${library}/${key}:${String(declaration.line)}`).toBe(
              declaration.name
            );
            expect(declaration.last).toBeLessThan(lines.length);
            checked += 1;
          } else if (declaration.type === 'include') {
            expect(line.slice(declaration.start, declaration.end)).toBe(declaration.target);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1900);
  });
});
