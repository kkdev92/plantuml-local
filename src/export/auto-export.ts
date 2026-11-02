/**
 * Whether the SVG file of a diagram is one to export again with no one
 * asked — when the diagram's files are saved — as looked at before that is
 * allowed (src/export/permits.ts): the file as it is, against the record of
 * the export and the drawing of the diagram.
 *
 * Only a file there already, recorded as the diagram's own export and
 * unchanged since, is. A file no record says is any diagram's, or one its
 * own record no longer matches, that holds just what the diagram draws can
 * be taken for its export once that is allowed: adopted. A file that is
 * not there is never made: the export by hand makes it.
 *
 * Like the exporter, this module has no dependency on the `vscode` module.
 */

import type { OutputRead } from './freshness';
import { sameKey, type ArtifactKey, type ArtifactRecord } from './history';
import { sha256 } from './ownership';

/**
 * Why the SVG file is not one to export again with no one asked: it is not
 * there; it is not a file, or is a link; it is larger than is read to look
 * at it, or cannot be read; it is open with unsaved changes; it is recorded
 * as another diagram's export; it changed since it was exported; or it is
 * recorded as no diagram's export, and does not hold what this one draws.
 */
export type OutputRefusal =
  | { why: 'missing' }
  | { why: 'not-file' }
  | { why: 'link' }
  | { why: 'too-large' }
  | { why: 'unreadable'; message: string }
  | { why: 'dirty' }
  | { why: 'owner'; owner: ArtifactRecord }
  | { why: 'edited' }
  | { why: 'unrecorded' };

/** The SVG file as looked at, when it is one to export again. */
export interface OutputLook {
  /** The SHA-256 of its bytes. */
  sha256: string;
  /** Its record, as it was. */
  owner: ArtifactRecord | null;
  /**
   * Whether it is to be adopted: not recorded as the diagram's export as
   * it is, but holding just what the diagram draws. It is not the
   * diagram's to export again until it is recorded as its export.
   */
  adopt: boolean;
}

/**
 * Looks at the SVG file of the diagram `key` names: `read` as it was read,
 * `dirty` whether it is open with unsaved changes, `owner` its record, and
 * `drawn` what the diagram draws now, for a file that may be adopted; null
 * when none may.
 */
export function lookAtOutput(
  key: ArtifactKey,
  read: OutputRead,
  dirty: boolean,
  owner: ArtifactRecord | null,
  drawn: Uint8Array | null
): OutputLook | OutputRefusal {
  // Open with unsaved changes, it is someone's work, whoever wrote it last.
  if (dirty) {
    return { why: 'dirty' };
  }
  switch (read.kind) {
    case 'none':
      return { why: 'missing' };
    case 'not-file':
      return { why: 'not-file' };
    case 'link':
      return { why: 'link' };
    case 'too-large':
      return { why: 'too-large' };
    case 'failed':
      return { why: 'unreadable', message: read.message };
    case 'bytes':
      break;
  }
  const digest = sha256(read.bytes);
  // Another diagram's export is that diagram's, whatever it holds.
  if (owner !== null && !sameKey(owner.key, key)) {
    return { why: 'owner', owner };
  }
  if (owner !== null && owner.sha256 === digest) {
    return { sha256: digest, owner, adopt: false };
  }
  if (drawn !== null && sha256(drawn) === digest) {
    return { sha256: digest, owner, adopt: true };
  }
  return owner === null ? { why: 'unrecorded' } : { why: 'edited' };
}

/** Whether two looks at a file found it the same: the same bytes, the same record, the same to do. */
export function sameLook(a: OutputLook, b: OutputLook): boolean {
  const sameOwner =
    a.owner === null || b.owner === null
      ? a.owner === b.owner
      : a.owner.output === b.owner.output && a.owner.sha256 === b.owner.sha256 && sameKey(a.owner.key, b.owner.key);
  return a.sha256 === b.sha256 && a.adopt === b.adopt && sameOwner;
}
