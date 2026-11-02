import { describe, expect, it, vi, type Mock } from 'vitest';

import type { ArtifactKey } from '../../src/export/history';
import { canonicalJson } from '../../src/export/manifest';
import {
  changedTerms,
  keyId,
  PERMIT_LIMIT,
  PERMIT_VERSION,
  PermitStore,
  readPermits,
  standingOf,
  storedPermits,
  withoutPermit,
  withPermit,
  type AutoExportPermit,
  type PermitTerms,
} from '../../src/export/permits';

const DOC = 'file:///repo/docs/design.md';

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

const terms = (name: string, overrides: Partial<PermitTerms> = {}): PermitTerms => ({
  output: `file:///repo/docs/images/${name}.svg`,
  root: 'file:///repo',
  context: { root: '/repo', folder: '/repo/docs', searchFolders: ['/repo/shared'] },
  includePaths: canonicalJson(['shared']),
  renderer: { engine: '1.2026.9', build: 'a'.repeat(64), contract: 1 },
  palette: 'light',
  ...overrides,
});

const generation = (count: number): string => count.toString(16).padStart(32, '0');

const permit = (name: string, overrides: Partial<AutoExportPermit> = {}): AutoExportPermit => ({
  key: key(name),
  ...terms(name),
  generation: generation(1),
  ...overrides,
});

const stored = (...permits: unknown[]): unknown => ({ schemaVersion: PERMIT_VERSION, permits });

/** Permissions for as many diagrams as can have one. */
const fullPermits = (): unknown => stored(...Array.from({ length: PERMIT_LIMIT }, (_, index) => permit(`d${String(index)}`)));

/** A store as the workspace's state is: what was last set, read back. */
function memory(initial: unknown = null): { get(): unknown; set: Mock<(value: unknown) => Promise<void>> } {
  let value = initial;
  return {
    get: () => value,
    set: vi.fn((next: unknown) => {
      value = next;
      return Promise.resolve();
    }),
  };
}

/**
 * A store that gives back what it had until a write is done, as the state
 * can while it is written in the background and the copy it gives back is
 * replaced by the one written before.
 */
function lagging(initial: unknown = null): { get(): unknown; set(value: unknown): Promise<void> } {
  let value = initial;
  return {
    get: () => value,
    set: (next: unknown) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          value = next;
          resolve();
        }, 0);
      }),
  };
}

describe('readPermits', () => {
  it('reads nothing stored as no permissions, which can be written', () => {
    for (const nothing of [null, undefined, 'permits', [], {}, { permits: [permit('a')] }]) {
      const read = readPermits(nothing);
      expect(read.writable, JSON.stringify(nothing)).toBe(true);
      expect(read.permits.size, JSON.stringify(nothing)).toBe(0);
    }
  });

  it('reads permissions of a version it does not know as none, and leaves them be', () => {
    const read = readPermits({ schemaVersion: PERMIT_VERSION + 1, permits: [permit('a')] });

    expect(read.writable).toBe(false);
    expect(read.permits.size).toBe(0);
  });

  it('reads permissions by their diagram', () => {
    const read = readPermits(stored(permit('a'), permit('b')));

    expect([...read.permits.keys()]).toEqual([keyId(key('a')), keyId(key('b'))]);
    expect(read.permits.get(keyId(key('b')))).toEqual(permit('b'));
  });

  it('goes by no permission a field of which is not as written', () => {
    const { generation: _generation, ...noGeneration } = permit('a');
    const broken: unknown[] = [
      noGeneration,
      { ...permit('a'), extra: true },
      permit('a', { key: key('a', { format: 'png' }) }),
      permit('a', { key: { ...key('a'), container: 'plantuml-file' } }),
      { ...permit('a'), output: 1 },
      { ...permit('a'), root: null },
      { ...permit('a'), includePaths: ['shared'] },
      { ...permit('a'), context: { root: '/repo' } },
      permit('a', { renderer: { engine: '1.2026.9', build: 'A'.repeat(64), contract: 1 } }),
      permit('a', { renderer: { engine: '1.2026.9', build: 'a'.repeat(63), contract: 1 } }),
      permit('a', { renderer: { engine: '1.2026.9', build: 'a'.repeat(64), contract: -1 } }),
      permit('a', { renderer: { engine: '1.2026.9', build: 'a'.repeat(64), contract: 1.5 } }),
      { ...permit('a'), renderer: { engine: '1.2026.9', build: 'a'.repeat(64), contract: 1, raster: null } },
      { ...permit('a'), palette: 'preview' },
      permit('a', { generation: 'G'.repeat(32) }),
      permit('a', { generation: generation(1).slice(1) }),
      null,
      'permit',
    ];
    for (const row of broken) {
      expect(readPermits(stored(row)).permits.size, JSON.stringify(row)).toBe(0);
    }
    // Each such row is left out, and the rest read.
    expect([...readPermits(stored(...broken, permit('b'))).permits.values()]).toEqual([permit('b')]);
  });

  it('goes by neither of two permissions for one diagram', () => {
    const read = readPermits(stored(permit('a'), permit('b'), permit('a', { generation: generation(2) })));

    expect([...read.permits.values()]).toEqual([permit('b')]);
  });

  it('takes a field named __proto__ as a field, without touching any object', () => {
    const row = JSON.parse(`{"__proto__":{"polluted":true},${JSON.stringify(permit('a')).slice(1)}`) as unknown;
    const named = permit('__proto__');

    expect(readPermits(stored(row)).permits.size).toBe(0);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect([...readPermits(stored(named)).permits.values()]).toEqual([named]);
  });
});

