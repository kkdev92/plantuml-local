import { describe, expect, it, vi, type Mock } from 'vitest';

import { findFileDiagrams, findPlantUmlBlocks } from '../../src/export/blocks';
import {
  artifactKey,
  ExportLedger,
  HISTORY_LIMITS,
  readHistory,
  sameKey,
  storedBytes,
  storedHistory,
  withRecord,
  type ArtifactKey,
  type ArtifactRecord,
  type History,
} from '../../src/export/history';
import { inputManifest, type InputManifest } from '../../src/export/manifest';
import { sha256 } from '../../src/export/ownership';

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

const record = (name: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  key: key(name),
  output: `file:///repo/docs/images/${name}.svg`,
  sha256: sha256(new TextEncoder().encode(name)),
  ...overrides,
});

const stored = (...artifacts: unknown[]): unknown => ({ schemaVersion: 2, artifacts });

/** Records of as many files as are kept. */
const fullRecords = (): unknown =>
  stored(...Array.from({ length: HISTORY_LIMITS.artifacts }, (_, index) => record(`d${String(index)}`)));

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

describe('artifactKey', () => {
  it('keys a fenced diagram by its document, its name and the format', () => {
    const [block] = findPlantUmlBlocks('```plantuml orders\nA -> B\n```');

    expect(artifactKey(DOC, block!, 'orders', 'png')).toEqual(key('orders', { format: 'png' }));
  });

  it('keys the diagrams of a PlantUML file by where their names come from', () => {
    const [byId] = findFileDiagrams('@startuml(id=orders)\nA -> B\n@enduml', 'flows');
    const [byFile] = findFileDiagrams('@startuml\nA -> B\n@enduml', 'flows');

    expect(artifactKey('file:///repo/flows.puml', byId!, 'orders', 'svg')).toMatchObject({
      container: 'plantuml-file',
      nameBasis: 'explicit-id',
      name: 'orders',
    });
    expect(artifactKey('file:///repo/flows.puml', byFile!, 'flows', 'svg')).toMatchObject({
      container: 'plantuml-file',
      nameBasis: 'single-file-name',
      name: 'flows',
    });
  });

  it('gives no key to a name the diagram does not give itself', () => {
    const [unnamed] = findPlantUmlBlocks('```plantuml\nA -> B\n```');
    const [named] = findPlantUmlBlocks('```plantuml my diagram\nA -> B\n```');

    expect(artifactKey(DOC, unnamed!, 'orders', 'svg')).toBeNull();
    expect(artifactKey(DOC, named!, 'orders', 'svg')).toBeNull();
  });

  it('tells keys apart by every part', () => {
    expect(sameKey(key('orders'), key('orders'))).toBe(true);
    for (const other of [
      key('Orders'),
      key('orders', { documentUri: 'file:///repo/docs/other.md' }),
      key('orders', { format: 'png' }),
      key('orders', { container: 'plantuml-file', nameBasis: 'explicit-id' }),
      key('orders', { container: 'plantuml-file', nameBasis: 'single-file-name' }),
    ]) {
      expect(sameKey(key('orders'), other)).toBe(false);
    }
  });
});

