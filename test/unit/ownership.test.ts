import { describe, expect, it } from 'vitest';

import { isLastExport, sha256, withExport, type ExportRecords } from '../../src/export/ownership';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const SVG = '/repo/docs/images/orders.svg';
const DOC = '/repo/docs/design.md';

describe('sha256', () => {
  it('hashes the bytes', () => {
    // The FIPS 180-2 test vector.
    expect(sha256(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('isLastExport', () => {
  const records = withExport({}, SVG, DOC, bytes('<svg>1</svg>'));

  it('knows the file the document last exported, as it was written', () => {
    expect(isLastExport(records, SVG, DOC, bytes('<svg>1</svg>'))).toBe(true);
  });

  it('does not take the file once it has changed, or for another document', () => {
    expect(isLastExport(records, SVG, DOC, bytes('<svg>edited</svg>'))).toBe(false);
    expect(isLastExport(records, SVG, '/repo/docs/other.md', bytes('<svg>1</svg>'))).toBe(false);
    expect(isLastExport(records, '/repo/docs/images/billing.svg', DOC, bytes('<svg>1</svg>'))).toBe(false);
  });

  it('knows nothing it has no record of, whatever the path', () => {
    for (const path of ['constructor', '__proto__', 'toString']) {
      expect(isLastExport({}, path, DOC, bytes('<svg>1</svg>')), path).toBe(false);
    }
  });
});

describe('withExport', () => {
  it('records what was written, by the file, keeping the other records', () => {
    const first = withExport({}, SVG, DOC, bytes('<svg>1</svg>'));
    const second = withExport(first, '/repo/docs/images/billing.png', DOC, bytes('png'));

    expect(Object.keys(second)).toEqual([SVG, '/repo/docs/images/billing.png']);
    expect(second[SVG]).toEqual({ document: DOC, sha256: sha256(bytes('<svg>1</svg>')) });
    // Nothing but the document and a hash of the bytes.
    expect(JSON.stringify(second)).not.toContain('<svg>');
  });

  it('replaces the record of a file written again, without changing the old records', () => {
    const first: ExportRecords = withExport({}, SVG, DOC, bytes('<svg>1</svg>'));
    const second = withExport(first, SVG, '/repo/docs/other.md', bytes('<svg>2</svg>'));

    expect(second[SVG]).toEqual({ document: '/repo/docs/other.md', sha256: sha256(bytes('<svg>2</svg>')) });
    expect(first[SVG]).toEqual({ document: DOC, sha256: sha256(bytes('<svg>1</svg>')) });
  });

  it('gives back the same records when they say so already', () => {
    const records = withExport({}, SVG, DOC, bytes('<svg>1</svg>'));

    expect(withExport(records, SVG, DOC, bytes('<svg>1</svg>'))).toBe(records);
  });
});
