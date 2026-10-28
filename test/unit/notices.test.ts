import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NOT_FROM_NPM, noticeRows, noticesProblems } from '../../scripts/notices.mjs';

/** A notices file in the form of THIRD_PARTY_NOTICES.md, with the given table rows. */
function notices(...rows: string[]): string {
  return [
    '# Third-Party Notices',
    '',
    '| Component | Version | Licence | Full text |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## A section',
    '',
    'Prose that names entities 1.0.0.',
  ].join('\n');
}

function row(label: string, version: string): string {
  return `| [${label}](https://example.test/) | ${version} | MIT | [text](third-party/text.txt) |`;
}

function ships(packages: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(packages).map(([name, versions]) => [name, new Set(versions)]));
}

describe('the repository notices', () => {
  const text = readFileSync(join(__dirname, '../..', 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const rows = noticeRows(text);

  it('are read row by row, with the versions each lists', () => {
    const lines = text.split('\n').filter((line) => line.startsWith('| ['));
    expect(lines.length).toBeGreaterThan(10);
    expect(rows).toHaveLength(lines.length);
    expect(rows.find((r) => r.name === '@plantuml/core')?.versions).toHaveLength(1);
    expect(rows.find((r) => r.name === 'entities')?.versions).toHaveLength(2);
  });

  it('have a row for each component kept by hand', () => {
    for (const name of NOT_FROM_NPM) {
      expect(
        rows.map((r) => r.name),
        name
      ).toContain(name);
    }
  });
});

describe('noticesProblems', () => {
  const table = notices(
    row('`@scope/core`', '1.0.0'),
    row('entities', '4.5.0, 7.0.1'),
    row('Viz.js', '(in `@scope/core`)'),
    row('Azure-PlantUML', '2.2.0')
  );

  it('finds nothing when each package that ships has a row with its versions', () => {
    expect(noticesProblems(table, ships({ '@scope/core': ['1.0.0'], entities: ['7.0.1', '4.5.0'] }))).toEqual([]);
  });

  it('reports a package that ships without a row', () => {
    expect(noticesProblems(table, ships({ '@scope/core': ['1.0.0'], entities: ['4.5.0', '7.0.1'], ws: ['8.21.3'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md has no row for ws, of which 8.21.3 ships',
    ]);
  });

  it('reports a row that lists another version than the one that ships', () => {
    expect(noticesProblems(table, ships({ '@scope/core': ['1.0.1'], entities: ['4.5.0', '7.0.1'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md lists @scope/core 1.0.0, but 1.0.1 ships',
    ]);
  });

  it('reports a row that lists one of the two versions that ship', () => {
    const one = notices(row('`@scope/core`', '1.0.0'), row('entities', '4.5.0'));
    expect(noticesProblems(one, ships({ '@scope/core': ['1.0.0'], entities: ['7.0.1', '4.5.0'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md lists entities 4.5.0, but 4.5.0, 7.0.1 ships',
    ]);
    const twice = notices(row('`@scope/core`', '1.0.0'), row('entities', '4.5.0, 4.5.0'));
    expect(noticesProblems(twice, ships({ '@scope/core': ['1.0.0'], entities: ['7.0.1', '4.5.0'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md lists entities 4.5.0, 4.5.0, but 4.5.0, 7.0.1 ships',
    ]);
  });

  it('reports a row for an npm package that no longer ships', () => {
    expect(noticesProblems(table, ships({ '@scope/core': ['1.0.0'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md has a row for entities, which does not ship',
    ]);
  });

  it('leaves the rows kept by hand to the notices', () => {
    const byHand = notices(row('Viz.js', '(in `@scope/core`)'), row('Azure-PlantUML', '2.2.0'));
    expect(noticesProblems(byHand, ships({}))).toEqual([]);
  });

  it('reports notices without a table it can read', () => {
    expect(noticesProblems('# Third-Party Notices\n\nNo table.\n', ships({ ws: ['8.21.3'] }))).toEqual([
      'THIRD_PARTY_NOTICES.md has no table of components to read',
    ]);
  });
});