describe('withPermit and withoutPermit', () => {
  it('adds a permission, and replaces the one for the same diagram', () => {
    const one = withPermit(readPermits(null), permit('a'));
    expect(one).not.toBe('full');
    const two = withPermit(one as Exclude<typeof one, 'full'>, permit('a', { generation: generation(2), palette: 'dark' }));

    expect(two).not.toBe('full');
    expect([...(two as Exclude<typeof two, 'full'>).permits.values()]).toEqual([permit('a', { generation: generation(2), palette: 'dark' })]);
  });

  it('gives no diagram past the most a permission, without dropping another, but replaces one that has one', () => {
    const full = readPermits(fullPermits());
    expect(full.permits.size).toBe(PERMIT_LIMIT);

    expect(withPermit(full, permit('one-more'))).toBe('full');
    const replaced = withPermit(full, permit('d0', { generation: generation(2) }));
    expect(replaced).not.toBe('full');
    expect((replaced as Exclude<typeof replaced, 'full'>).permits.size).toBe(PERMIT_LIMIT);
  });

  it('takes out a permission; with a generation, only that one; and gives back the same permissions when there is none to take', () => {
    const read = readPermits(stored(permit('a'), permit('b')));

    expect([...withoutPermit(read, key('a')).permits.values()]).toEqual([permit('b')]);
    expect(withoutPermit(read, key('a'), generation(2))).toBe(read);
    expect([...withoutPermit(read, key('a'), generation(1)).permits.values()]).toEqual([permit('b')]);
    expect(withoutPermit(read, key('c'))).toBe(read);
  });

  it('stores the permissions as they are read back', () => {
    const read = readPermits(stored(permit('a'), permit('b', { palette: 'dark' })));

    expect(storedPermits(read)).toEqual(stored(permit('a'), permit('b', { palette: 'dark' })));
    expect(readPermits(JSON.parse(JSON.stringify(storedPermits(read)))).permits).toEqual(read.permits);
  });
});

describe('changedTerms and standingOf', () => {
  it('finds no term changed when each is as it was, the include context in any order of its fields', () => {
    const reordered = terms('a', { context: { searchFolders: ['/repo/shared'], folder: '/repo/docs', root: '/repo' } });

    expect(changedTerms(permit('a'), terms('a'))).toEqual([]);
    expect(changedTerms(permit('a'), reordered)).toEqual([]);
  });

  it('names each term that is otherwise now, in a fixed order', () => {
    expect(changedTerms(permit('a'), terms('a', { output: 'file:///repo/docs/out/a.svg' }))).toEqual(['output']);
    expect(changedTerms(permit('a'), terms('a', { root: 'file:///other' }))).toEqual(['root']);
    expect(changedTerms(permit('a'), terms('a', { context: { unavailable: 'setting' } }))).toEqual(['context']);
    expect(changedTerms(permit('a'), terms('a', { context: null }))).toEqual(['context']);
    expect(changedTerms(permit('a'), terms('a', { includePaths: canonicalJson(['shared', 'more']) }))).toEqual(['includePaths']);
    for (const renderer of [
      { engine: '1.2026.10', build: 'a'.repeat(64), contract: 1 },
      { engine: '1.2026.9', build: 'b'.repeat(64), contract: 1 },
      { engine: '1.2026.9', build: 'a'.repeat(64), contract: 2 },
    ]) {
      expect(changedTerms(permit('a'), terms('a', { renderer })), JSON.stringify(renderer)).toEqual(['renderer']);
    }
    expect(changedTerms(permit('a'), terms('a', { palette: 'dark' }))).toEqual(['palette']);
    expect(
      changedTerms(permit('a'), terms('a', { palette: 'dark', output: 'file:///x.svg', includePaths: '[]', root: 'file:///other' }))
    ).toEqual(['output', 'root', 'includePaths', 'palette']);
  });

  it('says whether a diagram has a permission, and whether it was given under the same terms', () => {
    expect(standingOf(null, terms('a'))).toEqual({ standing: 'none' });
    expect(standingOf(permit('a'), terms('a'))).toEqual({ standing: 'same', permit: permit('a') });
    expect(standingOf(permit('a'), terms('a', { palette: 'dark' }))).toEqual({
      standing: 'changed',
      permit: permit('a'),
      changed: ['palette'],
    });
  });
});

