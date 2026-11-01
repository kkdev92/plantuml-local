/**
 * What the export commands wrote, per diagram, so that exporting a diagram
 * again can replace its own file without asking, while a file put there by
 * hand, exported for another diagram or changed since is still asked about.
 *
 * Each file is recorded by its URI, with the diagram it was written for (an
 * {@link ArtifactKey}) and a SHA-256 of the bytes written: no diagram source
 * and no image. The records live in the workspace's state, which stays on
 * this machine; elsewhere, or once they are gone, the export asks as it
 * would about any other file.
 *
 * Earlier versions recorded each file with the document it was exported
 * from instead (src/export/ownership.ts). Those records are read and never
 * written: a file only they know is replaced once that is confirmed, and is
 * recorded here from then on.
 *
 * Like the exporter, this module has no dependency on the `vscode` module:
 * the state arrives through {@link HistoryStore}.
 */

import type { NameBasis, PlantUmlBlock } from './blocks';
import { isLastExport, sha256, type ExportRecords } from './ownership';

/** Which diagram an exported file was written for. */
export interface ArtifactKey {
  /** The URI of the document the diagram is in, as the document gives it. */
  readonly documentUri: string;
  /** A Markdown document, whose fences hold the diagrams, or a PlantUML file. */
  readonly container: 'markdown' | 'plantuml-file';
  readonly nameBasis: NameBasis;
  readonly name: string;
  /** A diagram within a block's: none, as a block is exported whole. */
  readonly childId: null;
  /** A page of a diagram: none, as a diagram is exported whole. */
  readonly page: null;
  readonly format: 'svg' | 'png';
}

/** The record of an exported file: the diagram it was written for, and what was written. */
export interface ArtifactRecord {
  readonly key: ArtifactKey;
  /** The URI of the file. */
  readonly output: string;
  /** The SHA-256 of the bytes written, in hex. */
  readonly sha256: string;
}

/** The version of the shape the records are stored in. */
export const HISTORY_VERSION = 2;

/** The most files recorded, and the most bytes the records take as JSON. */
export const HISTORY_LIMITS = { artifacts: 2000, bytes: 16 * 1024 * 1024 } as const;

/** The records as read. */
export interface History {
  /**
   * Whether they can be written: not when they are of a version this one
   * does not know, which a later one wrote. Those are read as no records,
   * and left as they are.
   */
  readonly writable: boolean;
  /** By the URI of the file. */
  readonly records: ReadonlyMap<string, ArtifactRecord>;
  /** The UTF-8 bytes of each record as JSON, added up. */
  readonly bytes: number;
}

/**
 * What became of a record: kept; or not kept, there being no room for it,
 * the records being of a later version, or the state not taking them.
 */
export type RecordResult = 'recorded' | 'full' | 'later-version' | 'not-saved';

const NAME_BASES: ReadonlySet<unknown> = new Set<NameBasis>(['fence', 'explicit-id', 'single-file-name']);
const SHA256 = /^[0-9a-f]{64}$/;

/** The JSON around the records as they are stored: `{"schemaVersion":2,"artifacts":[` and `]}`. */
const ENVELOPE_BYTES = `{"schemaVersion":${String(HISTORY_VERSION)},"artifacts":[]}`.length;

/**
 * The key an export of `block` under `name` is recorded under, or null when
 * `name` is not the name the block gives itself: a name asked for when the
 * export ran is the diagram's for that export only.
 */
export function artifactKey(
  documentUri: string,
  block: Pick<PlantUmlBlock, 'name' | 'nameBasis'>,
  name: string,
  format: 'svg' | 'png'
): ArtifactKey | null {
  if (block.nameBasis === null || block.name !== name) {
    return null;
  }
  return {
    documentUri,
    container: block.nameBasis === 'fence' ? 'markdown' : 'plantuml-file',
    nameBasis: block.nameBasis,
    name,
    childId: null,
    page: null,
    format,
  };
}

/** Whether two keys are the same diagram's. */
export function sameKey(a: ArtifactKey, b: ArtifactKey): boolean {
  return (
    a.documentUri === b.documentUri &&
    a.container === b.container &&
    a.nameBasis === b.nameBasis &&
    a.name === b.name &&
    a.childId === b.childId &&
    a.page === b.page &&
    a.format === b.format
  );
}

/** Whether `value` is an object of its own, rather than null or an array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a key as this version writes one. */
function isArtifactKey(value: unknown): value is ArtifactKey {
  if (!isObject(value) || !NAME_BASES.has(value['nameBasis'])) {
    return false;
  }
  const container = value['nameBasis'] === 'fence' ? 'markdown' : 'plantuml-file';
  return (
    typeof value['documentUri'] === 'string' &&
    value['container'] === container &&
    typeof value['name'] === 'string' &&
    value['childId'] === null &&
    value['page'] === null &&
    (value['format'] === 'svg' || value['format'] === 'png')
  );
}

/** Whether `value` is a record as this version writes one. */
function isArtifactRecord(value: unknown): value is ArtifactRecord {
  return (
    isObject(value) &&
    isArtifactKey(value['key']) &&
    typeof value['output'] === 'string' &&
    typeof value['sha256'] === 'string' &&
    SHA256.test(value['sha256'])
  );
}

