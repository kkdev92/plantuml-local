import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { bundledLibrary } from '../core/libraries';
import type { IncludeSession } from '../includes/session';
import type { Declaration } from './declarations';
import type { MacroSources } from './macros';

/**
 * Where the completion and the parameter hints read what an include names
 * (src/language/macros.ts): a local file through an include session, as a
 * render reads it (the same search, bounds and limits, and an open
 * document as it is edited), and what a file of a bundled library declares
 * from what scripts/generate-stdlib.mjs wrote of it (assets/declarations/,
 * dist/declarations/ in the package).
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

type Declared = Readonly<Record<string, readonly Declaration[]>>;

/** What a library's files declare, and the path upstream gives each, by key. */
interface Library {
  declarations: Declared;
  files: Readonly<Record<string, string>>;
}

/** What the files of the bundled libraries declare, each library read from `folder` when an include first names it. */
export class LibraryDeclarations {
  private readonly read = new Map<string, Promise<Library>>();
  /** The libraries read so far. */
  private readonly known = new Map<string, Library>();

  constructor(private readonly folder: string) {}

  /**
   * What file `key` of `library` declares: undefined when no library of
   * that name is bundled, null when it has no such file. Rejects when its
   * library's file cannot be read, which is read again when next asked for.
   */
  async declared(library: string, key: string): Promise<readonly Declaration[] | null | undefined> {
    const bundled = bundledLibrary(library);
    if (bundled === undefined) {
      return undefined;
    }
    let file = this.read.get(bundled.name);
    if (file === undefined) {
      file = readFile(join(this.folder, `${bundled.name}.json`), 'utf8').then((text) => {
        const { declarations, files } = JSON.parse(text) as { declarations?: unknown; files?: unknown };
        if (typeof declarations !== 'object' || declarations === null) {
          throw new Error(`${bundled.name}.json holds no declarations`);
        }
        const read = {
          declarations: declarations as Declared,
          files: typeof files === 'object' && files !== null ? (files as Library['files']) : {},
        };
        this.known.set(bundled.name, read);
        return read;
      });
      this.read.set(bundled.name, file);
      file.catch(() => {
        this.read.delete(bundled.name);
      });
    }
    const { declarations } = await file;
    // A key such as `constructor` names no file, whatever an object has.
    return Object.hasOwn(declarations, key) ? (declarations[key] ?? null) : null;
  }

  /**
   * The path upstream gives file `key` of `library`, in its own case and
   * without its extension (`Compute/AzureFunction`), once the library has
   * been read; undefined before, and for a file it does not have.
   */
  fileName(library: string, key: string): string | undefined {
    const files = this.known.get(library.toLowerCase())?.files;
    return files !== undefined && Object.hasOwn(files, key) ? files[key] : undefined;
  }
}

/**
 * The sources of one answer: local files through `session`, which keeps
 * why each it could not deliver failed, and the bundled libraries.
 */
export function macroSources(
  session: IncludeSession,
  libraries: LibraryDeclarations,
  cancelled: () => boolean
): MacroSources {
  return {
    file: async (path, from, kind): Promise<{ id: string; text: string } | null> => {
      try {
        return await session.load(path, from, kind);
      } catch {
        return null;
      }
    },
    library: (library, key): Promise<readonly Declaration[] | null | undefined> => libraries.declared(library, key),
    cancelled,
  };
}
