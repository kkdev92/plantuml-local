/**
 * What the export commands wrote, so that exporting a diagram again can
 * replace its own file without asking, while a file put there by hand,
 * exported from another document or changed since is still asked about.
 *
 * Each file is recorded by its URI, with the document it was exported
 * from and a SHA-256 of the bytes written: no diagram source and no
 * image. The records live in the workspace's state, which stays on this
 * machine; elsewhere, or once they are gone, the export asks as it would
 * about any other file.
 */

import { createHash } from 'node:crypto';

/** What was last written to an exported file, and from which document. */
export interface ExportRecord {
  readonly document: string;
  readonly sha256: string;
}

/** The records, by the URI of the exported file. */
export type ExportRecords = Readonly<Record<string, ExportRecord>>;

/** The SHA-256 of `bytes`, in hex. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Whether `existing`, the file at `path`, is what was last written there
 * from `document`, unchanged since.
 */
export function isLastExport(
  records: ExportRecords,
  path: string,
  document: string,
  existing: Uint8Array
): boolean {
  const record = Object.hasOwn(records, path) ? records[path] : undefined;
  return record !== undefined && record.document === document && record.sha256 === sha256(existing);
}

/**
 * The records with `content` written to `path` from `document`: the same
 * object when they say so already.
 */
export function withExport(
  records: ExportRecords,
  path: string,
  document: string,
  content: Uint8Array
): ExportRecords {
  const hash = sha256(content);
  const record = Object.hasOwn(records, path) ? records[path] : undefined;
  if (record?.document === document && record.sha256 === hash) {
    return records;
  }
  return { ...records, [path]: { document, sha256: hash } };
}
