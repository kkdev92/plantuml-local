import type { Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { parseIncludePath, parseSearchFolder } from './path-policy';
import { locateIncludeFile, reach } from './reader';
import { includeCandidates, isWithin, type IncludeScope } from './resolver';

/**
 * The files the local includes of a document lead to, found as the render
 * finds them: the file an include reads, to go to it, and the names a path
 * being typed can go on with.
 *
 * Both look where an include written in the document itself is looked for:
 * next to the document, then, for a path not written as `./…` or `../…`,
 * in each search folder in order. The render takes the first candidate that
 * exists, and stops at one it may not read. So a name is offered from the
 * first place that has it, and only when the render would read it there.
 */

/** The file an include of `path`, written in the document, reads: its real path, or null when it reads none. */
export async function includeTarget(path: string, scope: IncludeScope): Promise<string | null> {
  const parsed = parseIncludePath(path);
  if (!parsed.ok) {
    return null;
  }
  for (const candidate of includeCandidates(parsed.path, null, scope)) {
    if (!isWithin(scope.root, candidate)) {
      return null;
    }
    const located = await locateIncludeFile(scope.root, candidate);
    if (located.kind !== 'missing') {
      return located.kind === 'file' ? located.id : null;
    }
  }
  return null;
}

/** A name a path being typed can go on with. */
export interface IncludeEntry {
  name: string;
  /** A folder to go on into, rather than a file to include. */
  folder: boolean;
  /** The search folder it is in, relative to the root with `/`; null next to the document. */
  searchFolder: string | null;
}

/** A name as the file system compares it. */
function nameKey(name: string): string {
  return process.platform === 'win32' || process.platform === 'darwin' ? name.toLowerCase() : name;
}

/**
 * The names that can follow `typed`, the part of a path up to its last `/`
 * or `\`, in an include written in the document: the files an include would
 * read and the folders it can go on into, each from the first place that
 * has it.
 */
export async function includeEntries(typed: string, scope: IncludeScope): Promise<IncludeEntry[]> {
  const parsed = parseSearchFolder(typed);
  if (!parsed.ok) {
    return [];
  }
  const places = parsed.path.anchored ? [scope.documentFolder] : [scope.documentFolder, ...scope.searchFolders];
  const entries: IncludeEntry[] = [];
  // Names an earlier place decided: the file a path ending in the name
  // reads, and whether a path can go on through it.
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const [index, place] of places.entries()) {
    const folder = join(place, ...parsed.path.segments);
    // The render stops at a path out of the root, or through a link.
    if (!isWithin(scope.root, folder)) {
      break;
    }
    const reached = await reach(scope.root, folder);
    if (reached.kind === 'refused') {
      break;
    }
    if (reached.kind === 'missing' || !reached.info.isDirectory()) {
      continue;
    }
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      break;
    }
    const searchFolder = index === 0 ? null : relative(scope.root, place).split(sep).join('/') || '.';
    for (const name of names) {
      let info: Stats;
      try {
        info = await lstat(join(folder, name));
      } catch {
        continue;
      }
      const key = nameKey(name);
      if (!files.has(key)) {
        files.add(key);
        if (info.isFile() && parseIncludePath(`${typed}${name}`).ok) {
          entries.push({ name, folder: false, searchFolder });
        }
      }
      // Under a file the next place is looked in; a link stops the render.
      if (!folders.has(key) && (info.isDirectory() || info.isSymbolicLink())) {
        folders.add(key);
        if (info.isDirectory() && parseSearchFolder(`${typed}${name}`).ok) {
          entries.push({ name, folder: true, searchFolder });
        }
      }
    }
  }
  return entries;
}
