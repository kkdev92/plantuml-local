import type { Stats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { InputOrigin } from '../core/types';
import { isWithin } from './resolver';

/**
 * Reads one candidate file of a local include, or says why it may not be
 * read.
 *
 * Every name from the workspace folder's root down to the file is checked
 * with `lstat`, and a symbolic link or a junction anywhere on the way is
 * refused: a link inside the folder can point anywhere. Checking only the
 * file would not do, because a file reached through a Windows junction is
 * not a link itself. The real path then has to lie under the root too, and
 * it is the file's identity: two spellings of one file are one file. Going
 * to the file an include names (targets.ts) finds it the same way, without
 * reading it.
 *
 * A document open in an editor is read from the editor, unsaved changes
 * and all, as the diagram that includes it is. A file on disk is read as
 * strict UTF-8 (a leading BOM is allowed); anything else, or a NUL, is not
 * taken for diagram text. The caller has already checked the path's text
 * (path-policy.ts) and that the candidate lies under the root.
 */

/** Why an existing candidate is not read. */
export type ReadRefusal =
  /** A symbolic link or a junction on the way to it. */
  | 'link'
  /** Its real path is outside the workspace folder. */
  | 'outside'
  /** A folder, a device, a pipe: not a regular file. */
  | 'not-a-file'
  /** Larger than the bytes left to read. */
  | 'too-large'
  /** Not valid UTF-8. */
  | 'encoding'
  /** Holds a NUL character. */
  | 'nul'
  /** The system would not let it be read. */
  | 'unreadable';

export type ReadOutcome =
  | { kind: 'file'; id: string; text: string }
  | { kind: 'missing' }
  | { kind: 'refused'; refusal: ReadRefusal };

export interface ReadOptions {
  /** The text of the document at `path` when it is open in an editor. */
  openText(path: string): string | undefined;
  /** Most bytes the file may have. */
  maxBytes: number;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

const refused = (refusal: ReadRefusal): Extract<ReadOutcome, { kind: 'refused' }> => ({ kind: 'refused', refusal });

/** What a path under the root is, or why it cannot be reached. */
export type Reached =
  | { kind: 'reached'; info: Stats }
  | { kind: 'missing' }
  | { kind: 'refused'; refusal: 'link' | 'unreadable' };

/**
 * Looks at every name from `root` down to `path` with `lstat`: what the
 * last one is, or that one on the way is missing, a link or not readable.
 */
export async function reach(root: string, path: string): Promise<Reached> {
  let reached: Reached = { kind: 'missing' };
  let current = root;
  for (const name of relative(root, path).split(sep)) {
    current = join(current, name);
    let info: Stats;
    try {
      info = await lstat(current);
    } catch (error) {
      return isMissing(error) ? { kind: 'missing' } : { kind: 'refused', refusal: 'unreadable' };
    }
    if (info.isSymbolicLink()) {
      return { kind: 'refused', refusal: 'link' };
    }
    reached = { kind: 'reached', info };
  }
  return reached;
}

/** A candidate found, or why it is not read, whatever it holds. */
export type Located =
  | { kind: 'file'; id: string; size: number }
  | { kind: 'missing' }
  | { kind: 'refused'; refusal: Extract<ReadRefusal, 'link' | 'outside' | 'not-a-file' | 'unreadable'> };

/** Finds `candidate`, a path under `root`, which is a real path, without reading it. */
export async function locateIncludeFile(root: string, candidate: string): Promise<Located> {
  const reached = await reach(root, candidate);
  if (reached.kind !== 'reached') {
    return reached;
  }
  if (!reached.info.isFile()) {
    return { kind: 'refused', refusal: 'not-a-file' };
  }
  let id: string;
  try {
    id = await realpath(candidate);
  } catch (error) {
    return isMissing(error) ? { kind: 'missing' } : { kind: 'refused', refusal: 'unreadable' };
  }
  if (!isWithin(root, id)) {
    return { kind: 'refused', refusal: 'outside' };
  }
  return { kind: 'file', id, size: reached.info.size };
}

/** Reads `candidate`, a path under `root`, which is a real path. */
export async function readIncludeFile(root: string, candidate: string, options: ReadOptions): Promise<ReadOutcome> {
  return (await readMeasured(root, candidate, options)).outcome;
}

/**
 * A read of a candidate, with what it went by: the bytes held against
 * `maxBytes` — the file's size on disk, or its text's in UTF-8 when an
 * editor has it open, absent when the file was not reached — and where the
 * text of a file read came from.
 */
export type MeasuredRead =
  | { outcome: Extract<ReadOutcome, { kind: 'file' }>; bytes: number; origin: InputOrigin }
  | { outcome: Exclude<ReadOutcome, { kind: 'file' }>; bytes?: number };

/** Whether `read` read a file. */
export function isFileRead(read: MeasuredRead): read is Extract<MeasuredRead, { origin: InputOrigin }> {
  return read.outcome.kind === 'file';
}

/**
 * Reads `candidate` as {@link readIncludeFile} does, and says what the read
 * went by, so that the same read can be held against fewer bytes later
 * (src/includes/snapshot.ts) and say what it was.
 */
export async function readMeasured(root: string, candidate: string, options: ReadOptions): Promise<MeasuredRead> {
  const located = await locateIncludeFile(root, candidate);
  if (located.kind !== 'file') {
    return { outcome: located };
  }
  const id = located.id;

  let text = options.openText(id);
  if (text === undefined) {
    const size = located.size;
    if (size > options.maxBytes) {
      return { outcome: refused('too-large'), bytes: size };
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFile(id);
    } catch (error) {
      return isMissing(error) ? { outcome: { kind: 'missing' } } : { outcome: refused('unreadable'), bytes: size };
    }
    try {
      // fatal rejects invalid UTF-8; a leading BOM is dropped, not refused.
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { outcome: refused('encoding'), bytes: size };
    }
    return withText(id, text, size, 'disk');
  }
  const size = Buffer.byteLength(text, 'utf8');
  if (size > options.maxBytes) {
    return { outcome: refused('too-large'), bytes: size };
  }
  return withText(id, text, size, 'editor');
}

/** The read of a file whose text is `text`: refused if it holds a NUL. */
function withText(id: string, text: string, bytes: number, origin: InputOrigin): MeasuredRead {
  return text.includes('\u0000') ? { outcome: refused('nul'), bytes } : { outcome: { kind: 'file', id, text }, bytes, origin };
}
