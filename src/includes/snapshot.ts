import { createHash } from 'node:crypto';

import { INCLUDE_LIMITS } from '../core/constants';
import type { DeliveredFile, ReplayFinding } from '../core/types';
import { isFileRead, readMeasured, type MeasuredRead } from './reader';
import type { CandidateReader, IncludeAccess } from './session';

/**
 * The reads of one export: each file read once, and given as first read for
 * the rest of the export.
 *
 * An export draws a diagram up to three times, to find the palette its
 * themes read in (src/render/palette.ts), and a folder export draws every
 * diagram of every document. Each drawing asks for its local includes
 * again. Read again each time, a file edited in between would put one text
 * in one drawing and another in the next, and the export would record
 * inputs no drawing had. So within an export, the first read of a path is
 * the answer to every later one: its text, or that it was missing, or why
 * it was refused. So is where a document's diagrams look for their files:
 * the workspace's trust, its folder and the setting, as first looked up.
 *
 * What a render may read is still counted render by render (src/includes/
 * session.ts): a file read before counts as much as one read now, and a
 * read too large for the bytes left is refused as it would have been.
 *
 * Each file delivered is known by the SHA-256 of its text as UTF-8, which
 * is what the engine was given, by where the text came from, and by what
 * its text holds that may draw the diagram differently another time
 * (`scan`): worked out once, at the first read.
 *
 * What draws a diagram from its saved files alone — an SVG exported when
 * its files are saved — reads with `savedOnly`: a file open in an editor
 * with unsaved changes is not read from the editor, and is noted instead
 * (src/includes/host.ts), for the drawing to be thrown away.
 */

/** Where a document's diagrams look for their local includes, and its workspace folder's path as opened. */
export interface DocumentAccess {
  access: IncludeAccess;
  folder: string | undefined;
}

export class ReadSnapshot {
  private readonly reads = new Map<string, Promise<MeasuredRead>>();
  private readonly files = new Map<string, DeliveredFile & { text: string; bytes: number }>();
  private readonly accesses = new Map<string, Promise<DocumentAccess>>();
  private readonly unsavedFiles = new Set<string>();
  private readonly candidates = new Set<string>();

  /** Whether the files are read as saved: a document open with unsaved changes is noted rather than read from the editor. */
  readonly savedOnly: boolean;

  constructor(
    private readonly scan: (text: string) => readonly ReplayFinding[],
    options: { savedOnly?: boolean } = {}
  ) {
    this.savedOnly = options.savedOnly === true;
  }

  /** Notes that the file at `path`, which the drawing looked at, is open with unsaved changes. */
  noteUnsaved(path: string): void {
    this.unsavedFiles.add(path);
  }

  /** The files noted as open with unsaved changes, in the order noted. */
  unsaved(): string[] {
    return [...this.unsavedFiles];
  }

  /**
   * Every path a drawing looked at for a file, found there or not, by its
   * real path, in the order first looked at: where a file saved later
   * would change what is drawn.
   */
  looked(): string[] {
    return [...this.candidates];
  }

  /** What `look` gave for `document` the first time this export asked. */
  access(document: string, look: () => Promise<DocumentAccess>): Promise<DocumentAccess> {
    let known = this.accesses.get(document);
    if (known === undefined) {
      known = look();
      this.accesses.set(document, known);
    }
    return known;
  }

  /**
   * Reads files for a session: each path under its root as first read, the
   * text of a document open in an editor (`openText`) as it was then.
   */
  reader(openText: (path: string) => string | undefined): CandidateReader {
    return async (root, candidate, maxBytes) => {
      this.candidates.add(candidate);
      const key = `${root}\n${candidate}`;
      let read = this.reads.get(key);
      if (read === undefined) {
        read = this.first(root, candidate, openText);
        this.reads.set(key, read);
      }
      const known = await read;
      // Held against the bytes this render has left, as the read itself
      // would have been.
      return known.bytes !== undefined && known.bytes > maxBytes
        ? { outcome: { kind: 'refused', refusal: 'too-large' }, bytes: known.bytes }
        : known;
    };
  }

  /** The file delivered as `id`, the real path the engine was given. */
  delivered(id: string): DeliveredFile | undefined {
    const file = this.files.get(id);
    return file === undefined ? undefined : { file: file.file, sha256: file.sha256, origin: file.origin, findings: file.findings };
  }

  /**
   * Reads `candidate` up to the most any render may read. A file already
   * read under another spelling of its path — another case, on Windows —
   * is given as first read.
   */
  private async first(root: string, candidate: string, openText: (path: string) => string | undefined): Promise<MeasuredRead> {
    const read = await readMeasured(root, candidate, { openText, maxBytes: INCLUDE_LIMITS.bytes });
    if (!isFileRead(read)) {
      return read;
    }
    const id = read.outcome.id;
    let file = this.files.get(id);
    if (file === undefined) {
      const text = read.outcome.text;
      file = {
        file: id,
        sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        origin: read.origin,
        findings: this.scan(text),
        text,
        bytes: read.bytes,
      };
      this.files.set(id, file);
    }
    return { outcome: { kind: 'file', id, text: file.text }, bytes: file.bytes, origin: file.origin };
  }
}
