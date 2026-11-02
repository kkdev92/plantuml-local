import { describe, expect, it } from 'vitest';

import { lookAtOutput, sameLook, type OutputLook } from '../../src/export/auto-export';
import type { OutputRead } from '../../src/export/freshness';
import type { ArtifactKey, ArtifactRecord } from '../../src/export/history';
import { sha256 } from '../../src/export/ownership';

const DOC = 'file:///repo/docs/design.md';
const OUTPUT = 'file:///repo/docs/images/orders.svg';

const key = (name: string, overrides: Partial<ArtifactKey> = {}): ArtifactKey => ({
  documentUri: DOC,
  container: 'markdown',
  nameBasis: 'fence',
  name,
  childId: null,
  page: null,
  format: 'svg',
  ...overrides,
});

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const holding = (text: string): OutputRead => ({ kind: 'bytes', bytes: bytes(text) });

/** The record of the file, exported holding `text` for the diagram `name`. */
const exported = (text: string, name = 'orders', overrides: Partial<ArtifactKey> = {}): ArtifactRecord => ({
  key: key(name, overrides),
  output: OUTPUT,
  sha256: sha256(bytes(text)),
});

describe('lookAtOutput', () => {
  it("takes the diagram's own export, unchanged since, whatever the diagram draws now", () => {
    expect(lookAtOutput(key('orders'), holding('<svg>v1</svg>'), false, exported('<svg>v1</svg>'), bytes('<svg>v2</svg>'))).toEqual({
      sha256: sha256(bytes('<svg>v1</svg>')),
      owner: exported('<svg>v1</svg>'),
      adopt: false,
    });
  });

  it('leaves alone a file open with unsaved changes, whatever it holds or is', () => {
    for (const read of [holding('<svg>v1</svg>'), { kind: 'none' } as const]) {
      expect(lookAtOutput(key('orders'), read, true, exported('<svg>v1</svg>'), bytes('<svg>v1</svg>'))).toEqual({ why: 'dirty' });
    }
  });

  it('makes no file that is not there, and reads no file that is not one, is a link, is too large or cannot be read', () => {
    const look = (read: OutputRead): unknown => lookAtOutput(key('orders'), read, false, exported('<svg/>'), bytes('<svg/>'));

    expect(look({ kind: 'none' })).toEqual({ why: 'missing' });
    expect(look({ kind: 'not-file' })).toEqual({ why: 'not-file' });
    expect(look({ kind: 'link' })).toEqual({ why: 'link' });
    expect(look({ kind: 'too-large' })).toEqual({ why: 'too-large' });
    expect(look({ kind: 'failed', message: 'EACCES' })).toEqual({ why: 'unreadable', message: 'EACCES' });
  });

  it("leaves another diagram's export to it, even when it holds just what this one draws", () => {
    for (const other of [
      exported('<svg/>', 'billing'),
      exported('<svg/>', 'orders', { documentUri: 'file:///repo/docs/other.md' }),
      exported('<svg/>', 'orders', { container: 'plantuml-file', nameBasis: 'explicit-id' }),
    ]) {
      expect(lookAtOutput(key('orders'), holding('<svg/>'), false, other, bytes('<svg/>'))).toEqual({ why: 'owner', owner: other });
    }
  });

  it('adopts a file no record names, or its own export changed since, that holds just what the diagram draws', () => {
    expect(lookAtOutput(key('orders'), holding('<svg>now</svg>'), false, null, bytes('<svg>now</svg>'))).toEqual({
      sha256: sha256(bytes('<svg>now</svg>')),
      owner: null,
      adopt: true,
    });
    expect(
      lookAtOutput(key('orders'), holding('<svg>now</svg>'), false, exported('<svg>before</svg>'), bytes('<svg>now</svg>'))
    ).toEqual({ sha256: sha256(bytes('<svg>now</svg>')), owner: exported('<svg>before</svg>'), adopt: true });
  });

  it('refuses a file changed since it was exported, or no record names, that holds anything else', () => {
    expect(lookAtOutput(key('orders'), holding('<svg>edited</svg>'), false, exported('<svg>v1</svg>'), bytes('<svg>v2</svg>'))).toEqual({
      why: 'edited',
    });
    expect(lookAtOutput(key('orders'), holding('<svg>by hand</svg>'), false, null, bytes('<svg>v2</svg>'))).toEqual({
      why: 'unrecorded',
    });
  });

  it('adopts no file when no drawing is given to compare it with', () => {
    expect(lookAtOutput(key('orders'), holding('<svg/>'), false, null, null)).toEqual({ why: 'unrecorded' });
    expect(lookAtOutput(key('orders'), holding('<svg/>'), false, exported('<svg>v1</svg>'), null)).toEqual({ why: 'edited' });
    expect(lookAtOutput(key('orders'), holding('<svg>v1</svg>'), false, exported('<svg>v1</svg>'), null)).toMatchObject({ adopt: false });
  });
});

describe('sameLook', () => {
  const own: OutputLook = { sha256: sha256(bytes('<svg/>')), owner: exported('<svg/>'), adopt: false };

  it('finds two looks the same when the bytes, the record and what is to be done are', () => {
    expect(sameLook(own, { ...own, owner: { ...exported('<svg/>') } })).toBe(true);
    expect(sameLook({ ...own, owner: null, adopt: true }, { ...own, owner: null, adopt: true })).toBe(true);
  });

  it('finds them otherwise when any of those is', () => {
    expect(sameLook(own, { ...own, sha256: sha256(bytes('<svg>other</svg>')) })).toBe(false);
    expect(sameLook(own, { ...own, adopt: true })).toBe(false);
    expect(sameLook(own, { ...own, owner: null })).toBe(false);
    expect(sameLook({ ...own, owner: null }, own)).toBe(false);
    expect(sameLook(own, { ...own, owner: exported('<svg>other</svg>') })).toBe(false);
    expect(sameLook(own, { ...own, owner: exported('<svg/>', 'billing') })).toBe(false);
    expect(sameLook(own, { ...own, owner: { ...exported('<svg/>'), output: 'file:///repo/docs/images/Orders.svg' } })).toBe(false);
  });
});
