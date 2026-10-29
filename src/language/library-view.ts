import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { bundledLibrary, libraryFileName } from '../core/libraries';

/**
 * A bundled library's file, opened read-only where Go to Definition leads
 * into it: the text the extension bundles of it (assets/stdlib/,
 * dist/stdlib/ in the package), as the worker gives it to the engine and
 * as what it declares is counted in lines (assets/declarations/), under a
 * URI of the extension's own scheme whose path names the file as an
 * include does, `plantuml-local-library:/C4/C4_Context.puml`. The file is
 * read each time it is opened, and not kept.
 *
 * Like the folding, this has no dependency on the `vscode` module.
 */

export const LIBRARY_SCHEME = 'plantuml-local-library';

/**
 * The path of the URI of file `key` of `library`: `/C4/C4_Context.puml`.
 * `name` is the file's path as upstream writes it, when known; else the
 * files the library lists, or the key, name it.
 */
export function libraryPath(library: string, key: string, name?: string): string {
  const { label, file } = libraryFileName(library, key, name);
  return `/${label}/${file}.puml`;
}

/** The library and the key of the file a path of such a URI names, as the engine looks them up; null when it names none. */
export function libraryOfPath(path: string): { library: string; key: string } | null {
  const inner = path.startsWith('/') ? path.slice(1) : path;
  const slash = inner.indexOf('/');
  const bundled = slash === -1 ? undefined : bundledLibrary(inner.slice(0, slash));
  if (bundled === undefined || !inner.toLowerCase().endsWith('.puml')) {
    return null;
  }
  const key = inner.slice(slash + 1, -'.puml'.length).toLowerCase();
  return key === '' ? null : { library: bundled.name, key };
}

/** The text bundled of file `key` of `library`, read from `folder`; null when no bundled library has that file. */
export async function libraryText(folder: string, library: string, key: string): Promise<string | null> {
  const bundled = bundledLibrary(library);
  if (bundled === undefined) {
    return null;
  }
  const { entries } = JSON.parse(await readFile(join(folder, `${bundled.name}.json`), 'utf8')) as {
    entries?: Record<string, unknown>;
  };
  // A key such as `constructor` names no file, whatever an object has.
  const text = entries !== undefined && Object.hasOwn(entries, key) ? entries[key] : undefined;
  return typeof text === 'string' ? text : null;
}
