/**
 * Puts a file written beside its target in the target's place.
 *
 * An export writes each image under a temporary name beside the file it goes
 * to and then renames it over that file, so that a write that stops part way
 * leaves the old image rather than half a new one. VS Code's rename,
 * `workspace.fs.rename` with `overwrite`, deletes the old file before it
 * renames, and VS Code closes the editors showing a file it deletes: an image
 * open in VS Code, as an image or as text, was closed each time it was
 * exported again. The file system's own rename replaces the old file in one
 * step, and those editors stay open and show the new image; a file on disk is
 * replaced with that.
 *
 * On Windows, a file that another program has open — a virus scanner looking
 * at the new file, say — cannot be renamed over for a while, so the rename is
 * tried again for up to {@link RETRY_FOR} milliseconds, waiting a little
 * longer each time, as VS Code's own rename does. Whatever still stops it
 * leaves the file to VS Code's rename, as before, unless a folder has taken
 * the old file's place: VS Code's rename would delete the folder and all it
 * holds.
 *
 * Like the exporter, this module has no dependency on the `vscode` module.
 */

/** How long a rename stopped by a file in use is tried again for, in milliseconds. */
export const RETRY_FOR = 1000;

/** The longest wait between two tries, in milliseconds. */
const LONGEST_WAIT = 100;

/**
 * The codes a rename fails with on Windows while a file is in use, which
 * VS Code's own rename tries again on. A read-only file and a folder in the
 * way give them too.
 */
const IN_USE = new Set(['EACCES', 'EBUSY', 'EPERM']);

/** The ways a new file can be put in the place of the old one. */
export interface ReplaceDeps {
  /** Renames the new file over the old one with the file system's own rename. */
  rename(): Promise<void>;
  /** Whether this is Windows, where a file in use stops a rename for a while. */
  windows: boolean;
  /** Resolves once `ms` milliseconds have passed. */
  wait(ms: number): Promise<void>;
  /** The time now, in milliseconds. */
  now(): number;
  /**
   * Rejects with a reason fit to show when a folder is where the old file
   * was, and resolves otherwise.
   */
  refuseFolder(): Promise<void>;
  /** Renames the new file over the old one with VS Code's rename, which deletes the old one first. */
  fallback(): Promise<void>;
}

/**
 * Renames a new file over the old one with the file system's own rename and,
 * when that cannot be done, with VS Code's, unless a folder is in the way.
 */
export async function replaceFile(deps: ReplaceDeps): Promise<void> {
  try {
    await renameRetrying(deps);
    return;
  } catch {
    // Left to VS Code's rename, as before.
  }
  await deps.refuseFolder();
  await deps.fallback();
}

/** The file system's own rename, tried again while a file in use stops it on Windows. */
async function renameRetrying(deps: ReplaceDeps): Promise<void> {
  const start = deps.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      await deps.rename();
      return;
    } catch (error: unknown) {
      if (!deps.windows || !IN_USE.has(codeOf(error)) || deps.now() - start >= RETRY_FOR) {
        throw error;
      }
    }
    await deps.wait(Math.min(LONGEST_WAIT, attempt * 10));
  }
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}
