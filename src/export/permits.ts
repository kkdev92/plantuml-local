/**
 * The diagrams whose SVG file may be exported again when their files are
 * saved, each as allowed by hand: a permission per diagram, and what it was
 * given under — the file it writes, the workspace folder, where the
 * diagram's local includes are looked for, the include setting as written,
 * the renderer and the palette. Once any of those is otherwise, the
 * permission no longer holds, and is asked for again.
 *
 * The permissions live in the workspace's state, which VS Code keeps on the
 * computer its window runs on — in a remote window too, not on the remote
 * machine — and which is not synced: not in the repository, nor in any
 * setting. A setting alone never grants one.
 *
 * Like the exporter, this module has no dependency on the `vscode` module:
 * the state arrives through {@link PermitBackend}.
 */

import type { IncludeContext } from '../core/types';
import { isArtifactKey, type ArtifactKey } from './history';
import { canonicalJson, isIncludeContext, type Palette } from './manifest';

/** The renderer a permission was given for: the engine, the files that ship it, and what the extension does to its drawings. */
export interface PermitRenderer {
  readonly engine: string;
  /** The SHA-256 of the worker, the engine and the bundled libraries, as shipped (src/export/manifest.ts). */
  readonly build: string;
  /** The version of what the extension does to a drawing after the engine. */
  readonly contract: number;
}

/** What a permission is given under, and is held to: each as it is when the diagram is exported again. */
export interface PermitTerms {
  /** The URI of the SVG file. */
  readonly output: string;
  /** The URI of the workspace folder the document is in. */
  readonly root: string;
  /** Where the diagram's local includes are looked for. */
  readonly context: IncludeContext;
  /** The include setting for the document, as written, as canonical JSON. */
  readonly includePaths: string;
  readonly renderer: PermitRenderer;
  /** The palette the SVG is drawn in: an export's, which does not follow the editor's theme. */
  readonly palette: Palette;
}

/** A diagram's permission to have its SVG exported again when its files are saved. */
export interface AutoExportPermit extends PermitTerms {
  /** The diagram: an SVG, of a diagram with a name of its own. */
  readonly key: ArtifactKey;
  /**
   * Made afresh for each permission given, so that one given again is not
   * taken for the one before: what was set going under the one before stops.
   */
  readonly generation: string;
}

/** The version of the shape the permissions are stored in. */
export const PERMIT_VERSION = 1;

/** The most diagrams given a permission in a workspace. */
export const PERMIT_LIMIT = 128;

/** The terms of a permission that can be otherwise now, by name. */
export type PermitTerm = 'output' | 'root' | 'context' | 'includePaths' | 'renderer' | 'palette';

/** The permissions as read. */
export interface Permits {
  /** Whether they can be written: not when a later version stored them, which are read as none and left as they are. */
  readonly writable: boolean;
  /** By the diagram ({@link keyId}). */
  readonly permits: ReadonlyMap<string, AutoExportPermit>;
}

/** What became of a permission to keep: kept; or not, there being no room, the permissions being of a later version, or the state not taking them. */
export type PermitResult = 'saved' | 'full' | 'later-version' | 'not-saved';

const SHA256 = /^[0-9a-f]{64}$/;
const GENERATION = /^[0-9a-f]{32}$/;

/** The diagram `key` names, as one string: its fields in a fixed order. */
export function keyId(key: ArtifactKey): string {
  return canonicalJson({ ...key });
}

