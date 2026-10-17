import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import { parseSearchFolder, type PathRefusal, type RelativePath } from './path-policy';

/**
 * Where a local include is looked for.
 *
 * `./x` and `../x` are looked for next to the file the include is written
 * in, and nowhere else. A bare `x` or `dir/x` is looked for there first,
 * then in each search folder in order. An include written in the diagram
 * itself is looked for next to the document the diagram is in — for a
 * Markdown block, the Markdown file.
 *
 * Every place is under the root of that document's workspace folder.
 * The caller refuses a candidate that leaves the root (through `..`)
 * instead of skipping it, so that a file of the same name elsewhere is
 * never read in its place, and stops at the first candidate that exists.
 */

/** Most search folders `plantumlLocal.includePaths` may list. */
export const MAX_SEARCH_FOLDERS = 16;

export interface IncludeScope {
  /** Real path of the workspace folder the diagram's document is in. */
  root: string;
  /** The folder of that document, under `root`. */
  documentFolder: string;
  /** Folders a bare name is also looked for in, under `root`. */
  searchFolders: readonly string[];
}

/** True when `path` is `root` or inside it; without regard to case on Windows. */
export function isWithin(root: string, path: string): boolean {
  const between = relative(root, path);
  return !isAbsolute(between) && between !== '..' && !between.startsWith(`..${sep}`);
}

/**
 * The paths to look for `path` at, in order. `from` is the file the include
 * is written in, as a path the caller gave the engine, or null for the
 * diagram itself.
 */
export function includeCandidates(path: RelativePath, from: string | null, scope: IncludeScope): string[] {
  const base = from === null ? scope.documentFolder : dirname(from);
  const folders = path.anchored ? [base] : [base, ...scope.searchFolders];
  return folders.map((folder) => join(folder, ...path.segments));
}

/** Why `plantumlLocal.includePaths` cannot be used. */
export type SearchFoldersProblem =
  | { problem: 'not-a-list' }
  | { problem: 'too-many'; count: number }
  | { problem: 'refused'; folder: string; refusal: PathRefusal | 'outside' };

/**
 * The search folders `entries` name under `root`, or why the setting cannot
 * be used. One bad entry spoils the whole setting: searching only the good
 * ones would read a different file than the one the list was written for.
 */
export function searchFolders(root: string, entries: unknown): string[] | SearchFoldersProblem {
  if (!Array.isArray(entries) || !entries.every((entry): entry is string => typeof entry === 'string')) {
    return { problem: 'not-a-list' };
  }
  if (entries.length > MAX_SEARCH_FOLDERS) {
    return { problem: 'too-many', count: entries.length };
  }
  const folders: string[] = [];
  for (const entry of entries) {
    const parsed = parseSearchFolder(entry);
    if (!parsed.ok) {
      return { problem: 'refused', folder: entry, refusal: parsed.refusal };
    }
    const folder = join(root, ...parsed.path.segments);
    if (!isWithin(root, folder)) {
      return { problem: 'refused', folder: entry, refusal: 'outside' };
    }
    folders.push(folder);
  }
  return folders;
}
