import { dirname, join, relative } from 'node:path';

import { isWithin, searchFolders } from './resolver';
import type { IncludeAccess } from './session';

/**
 * Whether the diagrams of a document get their local includes.
 *
 * Only a file on disk, in a workspace folder of a trusted workspace, does:
 * its includes are looked for in that folder and nowhere else. The folder
 * is taken by its real path — the one the user opened, wherever a link in
 * its own path leads — and the document's folder is placed under it.
 */

/** What is known of a document when its diagrams are drawn. */
export interface DocumentFacts {
  /** Whether the workspace is trusted. */
  trusted: boolean;
  /** Whether the document has never been saved. */
  untitled: boolean;
  /** The scheme of its URI. */
  scheme: string;
  /** Its path on disk, for the `file` scheme. */
  path: string;
  /** The path of the workspace folder it is in, if any. */
  folder: string | undefined;
  /** `plantumlLocal.includePaths` for it, as written. */
  includePaths: unknown;
}

export async function includeAccess(
  facts: DocumentFacts,
  realpath: (path: string) => Promise<string>
): Promise<IncludeAccess> {
  if (!facts.trusted) {
    return { available: false, why: 'untrusted' };
  }
  if (facts.untitled) {
    return { available: false, why: 'untitled' };
  }
  if (facts.scheme !== 'file') {
    return { available: false, why: 'not-on-disk' };
  }
  if (facts.folder === undefined || !isWithin(facts.folder, facts.path)) {
    return { available: false, why: 'outside-workspace' };
  }

  let root: string;
  try {
    root = await realpath(facts.folder);
  } catch {
    return { available: false, why: 'outside-workspace' };
  }
  const folders = searchFolders(root, facts.includePaths);
  if (!Array.isArray(folders)) {
    return { available: false, why: 'setting', problem: folders };
  }
  const documentFolder = join(root, relative(facts.folder, dirname(facts.path)));
  return { available: true, scope: { root, documentFolder, searchFolders: folders } };
}
