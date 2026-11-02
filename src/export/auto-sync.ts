/**
 * When the SVG files allowed to be exported on save (src/export/permits.ts)
 * are exported again, and what is told of it.
 *
 * Saves come in bursts — Save All, Auto Save while typing, a formatter that
 * saves — and each export draws the diagram, which the previews then wait
 * behind. So a diagram is exported a while after its files were last saved,
 * not on each save; one being exported when they are saved again is
 * exported once more afterwards, from what was saved last, never more than
 * once running and once waiting; and one diagram is exported at a time, the
 * rest waiting in the order their turn came. Nothing is tried again on its
 * own: only a save starts an export.
 *
 * What came of the exports is told once none is running, waiting or due,
 * all at once rather than a notice per diagram, and what stopped a diagram
 * is told once, not on every save, until it is exported again or stops for
 * another reason.
 *
 * Like the exporter, this module has no dependency on the `vscode` module.
 */

import type { InputManifest } from './manifest';

/** Why a diagram's SVG was not exported again, to tell. */
export interface SyncStop {
  /**
   * `blocked`: what the diagram is drawn from, or its file, is not as an
   * export needs it; `conflict`: the file holds what someone else put
   * there; `disabled`: the permission ended, and is to be asked for again.
   */
  readonly state: 'blocked' | 'conflict' | 'disabled';
  /** Why, in a word that does not change with the language: a diagram stopped again for the same is not told again. */
  readonly reason: string;
  /** The diagram, by its name. */
  readonly name: string;
  /** Why, in words. */
  readonly message: string;
  /**
   * What the notice offers when it tells of this diagram alone: exporting
   * it by hand (`at` is where), which asks before overwriting a file; the
   * Problems panel, or the Output panel when its problems are not listed;
   * or the Output panel.
   */
  readonly offer?: { readonly export: { readonly uri: string; readonly line: number } } | { readonly problems: boolean };
}

/**
 * What came of exporting a diagram's SVG again: exported (`written`, or
 * left as it was, as it held the drawing already); not tried, automatic
 * export being off, the workspace not trusted, the permission gone or
 * given again since; not written, as a file it was drawn from changed
 * meanwhile or is open with unsaved changes, which the next save takes care
 * of, and nothing is told; or stopped, which is told.
 */
export type SyncOutcome = { readonly state: 'current'; readonly written: boolean } | { readonly state: 'skipped' } | { readonly state: 'stale' } | SyncStop;

/**
 * The order the SVG files are exported again in: `run` exports one, by its
 * permission's id, `delay` milliseconds after it was last asked for, and
 * `report` hears what came of them once none is running, waiting or due.
 */
export class SaveSync {
  private readonly due = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly waiting: string[] = [];
  private running: string | null = null;
  /** Whether the one running was asked for again while it ran. */
  private again = false;
  private outcomes = new Map<string, SyncOutcome>();
  private disposed = false;

  constructor(
    private readonly delay: number,
    private readonly run: (id: string) => Promise<SyncOutcome>,
    private readonly report: (outcomes: ReadonlyMap<string, SyncOutcome>) => void,
    /** What a run that failed outright came to. */
    private readonly failed: (id: string, error: unknown) => SyncOutcome
  ) {}

  /** Exports `id` once `delay` has passed with it not asked for again. */
  schedule(id: string): void {
    if (this.disposed) {
      return;
    }
    clearTimeout(this.due.get(id));
    this.due.set(
      id,
      setTimeout(() => {
        this.due.delete(id);
        this.enqueue(id);
      }, this.delay)
    );
  }

  /**
   * Stops exporting `id`: what was due or waiting goes. One running goes
   * on to its end, where its run finds out it is not to write.
   */
  cancel(id: string): void {
    clearTimeout(this.due.get(id));
    this.due.delete(id);
    const at = this.waiting.indexOf(id);
    if (at !== -1) {
      this.waiting.splice(at, 1);
    }
    if (this.running === id) {
      this.again = false;
    }
    this.settle();
  }