describe('PermitStore', () => {
  it('keeps a permission, and gives it back by its diagram', async () => {
    const store = memory();
    const permits = new PermitStore(store);

    expect(await permits.add(permit('a'))).toBe('saved');

    expect(permits.of(key('a'))).toEqual(permit('a'));
    expect(permits.of(key('b'))).toBeNull();
    expect(permits.all()).toEqual([permit('a')]);
    expect(permits.writable()).toBe(true);
    expect(store.get()).toEqual(stored(permit('a')));
  });

  it('keeps every permission given at once, each change written once the one before is', async () => {
    for (const store of [memory(), lagging()]) {
      const permits = new PermitStore(store);

      await Promise.all(['a', 'b', 'c'].map((name) => permits.add(permit(name))));

      expect([...readPermits(store.get()).permits.values()]).toEqual([permit('a'), permit('b'), permit('c')]);
      expect(permits.all()).toEqual([permit('a'), permit('b'), permit('c')]);

      await Promise.all([permits.remove(key('a')), permits.add(permit('d')), permits.remove(key('c'))]);

      expect([...readPermits(store.get()).permits.values()]).toEqual([permit('b'), permit('d')]);
    }
  });

  it('replaces the permission of a diagram given one again', async () => {
    const permits = new PermitStore(memory(stored(permit('a'))));

    expect(await permits.add(permit('a', { generation: generation(2) }))).toBe('saved');

    expect(permits.all()).toEqual([permit('a', { generation: generation(2) })]);
  });

  it('takes out a permission; with a generation, only if it is still that one', async () => {
    const store = memory(stored(permit('a'), permit('b')));
    const permits = new PermitStore(store);

    expect(await permits.remove(key('a'), generation(2))).toBe('saved');
    expect(store.set).not.toHaveBeenCalled();
    expect(permits.of(key('a'))).toEqual(permit('a'));

    expect(await permits.remove(key('a'), generation(1))).toBe('saved');
    expect(await permits.remove(key('b'))).toBe('saved');
    expect(permits.all()).toEqual([]);
    expect(store.get()).toEqual(stored());

    // None to take out: nothing is written.
    store.set.mockClear();
    expect(await permits.remove(key('a'))).toBe('saved');
    expect(store.set).not.toHaveBeenCalled();
  });

  it('does not write over permissions of a later version', async () => {
    const later = { schemaVersion: PERMIT_VERSION + 1, permits: [{ anything: true }] };
    const store = memory(later);
    const permits = new PermitStore(store);

    expect(permits.writable()).toBe(false);
    expect(permits.all()).toEqual([]);
    expect(await permits.add(permit('a'))).toBe('later-version');
    expect(await permits.remove(key('a'))).toBe('later-version');
    expect(store.set).not.toHaveBeenCalled();
    expect(store.get()).toBe(later);
  });

  it('gives no diagram past the most a permission', async () => {
    const store = memory(fullPermits());
    const permits = new PermitStore(store);

    expect(await permits.add(permit('one-more'))).toBe('full');
    expect(store.set).not.toHaveBeenCalled();
    expect(await permits.add(permit('d0', { generation: generation(2) }))).toBe('saved');
  });

  it('says when the state does not take the permissions, and keeps them again after', async () => {
    const store = memory();
    store.set.mockRejectedValueOnce(new Error('disk full'));
    const heard = vi.fn();
    const permits = new PermitStore(store);

    expect(await permits.add(permit('a'), heard)).toBe('not-saved');
    expect(heard).toHaveBeenCalledWith(new Error('disk full'));
    expect(permits.all()).toEqual([]);
    expect(await permits.add(permit('b'))).toBe('saved');
    expect(permits.all()).toEqual([permit('b')]);
  });

  it('reads the state again once something else changed it', async () => {
    const store = memory();
    const permits = new PermitStore(store);
    await permits.add(permit('a'));

    await store.set(stored(permit('b')));

    expect(permits.all()).toEqual([permit('b')]);
  });

  it('tells each change kept, once it can be read back, and nothing else', async () => {
    const store = memory();
    const permits = new PermitStore(store);
    const seen: string[][] = [];
    const listening = permits.onDidChange(() => {
      seen.push(permits.all().map(({ key: { name } }) => name));
    });

    await permits.add(permit('a'));
    await permits.add(permit('b'));
    await permits.remove(key('a'));
    // Nothing to take out, nothing kept: nothing to tell.
    await permits.remove(key('a'));
    store.set.mockRejectedValueOnce(new Error('disk full'));
    await permits.add(permit('c'));
    expect(seen).toEqual([['a'], ['a', 'b'], ['b']]);

    listening.dispose();
    await permits.add(permit('d'));
    expect(seen).toHaveLength(3);
  });

  it('keeps a change though a listener fails, and tells the others', async () => {
    const permits = new PermitStore(memory());
    const after = vi.fn();
    permits.onDidChange(() => {
      throw new Error('listener');
    });
    permits.onDidChange(after);

    expect(await permits.add(permit('a'))).toBe('saved');
    expect(after).toHaveBeenCalledTimes(1);
    expect(permits.all()).toEqual([permit('a')]);
  });
});
