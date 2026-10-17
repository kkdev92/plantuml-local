import type { Stats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

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
 * it is the file's identity: two spellings of one file are one file.
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

const refused = (refusal: ReadRefusal): ReadOutcome => ({ kind: 'refused', refusal });

/** Reads `candidate`, a path under `root`, which is a real path. */
export async function readIncludeFile(root: string, candidate: string, options: ReadOptions): Promise<ReadOutcome> {
  let info: Stats | undefined;
  let current = root;
  for (const name of relative(root, candidate).split(sep)) {
    current = join(current, name);
    try {
      info = await lstat(current);
    } catch (error) {
      return isMissing(error) ? { kind: 'missing' } : refused('unreadable');
    }
    if (info.isSymbolicLink()) {
      return refused('link');
    }
  }
  if (info?.isFile() !== true) {
    return refused('not-a-file');
  }

  let id: string;
  try {
    id = await realpath(candidate);
  } catch (error) {
    return isMissing(error) ? { kind: 'missing' } : refused('unreadable');
  }
  if (!isWithin(root, id)) {
    return refused('outside');
  }

  let text = options.openText(id);
  if (text === undefined) {
    if (info.size > options.maxBytes) {
      return refused('too-large');
    }
    let bytes: Uint8Array;
    try {
      bytes = await readFile(id);
    } catch (error) {
      return isMissing(error) ? { kind: 'missing' } : refused('unreadable');
    }
    try {
      // fatal rejects invalid UTF-8; a leading BOM is dropped, not refused.
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return refused('encoding');
    }
  } else if (Buffer.byteLength(text, 'utf8') > options.maxBytes) {
    return refused('too-large');
  }
  if (text.includes('\u0000')) {
    return refused('nul');
  }
  return { kind: 'file', id, text };
}