/** The UTF-8 bytes of a record as JSON. */
function sizeOf(record: ArtifactRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

/** The UTF-8 bytes the records take as stored. */
export function storedBytes(history: History): number {
  return ENVELOPE_BYTES + history.bytes + Math.max(history.records.size - 1, 0);
}

/**
 * Reads the records as stored. Only a record whose every field is as this
 * version writes it counts; two for the same file count for neither, since
 * which one to believe cannot be told. Records are kept by file in a Map, so
 * a URI such as `__proto__` is a key like any other.
 */
export function readHistory(stored: unknown): History {
  const none = { writable: true, records: new Map<string, ArtifactRecord>(), bytes: 0 };
  if (!isObject(stored) || typeof stored['schemaVersion'] !== 'number') {
    return none;
  }
  if (stored['schemaVersion'] !== HISTORY_VERSION) {
    return { ...none, writable: false };
  }
  const rows = Array.isArray(stored['artifacts']) ? (stored['artifacts'] as unknown[]) : [];
  const records = new Map<string, ArtifactRecord>();
  const doubled = new Set<string>();
  for (const row of rows) {
    if (!isArtifactRecord(row)) {
      continue;
    }
    if (records.has(row.output)) {
      doubled.add(row.output);
    }
    records.set(row.output, row);
  }
  for (const output of doubled) {
    records.delete(output);
  }
  let bytes = 0;
  for (const record of records.values()) {
    bytes += sizeOf(record);
  }
  return { writable: true, records, bytes };
}

/**
 * The records with `record` in place of any for the same file, or 'full'
 * when there is no room for it: the limits are never made room for by
 * dropping another file's record. The same object when it is there already.
 */
export function withRecord(history: History, record: ArtifactRecord): History | 'full' {
  const before = history.records.get(record.output);
  if (before !== undefined && sameKey(before.key, record.key) && before.sha256 === record.sha256) {
    return history;
  }
  if (before === undefined && history.records.size >= HISTORY_LIMITS.artifacts) {
    return 'full';
  }
  const records = new Map(history.records);
  records.set(record.output, record);
  const next = { writable: true, records, bytes: history.bytes - (before === undefined ? 0 : sizeOf(before)) + sizeOf(record) };
  return storedBytes(next) > HISTORY_LIMITS.bytes ? 'full' : next;
}

/** The records in the shape they are stored in. */
export function storedHistory(history: History): { schemaVersion: number; artifacts: ArtifactRecord[] } {
  return { schemaVersion: HISTORY_VERSION, artifacts: [...history.records.values()] };
}

/** Where the records are kept: the workspace's state. */
export interface HistoryStore {
  get(): unknown;
  set(value: unknown): Promise<void>;
}

/**
 * The records of the exports in this window, and the files they are about:
 * the records updated one at a time, each read afresh, so that two exports
 * at once do not drop each other's; and each file written by one export at
 * a time.
 */
export class ExportLedger {
  private updates: Promise<unknown> = Promise.resolve();
  private readonly writing = new Map<string, Promise<void>>();
  private read: { stored: unknown; history: History } | null = null;

  constructor(
    private readonly store: HistoryStore,
    private readonly earlier: () => ExportRecords
  ) {}

  /** The records as they are now, read again only once they change. */
  private history(): History {
    const stored = this.store.get();
    if (this.read === null || this.read.stored !== stored) {
      this.read = { stored, history: readHistory(stored) };
    }
    return this.read.history;
  }

  /** The record of the file at `output`, or null when there is none to go by. */
  ownerOf(output: string): ArtifactRecord | null {
    return this.history().records.get(output) ?? null;
  }

  /**
   * Whether `existing`, the file at `output`, is what an earlier version
   * recorded exporting there from `document`, unchanged since.
   */
  wroteBefore(output: string, document: string, existing: Uint8Array): boolean {
    return isLastExport(this.earlier(), output, document, existing);
  }

  /**
   * Records that `content` was written to `output` for the diagram `key`
   * names. Never rejects: `onError` hears why the state did not take it.
   */
  record(
    key: ArtifactKey,
    output: string,
    content: Uint8Array,
    onError?: (error: unknown) => void
  ): Promise<RecordResult> {
    const update = async (): Promise<RecordResult> => {
      try {
        const history = this.history();
        if (!history.writable) {
          return 'later-version';
        }
        const next = withRecord(history, { key, output, sha256: sha256(content) });
        if (next === 'full') {
          return 'full';
        }
        if (next !== history) {
          await this.store.set(storedHistory(next));
          // The state keeps a copy of what it is given, and gives that copy
          // back until the next update: known, so not read again.
          this.read = { stored: this.store.get(), history: next };
        }
        return 'recorded';
      } catch (error: unknown) {
        onError?.(error);
        return 'not-saved';
      }
    };
    const result = this.updates.then(update, update);
    this.updates = result;
    return result;
  }

  /**
   * Runs `task` once no other export in this window is writing the file at
   * `output`. Files are told apart regardless of case, as Windows and macOS
   * tell them apart. Other windows and programs are not held off: what they
   * do is caught by looking at the file again once the turn comes.
   */
  lock<T>(output: string, task: () => Promise<T>): Promise<T> {
    const file = output.toLowerCase();
    const result = (this.writing.get(file) ?? Promise.resolve()).then(task);
    const done = result.then(
      () => undefined,
      () => undefined
    );
    this.writing.set(file, done);
    void done.then(() => {
      if (this.writing.get(file) === done) {
        this.writing.delete(file);
      }
    });
    return result;
  }
}