/** Whether `value` is an object with exactly the fields `fields`. */
function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** Whether `value` is a permission as this version writes one: every field of the shape, and nothing else. */
function isPermit(value: unknown): value is AutoExportPermit {
  if (!hasFields(value, ['key', 'output', 'root', 'context', 'includePaths', 'renderer', 'palette', 'generation'])) {
    return false;
  }
  const { key, output, root, context, includePaths, renderer, palette, generation } = value;
  return (
    isArtifactKey(key) &&
    key.format === 'svg' &&
    isString(output) &&
    isString(root) &&
    isIncludeContext(context) &&
    isString(includePaths) &&
    hasFields(renderer, ['engine', 'build', 'contract']) &&
    isString(renderer['engine']) &&
    isString(renderer['build']) &&
    SHA256.test(renderer['build']) &&
    typeof renderer['contract'] === 'number' &&
    Number.isInteger(renderer['contract']) &&
    renderer['contract'] >= 0 &&
    (palette === 'light' || palette === 'dark') &&
    isString(generation) &&
    GENERATION.test(generation)
  );
}

/**
 * Reads the permissions as stored. Only a permission whose every field is
 * as this version writes it counts, and two for the same diagram count for
 * neither: which one was given last cannot be told. They are kept in a Map,
 * so that a diagram named `__proto__` is a diagram like any other.
 */
export function readPermits(stored: unknown): Permits {
  const none = { writable: true, permits: new Map<string, AutoExportPermit>() };
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return none;
  }
  const fields = stored as Record<string, unknown>;
  if (typeof fields['schemaVersion'] !== 'number') {
    return none;
  }
  if (fields['schemaVersion'] !== PERMIT_VERSION) {
    return { ...none, writable: false };
  }
  const rows = Array.isArray(fields['permits']) ? (fields['permits'] as unknown[]) : [];
  const permits = new Map<string, AutoExportPermit>();
  const doubled = new Set<string>();
  for (const row of rows) {
    if (!isPermit(row)) {
      continue;
    }
    const id = keyId(row.key);
    if (permits.has(id)) {
      doubled.add(id);
    }
    permits.set(id, row);
  }
  for (const id of doubled) {
    permits.delete(id);
  }
  return { writable: true, permits };
}

/**
 * The permissions with `permit` in place of any for the same diagram, or
 * 'full' when it would be one past {@link PERMIT_LIMIT}: room is never made
 * by dropping another diagram's.
 */
export function withPermit(permits: Permits, permit: AutoExportPermit): Permits | 'full' {
  const id = keyId(permit.key);
  if (!permits.permits.has(id) && permits.permits.size >= PERMIT_LIMIT) {
    return 'full';
  }
  const next = new Map(permits.permits);
  next.set(id, permit);
  return { writable: true, permits: next };
}

/** The permissions without the one for `key`; with `generation`, only if it is that one. The same object when there is none to take out. */
export function withoutPermit(permits: Permits, key: ArtifactKey, generation?: string): Permits {
  const id = keyId(key);
  const permit = permits.permits.get(id);
  if (permit === undefined || (generation !== undefined && permit.generation !== generation)) {
    return permits;
  }
  const next = new Map(permits.permits);
  next.delete(id);
  return { writable: true, permits: next };
}

/** The permissions in the shape they are stored in. */
export function storedPermits(permits: Permits): { schemaVersion: number; permits: AutoExportPermit[] } {
  return { schemaVersion: PERMIT_VERSION, permits: [...permits.permits.values()] };
}

/**
 * The terms of `permit` that are otherwise in `now`, in a fixed order;
 * none when it still holds. Where the includes are looked for and the
 * include setting are compared as canonical JSON, the rest as they are.
 */
export function changedTerms(permit: PermitTerms, now: PermitTerms): PermitTerm[] {
  const changed: PermitTerm[] = [];
  if (permit.output !== now.output) {
    changed.push('output');
  }
  if (permit.root !== now.root) {
    changed.push('root');
  }
  if (canonicalJson(permit.context) !== canonicalJson(now.context)) {
    changed.push('context');
  }
  if (permit.includePaths !== now.includePaths) {
    changed.push('includePaths');
  }
  if (
    permit.renderer.engine !== now.renderer.engine ||
    permit.renderer.build !== now.renderer.build ||
    permit.renderer.contract !== now.renderer.contract
  ) {
    changed.push('renderer');
  }
  if (permit.palette !== now.palette) {
    changed.push('palette');
  }
  return changed;
}