  /** Stops exporting, as {@link cancel} does, each due, waiting or running that `keep` does not keep. */
  retain(keep: (id: string) => boolean): void {
    const all = new Set([...this.due.keys(), ...this.waiting, ...(this.running === null ? [] : [this.running])]);
    for (const id of all) {
      if (!keep(id)) {
        this.cancel(id);
      }
    }
  }

  /**
   * Takes `outcome` for `id`, come of something other than a run, to tell
   * with the rest. A permission noted as ended is told as ended, whatever a
   * run of it under way comes to.
   */
  note(id: string, outcome: SyncOutcome): void {
    if (this.disposed) {
      return;
    }
    this.outcomes.set(id, outcome);
    this.settle();
  }

  /** Stops everything: nothing is due, waiting or told any more. */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.due.values()) {
      clearTimeout(timer);
    }
    this.due.clear();
    this.waiting.length = 0;
    this.again = false;
    this.outcomes.clear();
  }

  private enqueue(id: string): void {
    if (this.running === id) {
      this.again = true;
      return;
    }
    if (!this.waiting.includes(id)) {
      this.waiting.push(id);
    }
    this.next();
  }

  private next(): void {
    if (this.disposed || this.running !== null) {
      return;
    }
    const id = this.waiting.shift();
    if (id === undefined) {
      this.settle();
      return;
    }
    this.running = id;
    this.again = false;
    const done = (outcome: SyncOutcome): void => {
      if (this.disposed) {
        return;
      }
      // A permission noted as ended meanwhile stays so, whatever the run came to.
      if (this.outcomes.get(id)?.state !== 'disabled') {
        this.outcomes.set(id, outcome);
      }
      this.running = null;
      if (this.again) {
        this.again = false;
        this.waiting.push(id);
      }
      this.next();
    };
    this.run(id).then(done, (error: unknown) => {
      done(this.failed(id, error));
    });
  }

  /** Tells what came of the exports once none is running, waiting or due. */
  private settle(): void {
    if (this.disposed || this.running !== null || this.waiting.length > 0 || this.due.size > 0 || this.outcomes.size === 0) {
      return;
    }
    const outcomes = this.outcomes;
    this.outcomes = new Map();
    this.report(outcomes);
  }
}

/**
 * The stops among `outcomes` to tell, each diagram's once: one told already
 * for the same reason is not told again until the diagram is exported
 * again, or stops for another reason. `told` keeps what was told, by
 * permission, and is updated; a permission that ended is forgotten once
 * told, as it does not come back.
 */
export function stopsToTell(outcomes: ReadonlyMap<string, SyncOutcome>, told: Map<string, string>): SyncStop[] {
  const tell: SyncStop[] = [];
  for (const [id, outcome] of outcomes) {
    if (outcome.state === 'current') {
      told.delete(id);
      continue;
    }
    if (!('reason' in outcome)) {
      continue;
    }
    const said = `${outcome.state}\n${outcome.reason}`;
    if (told.get(id) === said) {
      continue;
    }
    if (outcome.state === 'disabled') {
      told.delete(id);
    } else {
      told.set(id, said);
    }
    tell.push(outcome);
  }
  return tell;
}

/**
 * The files whose saving exports a diagram's SVG again, besides the
 * document it is in, each as `key` gives its path: every place its last
 * export (`input`, what its record says it was drawn from) looked at for a
 * file it includes, whether a file was read there or not; and every place
 * an export tried since looked at (`tried`), so that saving a file it did
 * not find, or a file it needs now, exports it.
 */
export function watchedFiles(input: InputManifest | undefined, tried: Iterable<string>, key: (path: string) => string): Set<string> {
  const files = new Set<string>();
  for (const request of input?.resources.requests ?? []) {
    for (const path of [...request.looked, ...(request.file === null ? [] : [request.file])]) {
      files.add(key(path));
    }
  }
  for (const path of tried) {
    files.add(key(path));
  }
  return files;
}
