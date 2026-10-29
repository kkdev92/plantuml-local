import type { DrawingLog, DrawnRequest } from '../core/types';
import type { Render } from '../render/memo';
import { changeTo, MAX_REMEMBERED } from './tracking';

/**
 * The last drawing of each diagram drawn for a document, with what it asked
 * for: what the list of a diagram's dependencies shows.
 *
 * Drawings of one diagram can finish in another order than they started
 * in; a drawing does not replace one that started after it. A drawing is
 * out of date once a file it read, or looked for and found none at,
 * changes, even while it is being drawn: a change counts against every
 * drawing started before it. A drawing for a document closed while it was
 * drawn is not kept. As the watcher of the included files does, this keeps
 * the last {@link MAX_REMEMBERED} drawings.
 *
 * No dependency on the `vscode` module.
 */

/** A drawing the engine failed, with what it asked for first. */
export class DrawingFailure extends Error {
  constructor(
    message: string,
    readonly log: DrawingLog,
    /** The paths it read or looked at, as compared with file events. */
    readonly dependencies: readonly string[]
  ) {
    super(message);
  }
}

/** A drawing of a diagram for a document. */
export interface DrawingRecord {
  /** The document, as a URI. */
  readonly document: string;
  /** The diagram's text, as drawn. */
  readonly source: string;
  readonly log: DrawingLog;
  /** The engine's error, when it drew nothing. */
  readonly error?: string;
  /** Whether a file it read or looked at changed after it started, or what it may read did. */
  readonly stale: boolean;
  /** For each request that found no file, the file a drawing before read for it, by {@link requestKey}. */
  readonly readBefore: ReadonlyMap<string, string>;
}

interface Kept extends DrawingRecord {
  /** Counts drawings as they start. */
  turn: number;
  /** The paths it read or looked at, as compared with file events. */
  dependencies: readonly string[];
  stale: boolean;
}

/** Tells the requests of one drawing apart: the engine asks once for each path, file asked from and operation. */
export function requestKey(request: Pick<DrawnRequest, 'path' | 'from' | 'kind'>): string {
  return `${request.kind ?? ''}\n${request.from ?? ''}\n${request.path}`;
}

const NOTHING: DrawingLog = { requests: [], libraries: [] };

export class DrawingRecords {
  /** By document and text; insertion order is the order to forget them in. */
  private readonly kept = new Map<string, Kept>();
  private turns = 0;
  /** The turns of the drawings running. */
  private readonly running = new Set<number>();
  /** Changes to files, each after the turn last started, while a drawing started before it runs. */
  private changes: { after: number; paths: ReadonlyMap<string, boolean> }[] = [];
  /** Documents closed, each after the turn last started, while a drawing started before it runs. */
  private closed: { after: number; document: string }[] = [];
  private readonly listeners = new Set<(document: string) => void>();

  constructor(private readonly most = MAX_REMEMBERED) {}

  /** `render`, keeping each drawing it makes for a document. */
  around(render: Render): Render {
    return async (source, dark, document) => {
      if (document === undefined) {
        return render(source, dark, document);
      }
      const turn = ++this.turns;
      this.running.add(turn);
      try {
        const result = await render(source, dark, document);
        this.keep(document, source, turn, result.log ?? NOTHING, result.dependencies);
        return result;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof DrawingFailure) {
          this.keep(document, source, turn, error.log, error.dependencies, message);
        } else {
          this.keep(document, source, turn, NOTHING, [], message);
        }
        throw error;
      } finally {
        this.running.delete(turn);
        const oldest = Math.min(...this.running);
        this.changes = this.changes.filter((change) => change.after >= oldest);
        this.closed = this.closed.filter((close) => close.after >= oldest);
      }
    };
  }

  /** The last drawing of the diagram `source` for `document`. */
  get(document: string, source: string): DrawingRecord | undefined {
    return this.kept.get(`${document}\n${source}`);
  }

  /** The drawings kept that read `file`, a path as compared with file events, with `key`. */
  readers(file: string, key: (path: string) => string): DrawingRecord[] {
    return [...this.kept.values()].filter((record) =>
      record.log.requests.some((request) => request.file !== undefined && key(request.file) === file)
    );
  }

  /** Puts out of date each drawing that read or looked at a path of `changes`, path keys from the watcher. */
  changed(changes: ReadonlyMap<string, boolean>): void {
    if (this.running.size > 0) {
      this.changes.push({ after: this.turns, paths: changes });
    }
    this.outdate((record) => changeTo(record.dependencies, changes) !== 'none');
  }

  /** Puts every drawing out of date: what a drawing may read changed. */
  outdateAll(): void {
    this.outdate(() => true);
  }

  /** Forgets the drawings for `document`, closed, and does not keep those still being drawn. */
  forget(document: string): void {
    if (this.running.size > 0) {
      this.closed.push({ after: this.turns, document });
    }
    let found = false;
    for (const [key, record] of this.kept) {
      if (record.document === document) {
        this.kept.delete(key);
        found = true;
      }
    }
    if (found) {
      this.fire(document);
    }
  }

  /** Calls `listener` with a document whenever a drawing for it is kept, forgotten or put out of date. */
  onDidChange(listener: (document: string) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private keep(
    document: string,
    source: string,
    turn: number,
    log: DrawingLog,
    dependencies: readonly string[],
    error?: string
  ): void {
    const key = `${document}\n${source}`;
    const before = this.kept.get(key);
    if (
      (before !== undefined && before.turn > turn) ||
      this.closed.some((close) => close.after >= turn && close.document === document)
    ) {
      return;
    }
    const readBefore = new Map<string, string>();
    for (const request of log.requests) {
      if (request.state !== 'missing') {
        continue;
      }
      const asked = requestKey(request);
      const read =
        before?.log.requests.find((earlier) => earlier.state === 'read' && requestKey(earlier) === asked)?.file ??
        before?.readBefore.get(asked);
      if (read !== undefined) {
        readBefore.set(asked, read);
      }
    }
    const stale = this.changes.some((change) => change.after >= turn && changeTo(dependencies, change.paths) !== 'none');
    this.kept.delete(key);
    this.kept.set(key, {
      document,
      source,
      log,
      ...(error === undefined ? {} : { error }),
      stale,
      readBefore,
      turn,
      dependencies,
    });
    while (this.kept.size > this.most) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.kept.delete(oldest);
    }
    this.fire(document);
  }

  private outdate(affected: (record: Kept) => boolean): void {
    const documents = new Set<string>();
    for (const record of this.kept.values()) {
      if (!record.stale && affected(record)) {
        record.stale = true;
        documents.add(record.document);
      }
    }
    for (const document of documents) {
      this.fire(document);
    }
  }

  private fire(document: string): void {
    for (const listener of this.listeners) {
      listener(document);
    }
  }
}