/**
 * How a diagram stands for a permission given under `terms`: it has none;
 * it has one given under the same terms; or it has one the terms of which
 * are otherwise now, by name, which a new one would take the place of.
 */
export type PermitStanding =
  | { standing: 'none' }
  | { standing: 'same'; permit: AutoExportPermit }
  | { standing: 'changed'; permit: AutoExportPermit; changed: PermitTerm[] };

/** How the diagram of `permit`, its permission if it has one, stands for a permission given under `terms`. */
export function standingOf(permit: AutoExportPermit | null, terms: PermitTerms): PermitStanding {
  if (permit === null) {
    return { standing: 'none' };
  }
  const changed = changedTerms(permit, terms);
  return changed.length === 0 ? { standing: 'same', permit } : { standing: 'changed', permit, changed };
}

/** Where the permissions are kept: the workspace's state. */
export interface PermitBackend {
  get(): unknown;
  set(value: unknown): Promise<void>;
}

/**
 * The permissions of this workspace: read through, each change written one
 * at a time and read afresh, so that two at once do not drop each other's.
 */
export class PermitStore {
  private updates: Promise<unknown> = Promise.resolve();
  private read: { stored: unknown; permits: Permits } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly backend: PermitBackend) {}

  /** Calls `listener` each time a change to the permissions is kept, until the result is disposed. */
  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return {
      dispose: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  /** The permissions as they are now, read again only once they change. */
  private permits(): Permits {
    const stored = this.backend.get();
    if (this.read === null || this.read.stored !== stored) {
      this.read = { stored, permits: readPermits(stored) };
    }
    return this.read.permits;
  }

  /** Whether the permissions can be changed: not when a later version stored them. */
  writable(): boolean {
    return this.permits().writable;
  }

  /** Every permission, in the order given. */
  all(): AutoExportPermit[] {
    return [...this.permits().permits.values()];
  }

  /** The permission for the diagram `key` names, or null when there is none. */
  of(key: ArtifactKey): AutoExportPermit | null {
    return this.permits().permits.get(keyId(key)) ?? null;
  }

  /**
   * Keeps `permit`, in place of any for the same diagram. Never rejects:
   * `onError` hears why the state did not take it.
   */
  add(permit: AutoExportPermit, onError?: (error: unknown) => void): Promise<PermitResult> {
    return this.update(async () => {
      const permits = this.permits();
      if (!permits.writable) {
        return 'later-version';
      }
      const next = withPermit(permits, permit);
      if (next === 'full') {
        return 'full';
      }
      await this.save(next);
      return 'saved';
    }, onError);
  }

  /**
   * Takes out the permission for the diagram `key` names; with
   * `generation`, only if it is still that one. 'saved' once it is out,
   * or was not there. Never rejects: `onError` hears why the state did not
   * take it.
   */
  remove(key: ArtifactKey, generation?: string, onError?: (error: unknown) => void): Promise<PermitResult> {
    return this.update(async () => {
      const permits = this.permits();
      if (!permits.writable) {
        return 'later-version';
      }
      const next = withoutPermit(permits, key, generation);
      if (next !== permits) {
        await this.save(next);
      }
      return 'saved';
    }, onError);
  }

  private async save(permits: Permits): Promise<void> {
    await this.backend.set(storedPermits(permits));
    // The state keeps a copy of what it is given, and gives that copy back
    // until the next update: known, so not read again.
    this.read = { stored: this.backend.get(), permits };
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // What a listener does with the news is its own affair: the change is kept.
      }
    }
  }

  private update(change: () => Promise<PermitResult>, onError?: (error: unknown) => void): Promise<PermitResult> {
    const run = async (): Promise<PermitResult> => {
      try {
        return await change();
      } catch (error: unknown) {
        onError?.(error);
        return 'not-saved';
      }
    };
    const result = this.updates.then(run, run);
    this.updates = result;
    return result;
  }
}