describe('readHistory', () => {
  it('reads nothing stored as no records, which can be written', () => {
    for (const nothing of [null, undefined, 'text', 42, [], {}, { artifacts: [] }, { schemaVersion: '2' }]) {
      const history = readHistory(nothing);
      expect(history.writable, JSON.stringify(nothing)).toBe(true);
      expect(history.records.size).toBe(0);
    }
  });

  it('reads records of a version it does not know as none, and leaves them be', () => {
    for (const version of [1, 3, 2.5]) {
      const history = readHistory({ schemaVersion: version, artifacts: [record('orders')] });
      expect(history.writable).toBe(false);
      expect(history.records.size).toBe(0);
    }
  });

  it('reads records by the file they are about', () => {
    const history = readHistory(stored(record('orders'), record('billing')));

    expect(history.writable).toBe(true);
    expect([...history.records.keys()]).toEqual(['file:///repo/docs/images/orders.svg', 'file:///repo/docs/images/billing.svg']);
    expect(history.records.get('file:///repo/docs/images/orders.svg')?.key).toEqual(key('orders'));
  });

  it('goes by no record a field of which is not as written', () => {
    const broken: unknown[] = [
      null,
      'orders',
      { ...record('a'), sha256: 'abc' },
      { ...record('b'), sha256: record('b').sha256.toUpperCase() },
      { ...record('c'), output: 7 },
      { ...record('d'), key: { ...key('d'), container: 'plantuml-file' } },
      { ...record('e'), key: { ...key('e'), nameBasis: 'position' } },
      { ...record('f'), key: { ...key('f'), childId: 'inner' } },
      { ...record('g'), key: { ...key('g'), page: 1 } },
      { ...record('h'), key: { ...key('h'), format: 'pdf' } },
      { ...record('i'), key: { ...key('i'), name: undefined } },
      { ...record('j'), key: null },
    ];

    const history = readHistory(stored(...broken, record('kept')));

    expect([...history.records.keys()]).toEqual(['file:///repo/docs/images/kept.svg']);
  });

  it('goes by neither of two records of one file', () => {
    const history = readHistory(stored(record('orders'), record('orders', { key: key('other') }), record('billing')));

    expect([...history.records.keys()]).toEqual(['file:///repo/docs/images/billing.svg']);
  });

  it('takes a file named __proto__ as a file, without touching any object', () => {
    const parsed: unknown = JSON.parse(
      JSON.stringify(stored(record('x', { output: '__proto__' }), record('y', { output: 'constructor' })))
    );

    const history = readHistory(parsed);

    expect([...history.records.keys()]).toEqual(['__proto__', 'constructor']);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['sha256']).toBeUndefined();
  });

  it('keeps what else a record carries, for a version that writes more', () => {
    const richer = { ...record('orders'), manifest: { inputs: [] } };

    const history = readHistory(stored(richer));

    expect(storedHistory(history).artifacts).toEqual([richer]);
  });
});

describe('withRecord', () => {
  const empty = readHistory(null);

  it('adds a record, and replaces the record of the same file', () => {
    const one = withRecord(empty, record('orders'));
    const replaced = withRecord(one as History, record('orders', { key: key('orders', { documentUri: 'file:///repo/docs/other.md' }) }));

    expect((one as History).records.size).toBe(1);
    expect((replaced as History).records.size).toBe(1);
    expect((replaced as History).records.get(record('orders').output)?.key.documentUri).toBe('file:///repo/docs/other.md');
  });

  it('gives back the same records when they say so already', () => {
    const one = withRecord(empty, record('orders')) as History;

    expect(withRecord(one, record('orders'))).toBe(one);
  });

  it('records no new file past the most files, without dropping another', () => {
    const history = readHistory(fullRecords());

    expect(history.records.size).toBe(HISTORY_LIMITS.artifacts);
    expect(withRecord(history, record('one-more'))).toBe('full');
    // A file recorded already is recorded anew.
    const again = withRecord(history, record('d7', { sha256: sha256(new TextEncoder().encode('changed')) }));
    expect(again).not.toBe('full');
    expect((again as History).records.size).toBe(HISTORY_LIMITS.artifacts);
  });

  it('records nothing past the most bytes', () => {
    const long = (name: string): ArtifactRecord =>
      record(name, { key: key(name, { documentUri: `file:///repo/${'x'.repeat(5 * 1024 * 1024)}.md` }) });
    let history = empty;
    for (const name of ['a', 'b', 'c']) {
      history = withRecord(history, long(name)) as History;
    }

    expect(withRecord(history, long('d'))).toBe('full');
  });

  it('counts the bytes the records take as they are stored', () => {
    let history = empty;
    expect(storedBytes(history)).toBe(JSON.stringify(storedHistory(history)).length);
    for (const name of ['orders', 'naïve', '注文']) {
      history = withRecord(history, record(name)) as History;
      expect(storedBytes(history)).toBe(new TextEncoder().encode(JSON.stringify(storedHistory(history))).byteLength);
    }
    history = withRecord(history, record('orders', { sha256: sha256(new TextEncoder().encode('changed')) })) as History;
    expect(storedBytes(history)).toBe(new TextEncoder().encode(JSON.stringify(storedHistory(history))).byteLength);
    expect(storedBytes(readHistory(storedHistory(history)))).toBe(storedBytes(history));
  });
});

