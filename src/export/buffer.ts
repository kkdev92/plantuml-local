/**
 * What an export has drawn and not yet written.
 *
 * A bulk export draws every diagram before it writes any, so that it can
 * ask once about the files it would replace, and write nothing when that is
 * declined. Holding every drawing in memory meanwhile would not do for a
 * folder of large PNGs, so the drawings are held in memory up to
 * {@link OUTPUT_BUFFER_LIMIT} bytes in all, and past that in temporary
 * files, each in the folder its drawing is written to: a folder the export
 * writes to anyway, under the document's folder. A drawing held in a file
 * is read back when its turn comes, and is written only if it is still what
 * was put there.
 *
 * Those files are the export's own, and none of them is an exported file:
 * each is deleted once its drawing is written or let go of, and any still
 * there once the export ends, whichever way it ends, together with the
 * folders made for them, while those are empty. Nothing else is deleted.
 *
 * Like the exporter, this module has no dependency on the `vscode` module:
 * the files arrive through {@link SpoolDeps}.
 */

import { sha256 } from './ownership';

/** The most bytes of drawings held in memory at once. */
export const OUTPUT_BUFFER_LIMIT = 64 * 1024 * 1024;

/** The files drawings past the limit are held in. */
export interface SpoolDeps {
  /**
   * Writes `bytes` to a new temporary file in the folder of `path`, the file
   * the drawing goes to, making that folder when there is none: the new
   * file, and the folders made for it, outermost first. Rejects when it
   * cannot, having deleted what it made.
   */
  spool(path: string, bytes: Uint8Array): Promise<{ file: string; made: readonly string[] }>;
  /** The bytes of a file {@link spool} wrote, or null when it is not there. */
  readSpool(file: string): Promise<Uint8Array | null>;
  /** Deletes a file {@link spool} wrote. Never rejects: says why when it cannot. */
  deleteSpool(file: string): Promise<void>;
  /** Deletes a folder {@link spool} made, when it is empty. Never rejects. */
  deleteFolder(folder: string): Promise<void>;
}

/** What bytes are known by without them: how many there are, and their SHA-256. */
export interface Digest {
  readonly size: number;
  readonly sha256: string;
}

/** The digest of `content`, text as UTF-8. */
export function digestOf(content: string | Uint8Array): Digest {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return { size: bytes.byteLength, sha256: sha256(bytes) };
}

/** Whether two digests are of the same bytes. */
export function sameDigest(a: Digest, b: Digest): boolean {
  return a.size === b.size && a.sha256 === b.sha256;
}

/** A drawing an {@link OutputBuffer} holds: known by its digest, and told apart from another of the same bytes. */
export type Held = Digest;

/** The drawings of one export, held until they are written. */
export class OutputBuffer {
  /** The drawings held in memory, and the bytes they take. */
  private readonly memory = new Map<Held, string | Uint8Array>();
  private inMemory = 0;
  /** The drawings held in files: the file of each. */
  private readonly spooled = new Map<Held, string>();
  /** The folders made for those files, in the order they were made. */
  private readonly made: string[] = [];

  constructor(
    private readonly deps: SpoolDeps,
    private readonly limit: number = OUTPUT_BUFFER_LIMIT
  ) {}

  /**
   * Holds `content`, drawn for the file at `path`: in memory while there is
   * room for it, else in a file beside that one. Rejects when that file
   * cannot be written.
   */
  async hold(path: string, content: string | Uint8Array): Promise<Held> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const held: Held = { size: bytes.byteLength, sha256: sha256(bytes) };
    if (this.inMemory + held.size <= this.limit) {
      this.memory.set(held, content);
      this.inMemory += held.size;
      return held;
    }
    const { file, made } = await this.deps.spool(path, bytes);
    this.made.push(...made);
    this.spooled.set(held, file);
    return held;
  }

  /**
   * The content of `held`: from memory, or read back from its file. Null
   * when that file is gone or no longer holds what was put there, and when
   * `held` was let go of.
   */
  async read(held: Held): Promise<string | Uint8Array | null> {
    const content = this.memory.get(held);
    if (content !== undefined) {
      return content;
    }
    const file = this.spooled.get(held);
    if (file === undefined) {
      return null;
    }
    const bytes = await this.deps.readSpool(file);
    return bytes !== null && sameDigest(digestOf(bytes), held) ? bytes : null;
  }

  /** Lets go of `held`: the room it took in memory, or its file. */
  async release(held: Held): Promise<void> {
    if (this.memory.delete(held)) {
      this.inMemory -= held.size;
      return;
    }
    const file = this.spooled.get(held);
    if (file !== undefined) {
      this.spooled.delete(held);
      await this.deps.deleteSpool(file);
    }
  }

  /**
   * Lets go of every drawing still held, then deletes the folders made for
   * their files that are empty, the last made first. For once the export
   * ends, whichever way it ends.
   */
  async dispose(): Promise<void> {
    for (const held of [...this.memory.keys(), ...this.spooled.keys()]) {
      await this.release(held);
    }
    for (const folder of this.made.splice(0).reverse()) {
      await this.deps.deleteFolder(folder);
    }
  }
}
