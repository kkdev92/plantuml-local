import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BUNDLED_LIBRARIES } from '../../src/core/libraries';
import { libraryLines } from '../../src/includes/included-lines';
import { declarationsOf, type Declaration } from '../../src/language/declarations';

/**
 * What the files of the bundled libraries declare (assets/declarations/),
 * against the assets they are read from. scripts/generate-stdlib.mjs reads
 * them with the reader the completion runs, so a change to the reader fails
 * here until they are written again
 * (`node scripts/generate-stdlib.mjs --declarations`).
 */

const root = join(__dirname, '../..');

interface Recorded {
  path: string;
  sha256: string;
}

const record = JSON.parse(readFileSync(join(root, 'assets/stdlib-sources.json'), 'utf8')) as {
  libraries: Record<string, { asset: Recorded; declarations: Recorded; files: Record<string, string> }>;
};

const read = (path: string): Buffer => readFileSync(join(root, path));
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function entriesOf(library: string): Record<string, string> {
  return (JSON.parse(read(`assets/stdlib/${library}.json`).toString('utf8')) as { entries: Record<string, string> })
    .entries;
}

function declarationsIn(library: string): Record<string, Declaration[]> {
  const written = JSON.parse(read(`assets/declarations/${library}.json`).toString('utf8')) as {
    library: string;
    declarations: Record<string, Declaration[]>;
  };
  expect(written.library).toBe(library);
  return written.declarations;
}

const BOM = String.fromCharCode(0xfeff);

describe('the declarations of the bundled libraries', () => {
  it('are there for each bundled library, and for no other', () => {
    expect(readdirSync(join(root, 'assets/declarations')).sort()).toEqual(
      BUNDLED_LIBRARIES.map(({ name }) => `${name}.json`).sort()
    );
    expect(Object.keys(record.libraries).sort()).toEqual(BUNDLED_LIBRARIES.map(({ name }) => name).sort());
  });

  it('are recorded beside each asset, with the hash of what is committed', () => {
    for (const [library, { declarations }] of Object.entries(record.libraries)) {
      expect(declarations.path).toBe(`assets/declarations/${library}.json`);
      expect(sha256(read(declarations.path))).toBe(declarations.sha256);
    }
  });

  it('hold what the reader reads in each file of the asset, under its key', () => {
    let files = 0;
    let count = 0;
    for (const library of Object.keys(record.libraries)) {
      const entries = entriesOf(library);
      const written = declarationsIn(library);
      expect(Object.keys(written)).toEqual(Object.keys(entries));
      for (const [key, text] of Object.entries(entries)) {
        const lines = libraryLines(text);
        expect(written[key], `${library}/${key}`).toEqual(declarationsOf(lines.lines, lines.numbers));
        files += 1;
        count += written[key]?.length ?? 0;
      }
    }
    // Every file of both libraries as bundled, and what they declare: 298 files, 2,077 declarations.
    expect(files).toBe(298);
    expect(count).toBeGreaterThan(2000);
  });

  it('count lines from the first of each asset text, which a BOM upstream does not move', () => {
    // C4_Sequence.puml starts with a BOM and then its include; the asset holds the text without the BOM.
    expect(record.libraries.c4?.files['stdlib/C4/C4_Sequence.puml']).toBeDefined();
    const text = entriesOf('c4').c4_sequence ?? '';
    expect(text.startsWith('!include <C4/C4_Component>')).toBe(true);
    expect(declarationsIn('c4').c4_sequence?.[0]).toMatchObject({
      type: 'include',
      directive: 'include',
      target: '<C4/C4_Component>',
      line: 0,
      start: 9,
    });
    const withBom = libraryLines(BOM + text);
    const without = libraryLines(text);
    expect(declarationsOf(withBom.lines, withBom.numbers)).toEqual(declarationsOf(without.lines, without.numbers));
  });
});
