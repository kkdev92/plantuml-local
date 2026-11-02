import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INCLUDE_LIMITS } from '../../src/core/constants';
import type { ReplayFinding } from '../../src/core/types';
import { IncludeSession, type IncludeAccess } from '../../src/includes/session';
import { ReadSnapshot } from '../../src/includes/snapshot';

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('ReadSnapshot', () => {
  let temp: string;
  let root: string;
  let common: string;
  let access: IncludeAccess;
  const closed = (): undefined => undefined;
  const nothing = (): ReplayFinding[] => [];

  beforeEach(async () => {
    temp = await realpath(await mkdtemp(join(tmpdir(), 'plantuml-local-snapshot-')));
    root = join(temp, 'ws');
    await mkdir(join(root, 'docs'), { recursive: true });
    common = join(root, 'docs', 'common.puml');
    await writeFile(common, 'Alice -> Bob\n');
    await writeFile(join(root, 'docs', 'nested.puml'), '!include common.puml\n');
    access = { available: true, scope: { root, documentFolder: join(root, 'docs'), searchFolders: [] } };
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('gives every later read of a path the first: its text, though the file changed since', async () => {
    const read = new ReadSnapshot(nothing).reader(closed);
    const first = await read(root, common, INCLUDE_LIMITS.bytes);
    await writeFile(common, 'Carol -> Dave\n');

    expect(first.outcome).toEqual({ kind: 'file', id: common, text: 'Alice -> Bob\n' });
    expect(await read(root, common, INCLUDE_LIMITS.bytes)).toEqual(first);
    // Another export reads afresh.
    expect((await new ReadSnapshot(nothing).reader(closed)(root, common, INCLUDE_LIMITS.bytes)).outcome).toMatchObject({ text: 'Carol -> Dave\n' });
  });

  it('gives a path missing or refused at first as it was, though the file is there or fixed since', async () => {
    const read = new ReadSnapshot(nothing).reader(closed);
    const later = join(root, 'docs', 'later.puml');
    const broken = join(root, 'docs', 'broken.puml');
    await writeFile(broken, 'A\u0000B');

    expect((await read(root, later, INCLUDE_LIMITS.bytes)).outcome).toEqual({ kind: 'missing' });
    expect((await read(root, broken, INCLUDE_LIMITS.bytes)).outcome).toEqual({ kind: 'refused', refusal: 'nul' });
    await writeFile(later, 'A -> B\n');
    await writeFile(broken, 'A -> B\n');
    expect((await read(root, later, INCLUDE_LIMITS.bytes)).outcome).toEqual({ kind: 'missing' });
    expect((await read(root, broken, INCLUDE_LIMITS.bytes)).outcome).toEqual({ kind: 'refused', refusal: 'nul' });
  });

  it('holds a file read before against the bytes the render reading it has left, as a read now would be', async () => {
    const read = new ReadSnapshot(nothing).reader(closed);

    expect((await read(root, common, INCLUDE_LIMITS.bytes)).outcome.kind).toBe('file');
    expect((await read(root, common, 5)).outcome).toEqual({ kind: 'refused', refusal: 'too-large' });
    expect((await read(root, common, 13)).outcome.kind).toBe('file');
  });

  it('knows each file delivered by the SHA-256 of its text, where the text came from and what it holds, worked out once', async () => {
    const other = join(root, 'docs', 'other.puml');
    await writeFile(other, 'on disk\n');
    const scan = vi.fn((text: string): ReplayFinding[] => (text.includes('%date(') ? [{ replay: 'volatile', what: 'function:date', line: 0 }] : []));
    const snapshot = new ReadSnapshot(scan);
    // An editor has one of them open, with changes not saved.
    const read = snapshot.reader((path) => (path === other ? 'edited %date()\n' : undefined));
    for (let time = 0; time < 3; time++) {
      await read(root, common, INCLUDE_LIMITS.bytes);
      await read(root, other, INCLUDE_LIMITS.bytes);
    }

    expect(snapshot.delivered(common)).toEqual({ file: common, sha256: hash('Alice -> Bob\n'), origin: 'disk', findings: [] });
    expect(snapshot.delivered(other)).toEqual({
      file: other,
      sha256: hash('edited %date()\n'),
      origin: 'editor',
      findings: [{ replay: 'volatile', what: 'function:date', line: 0 }],
    });
    expect(scan).toHaveBeenCalledTimes(2);
    expect(snapshot.delivered(join(root, 'docs', 'never.puml'))).toBeUndefined();
  });

  it('reads saved files only when asked to, and keeps each file noted as open with unsaved changes once, in the order noted', () => {
    const other = join(root, 'docs', 'other.puml');
    expect(new ReadSnapshot(nothing).savedOnly).toBe(false);
    expect(new ReadSnapshot(nothing, {}).savedOnly).toBe(false);
    const snapshot = new ReadSnapshot(nothing, { savedOnly: true });

    expect(snapshot.savedOnly).toBe(true);
    expect(snapshot.unsaved()).toEqual([]);
    snapshot.noteUnsaved(other);
    snapshot.noteUnsaved(common);
    snapshot.noteUnsaved(other);
    expect(snapshot.unsaved()).toEqual([other, common]);
  });

  it('looks up where the diagrams of a document look for their files once', async () => {
    const snapshot = new ReadSnapshot(nothing);
    const look = vi.fn(() => Promise.resolve({ access, folder: root }));

    await snapshot.access('file:///ws/docs/a.md', look);
    await snapshot.access('file:///ws/docs/a.md', look);
    expect(look).toHaveBeenCalledTimes(1);
    await snapshot.access('file:///ws/docs/b.md', look);
    expect(look).toHaveBeenCalledTimes(2);
  });

  describe('read by include sessions', () => {
    /** A render's session, with the limits `fewer` lowers. */
    const sessionOf = (snapshot: ReadSnapshot, fewer: Partial<Record<keyof typeof INCLUDE_LIMITS, number>> = {}): IncludeSession =>
      new IncludeSession(access, closed, { ...INCLUDE_LIMITS, ...fewer } as typeof INCLUDE_LIMITS, snapshot.reader(closed));

    it('draws each drawing of an export from what was read first, though the file changed in between', async () => {
      const snapshot = new ReadSnapshot(nothing);
      const first = await sessionOf(snapshot).load('common.puml', null);
      await writeFile(common, 'Carol -> Dave\n');
      // The palette's drawing again, or another diagram's.
      const again = await sessionOf(snapshot).load('common.puml', null);

      expect(again).toEqual(first);
      expect(again.text).toBe('Alice -> Bob\n');
    });

    it('counts a file read before against the files, bytes and depth each render may read, as a file read now', async () => {
      const snapshot = new ReadSnapshot(nothing);
      await sessionOf(snapshot).load('nested.puml', null);
      await sessionOf(snapshot).load('common.puml', null);

      const few = sessionOf(snapshot, { files: 1 });
      await few.load('common.puml', null);
      await expect(few.load('common.puml', null)).rejects.toThrow();
      expect(few.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'files' });

      const small = sessionOf(snapshot, { bytes: 20 });
      await small.load('common.puml', null);
      await expect(small.load('common.puml', null)).rejects.toThrow();
      expect(small.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'bytes' });

      const shallow = sessionOf(snapshot, { depth: 1 });
      const outer = await shallow.load('nested.puml', null);
      await expect(shallow.load('common.puml', outer.id)).rejects.toThrow();
      expect(shallow.failures.at(-1)?.reason).toEqual({ kind: 'limit', limit: 'depth' });
    });

    it('keeps every path the sessions looked at, found there or not, once each, in the order first looked at', async () => {
      const snapshot = new ReadSnapshot(nothing);
      const later = join(root, 'docs', 'later.puml');
      const first = sessionOf(snapshot);
      await expect(first.load('later.puml', null)).rejects.toThrow();
      await first.load('common.puml', null);
      // Another drawing of the same export looks at them again.
      const second = sessionOf(snapshot);
      await second.load('common.puml', null);
      await second.load('nested.puml', null);

      expect(snapshot.looked()).toEqual([later, common, join(root, 'docs', 'nested.puml')]);
      expect(snapshot.looked()).toEqual([...new Set([...first.dependencies, ...second.dependencies])]);
    });
  });
});