describe('ExportLedger', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('records what was written, and gives it back by file', async () => {
    const store = memory();
    const ledger = new ExportLedger(store, () => ({}));

    expect(await ledger.record(key('orders'), record('orders').output, bytes('<svg/>'))).toBe('recorded');

    expect(ledger.ownerOf(record('orders').output)).toEqual({ key: key('orders'), output: record('orders').output, sha256: sha256(bytes('<svg/>')) });
    expect(store.get()).toEqual(stored({ key: key('orders'), output: record('orders').output, sha256: sha256(bytes('<svg/>')) }));
  });

  it('keeps every record of exports that end at once', async () => {
    const store = memory();
    const ledger = new ExportLedger(store, () => ({}));

    await Promise.all(['a', 'b', 'c'].map((name) => ledger.record(key(name), record(name).output, bytes(name))));

    expect(readHistory(store.get()).records.size).toBe(3);
  });

  it('does not write over records of a later version', async () => {
    const later = { schemaVersion: 3, artifacts: [{ anything: true }] };
    const store = memory(later);
    const ledger = new ExportLedger(store, () => ({}));

    expect(await ledger.record(key('orders'), record('orders').output, bytes('<svg/>'))).toBe('later-version');
    expect(ledger.ownerOf(record('orders').output)).toBeNull();
    expect(store.set).not.toHaveBeenCalled();
    expect(store.get()).toBe(later);
  });

  it('says when there is no room, and when the state does not take the records', async () => {
    const full = memory(fullRecords());
    const refusing = { get: (): unknown => null, set: vi.fn(() => Promise.reject(new Error('disk full'))) };
    const heard = vi.fn();

    expect(await new ExportLedger(full, () => ({})).record(key('orders'), record('orders').output, bytes('x'))).toBe('full');
    expect(full.set).not.toHaveBeenCalled();
    expect(await new ExportLedger(refusing, () => ({})).record(key('orders'), record('orders').output, bytes('x'), undefined, heard)).toBe(
      'not-saved'
    );
    expect(heard).toHaveBeenCalledWith(new Error('disk full'));
  });

  it('records again after a record the state did not take', async () => {
    const store = memory();
    store.set.mockRejectedValueOnce(new Error('busy'));
    const ledger = new ExportLedger(store, () => ({}));

    expect(await ledger.record(key('a'), record('a').output, bytes('a'))).toBe('not-saved');
    expect(await ledger.record(key('b'), record('b').output, bytes('b'))).toBe('recorded');
    expect([...readHistory(store.get()).records.keys()]).toEqual([record('b').output]);
  });

  it('gives back the records of one document, as its URI is recorded, and none of a later version', () => {
    const other = record('other', { key: key('other', { documentUri: 'file:///repo/docs/other.md' }) });
    const ledger = new ExportLedger(memory(stored(record('a'), other, record('b'))), () => ({}));

    expect(ledger.recordsOf(DOC)).toEqual([record('a'), record('b')]);
    expect(ledger.recordsOf('file:///repo/docs/other.md')).toEqual([other]);
    expect(ledger.recordsOf('file:///repo/docs/Design.md')).toEqual([]);
    expect(new ExportLedger(memory({ schemaVersion: 3, artifacts: [record('a')] }), () => ({})).recordsOf(DOC)).toEqual([]);
  });

  it('reads what an earlier version recorded', () => {
    const ledger = new ExportLedger(memory(), () => ({ [record('orders').output]: { document: DOC, sha256: sha256(bytes('<svg/>')) } }));

    expect(ledger.wroteBefore(record('orders').output, DOC, bytes('<svg/>'))).toBe(true);
    expect(ledger.wroteBefore(record('orders').output, DOC, bytes('<svg>changed</svg>'))).toBe(false);
    expect(ledger.wroteBefore(record('orders').output, 'file:///repo/docs/other.md', bytes('<svg/>'))).toBe(false);
  });

  it('lets one export at a time write a file, told apart regardless of case', async () => {
    const ledger = new ExportLedger(memory(), () => ({}));
    const order: string[] = [];
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = ledger.lock('file:///repo/images/Orders.svg', async () => {
      order.push('first starts');
      await held;
      order.push('first ends');
    });
    const second = ledger.lock('file:///repo/images/orders.svg', () => {
      order.push('second');
      return Promise.resolve();
    });
    const other = ledger.lock('file:///repo/images/billing.svg', () => {
      order.push('other');
      return Promise.resolve();
    });
    await other;
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['first starts', 'other', 'first ends', 'second']);
  });

  it('gives the next export its turn when one fails', async () => {
    const ledger = new ExportLedger(memory(), () => ({}));

    const failing = ledger.lock('file:///repo/images/orders.svg', () => Promise.reject(new Error('EACCES')));
    const next = ledger.lock('file:///repo/images/orders.svg', () => Promise.resolve('written'));

    await expect(failing).rejects.toThrow('EACCES');
    await expect(next).resolves.toBe('written');
  });
});

