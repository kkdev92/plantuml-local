import { dirname } from 'node:path';

/**
 * Which folders to watch for the files that diagrams with local includes
 * read, so that such a diagram can be drawn again when one of them changes.
 *
 * Each render with a local include leaves the paths it looked at: the files
 * it read, and the places it looked first and found nothing, where a file
 * created later would be read instead. Their folders are watched one level
 * deep for as long as some render remembered here depends on them. The last
 * {@link MAX_REMEMBERED} renders are remembered, a newer render of the same
 * diagram in the same document replacing the older one.
 */

/** How many renders keep their folders watched. */
export const MAX_REMEMBERED = 256;

/**
 * A path as it is compared with the paths of file events. Windows and macOS
 * compare paths without regard to case, and so does VS Code when it matches
 * their events, so their paths are compared in lower case. On a volume that
 * does tell case apart, that can only draw a diagram once too often.
 */
export function pathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' || platform === 'darwin' ? path.toLowerCase() : path;
}

/** Folders to start and to stop watching. */
export interface FolderChanges {
  added: string[];
  removed: string[];
}

export class DependencyFolders {
  /** Render → the folders it depends on; insertion order is the order to forget them in. */
  private readonly renders = new Map<string, ReadonlySet<string>>();
  /** Folder → how many remembered renders depend on it. */
  private readonly counts = new Map<string, number>();

  constructor(private readonly most: number = MAX_REMEMBERED) {}

  /** The folders watched now. */
  get folders(): ReadonlySet<string> {
    return new Set(this.counts.keys());
  }

  /** Whether a remembered render depends on a file in `folder`. */
  has(folder: string): boolean {
    return this.counts.has(folder);
  }

  /**
   * Remembers that the render `key` depends on `paths` (path keys), in place
   * of what it depended on before; a render with none is forgotten.
   */
  remember(key: string, paths: Iterable<string>): FolderChanges {
    const before = new Set(this.counts.keys());
    this.drop(key);
    const folders = new Set([...paths].map((path) => dirname(path)));
    if (folders.size > 0) {
      this.renders.set(key, folders);
      for (const folder of folders) {
        this.counts.set(folder, (this.counts.get(folder) ?? 0) + 1);
      }
    }
    while (this.renders.size > this.most) {
      const oldest = this.renders.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.drop(oldest);
    }
    const after = new Set(this.counts.keys());
    return {
      added: [...after].filter((folder) => !before.has(folder)),
      removed: [...before].filter((folder) => !after.has(folder)),
    };
  }

  /** Forgets every render, returning the folders no longer watched. */
  clear(): string[] {
    const removed = [...this.counts.keys()];
    this.renders.clear();
    this.counts.clear();
    return removed;
  }

  private drop(key: string): void {
    const folders = this.renders.get(key);
    if (folders === undefined) {
      return;
    }
    this.renders.delete(key);
    for (const folder of folders) {
      const count = (this.counts.get(folder) ?? 1) - 1;
      if (count > 0) {
        this.counts.set(folder, count);
      } else {
        this.counts.delete(folder);
      }
    }
  }
}

/** Whether `changes` (path key → saved) touch `paths`: 'saved' if one of them was saved or changed on disk. */
export function changeTo(
  paths: Iterable<string>,
  changes: ReadonlyMap<string, boolean>
): 'none' | 'edited' | 'saved' {
  let found: 'none' | 'edited' | 'saved' = 'none';
  for (const path of paths) {
    const saved = changes.get(path);
    if (saved === true) {
      return 'saved';
    }
    if (saved === false) {
      found = 'edited';
    }
  }
  return found;
}