describe('the inputs a record carries', () => {
  /** What an image of the diagram `name` was drawn from: a file it included, holding `text`. */
  const inputFor = (name: string, text = 'A -> B'): InputManifest => {
    const manifest = inputManifest({
      key: key(name),
      source: '!include a.puml',
      render: '!include a.puml',
      drawn: {
        svg: '<svg/>',
        failedIncludes: new Map(),
        dependencies: [],
        inputs: {
          context: { root: '/repo', folder: '/repo/docs', searchFolders: [] },
          requests: [{ path: 'a.puml', from: null, kind: 'include', outcome: 'read', file: '/repo/docs/a.puml', looked: [] }],
          files: [{ file: '/repo/docs/a.puml', sha256: sha256(new TextEncoder().encode(text)), origin: 'disk', findings: [] }],
        },
      },
      dark: { asked: false, drawn: false },
      format: 'svg',
      pngScale: null,
      renderer: { engine: '1.2026.9', build: 'b'.repeat(64), raster: 'c'.repeat(64) },
      losses: 0,
    });
    if (manifest === null) {
      throw new Error('expected a manifest');
    }
    return manifest;
  };
  /** As the state gives it back: stored as JSON. */
  const readBack = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

  it('keeps a record with what its image was drawn from, as written, stored and read back', () => {
    const drawn = record('orders', { input: inputFor('orders') });

    expect(readHistory(readBack(stored(drawn))).records.get(drawn.output)).toEqual(drawn);
  });

  it('goes by no record whose inputs are not as this version writes them, or not those of its diagram', () => {
    const tampered = readBack(inputFor('b')) as InputManifest;
    tampered.resources.files[0]!.sha256 = sha256(new TextEncoder().encode('another text'));
    const later = { ...inputFor('d'), schema: 'plantuml-local-input-v2' };

    const history = readHistory(
      readBack(
        stored(
          record('a', { input: inputFor('another') }),
          { ...record('b'), input: tampered },
          { ...record('c'), input: null },
          { ...record('d'), input: later },
          record('e', { input: inputFor('e') })
        )
      )
    );

    expect([...history.records.keys()]).toEqual([record('e').output]);
  });

  it('records again what a file was drawn from when only that changed, and gives back the same records when nothing did', () => {
    const empty = readHistory(null);
    const first = withRecord(empty, record('orders', { input: inputFor('orders') })) as History;

    expect(withRecord(first, record('orders', { input: inputFor('orders') }))).toBe(first);
    const changed = withRecord(first, record('orders', { input: inputFor('orders', 'C -> D') })) as History;
    expect(changed).not.toBe(first);
    expect(changed.records.get(record('orders').output)?.input).toEqual(inputFor('orders', 'C -> D'));
    expect((withRecord(changed, record('orders')) as History).records.get(record('orders').output)).not.toHaveProperty('input');
  });

  it('stores what the file was drawn from with the record of what was written', async () => {
    const store = memory();
    const ledger = new ExportLedger(store, () => ({}));

    expect(await ledger.record(key('orders'), record('orders').output, new TextEncoder().encode('<svg/>'), inputFor('orders'))).toBe('recorded');
    expect(ledger.ownerOf(record('orders').output)?.input).toEqual(inputFor('orders'));
    expect(readHistory(readBack(store.get())).records.get(record('orders').output)?.input).toEqual(inputFor('orders'));
  });
});
