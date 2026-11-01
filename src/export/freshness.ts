import { EXPORT_FRAGMENT } from '../core/constants';
import { splitLines } from '../core/lines';
import { isValidBlockName, type PlantUmlBlock } from './blocks';
import { artifactKey, sameKey, type ArtifactKey, type ArtifactRecord } from './history';
import { RENDER_CONTRACT, type InputManifest, type Palette, type RendererIdentity } from './manifest';
import { sha256 } from './ownership';
import type { DrawnFrom, InputChange } from './recheck';
import { managedReferenceOf } from './references';
import type { ReplayReason } from './replay';

/**
 * Whether the images exported from a document are still the images of its
 * diagrams, told without drawing them: for each diagram named in the
 * document and each format it was exported as, the file it is exported to
 * now and the record of what was written there (src/export/history.ts) —
 * the bytes, and what they were drawn from (src/export/manifest.ts),
 * looked at again as things are now (src/export/recheck.ts). The marked
 * image links after its blocks are looked at too, apart from the images.
 *
 * Nothing is drawn, written or recorded: the check reads the files the
 * diagrams are exported to, and the records. An image whose inputs are
 * the same is not said to be drawn the same now: only that what it was
 * drawn from is what it would be drawn from.
 *
 * Like the exporter, this module has no dependency on the `vscode` module:
 * what it reads arrives through {@link FreshnessDeps}.
 */

/**
 * What an exported image is found to be. An image the export did not
 * record writing is `unmanaged`, whatever else is true of it; of the rest,
 * the first state in {@link STATES} that one of its reasons calls for, or
 * `current` when none does: what it was recorded drawing from and writing
 * is what there is now.
 */
export type FreshnessState = 'unmanaged' | 'unsupported' | 'conflict' | 'missing' | 'unknown' | 'stale' | 'current';

/** The states a reason calls for, the most pressing first. */
const STATES = ['unsupported', 'conflict', 'missing', 'unknown', 'stale'] as const;

/** Why an image is in the state it is in: each reason says the state it calls for. */
export type FreshnessReason =
  /** No record of writing it: made by hand or by another program, or its record is gone. */
  | { state: 'unmanaged'; why: 'unrecorded' }
  /** Something other than a file is where the image goes: a folder, say. */
  | { state: 'unsupported'; why: 'not-file' }
  /** A link is where the image goes, which is not followed. */
  | { state: 'unsupported'; why: 'link' }
  /** Other diagrams of the document, named, are exported to the same file. */
  | { state: 'conflict'; why: 'shared'; with: readonly string[] }
  /** The file is recorded as another diagram's export. */
  | { state: 'conflict'; why: 'owner'; owner: ArtifactKey }
  /** The file changed since it was exported. */
  | { state: 'conflict'; why: 'edited' }
  /** The file is open with unsaved changes. */
  | { state: 'conflict'; why: 'dirty' }
  /** The file recorded is not there. */
  | { state: 'missing'; why: 'deleted' }
  /** Only an earlier version of the extension recorded exporting it, and not what it was drawn from. */
  | { state: 'unknown'; why: 'earlier-version' }
  /** Recorded without what it was drawn from. */
  | { state: 'unknown'; why: 'no-inputs' }
  /** Drawn though a file it asked for was not delivered. */
  | { state: 'unknown'; why: 'incomplete' }
  /** Drawn from text that may draw it otherwise another time (src/export/replay.ts). */
  | { state: 'unknown'; why: 'replay'; replay: 'volatile' | 'unclassified'; reasons: readonly ReplayReason[] }
  /** The renderer of this version cannot be told. */
  | { state: 'unknown'; why: 'renderer-unknown' }
  /** Larger than is read to check it ({@link FRESHNESS_LIMITS}). */
  | { state: 'unknown'; why: 'too-large' }
  /** It could not be read, and why. */
  | { state: 'unknown'; why: 'unreadable'; message: string }
  /** Exported to another file, where its exports go no longer. */
  | { state: 'stale'; why: 'elsewhere'; output: string }
  /** Drawn by another renderer: another engine, or another build of what draws with it. */
  | { state: 'stale'; why: 'renderer' }
  /** Drawn in another palette than an export asks for now. */
  | { state: 'stale'; why: 'palette'; was: Palette; now: Palette }
  /** A PNG drawn at another scale than an export draws at now. */
  | { state: 'stale'; why: 'scale'; was: number | null; now: number }
  /** Something it was drawn from is otherwise now. */
  | { state: 'stale'; why: 'input'; change: InputChange };

/** An image a diagram of the document is exported as, as found. */
export interface FreshnessRow {
  /** The diagram's name, and the line it starts on, counting from 0. */
  readonly name: string;
  readonly line: number;
  readonly format: 'svg' | 'png';
  /** The file it is exported to now. */
  readonly output: string;
  readonly state: FreshnessState;
  /** Every reason found, in the order found. */
  readonly reasons: readonly FreshnessReason[];
  /** Whether what it was drawn from was looked at again: then, without a stale reason, it is what it would be drawn from now. */
  readonly compared: boolean;
  /** Whether a file it includes was read with the unsaved changes of an editor. */
  readonly unsaved: boolean;
}

/** A marked image link after a block that does not show the block's image as exported now. */
export interface ReferenceProblem {
  /** The diagram the link follows, and the line of the link, counting from 0. */
  readonly name: string;
  readonly line: number;
  /** What it shows the image as, and what it links to, as written. */
  readonly alt: string;
  readonly target: string;
  /**
   * `invalid`: no path relative to the document; `elsewhere`: a file other
   * than the one the diagram is exported to; `name`: that file, under
   * another name than the diagram's; `no-image`: that file, which is not
   * there.
   */
  readonly problem: 'invalid' | 'elsewhere' | 'name' | 'no-image';
}

/** What a check of a document found. */
export interface FreshnessReport {
  readonly rows: readonly FreshnessRow[];
  readonly references: readonly ReferenceProblem[];
  /** The records of files exported from the document that none of its diagrams is exported to now. Nothing is done to them. */
  readonly orphans: readonly ArtifactRecord[];
  /** Diagrams without a name of their own: exported under a name typed in, they are not recorded. */
  readonly unnamed: number;
  /** Diagrams whose name cannot be a file name. */
  readonly invalid: number;
}

/** The most bytes of an image read to check it: past that, whether it is the image recorded is not known. */
export const FRESHNESS_LIMITS = { bytes: 64 * 1024 * 1024 } as const;

/** The file an image goes to, as read to check it. */
export type OutputRead =
  | { kind: 'none' }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'not-file' }
  | { kind: 'link' }
  | { kind: 'too-large' }
  | { kind: 'failed'; message: string };

/** What a check reads, and how. */
export interface FreshnessDeps {
  /** Joins a document path's directory with a relative path, as the export does. */
  resolve(documentPath: string, relative: string): string;
  /** The records of the files exported from the document at `document`. */
  recordsOf(document: string): readonly ArtifactRecord[];
  /** The record of the file at `output`, of whichever document; null when there is none. */
  ownerOf(output: string): ArtifactRecord | null;
  /** Whether `existing`, the file at `output`, is what an earlier version recorded exporting there from `document`, unchanged since. */
  wroteBefore(output: string, document: string, existing: Uint8Array): boolean;
  /** Whether the file at `output` is open with unsaved changes. */
  isDirty(output: string): boolean;
  /** The file at `output`, its bytes read only when it is a file of at most `limit` bytes; a link is not followed. */
  readOutput(output: string, limit: number): Promise<OutputRead>;
  /** The renderer as it ships, or null when it cannot be told. */
  rendererIdentity(): Promise<RendererIdentity | null>;
  /** Whether an export asks for the dark palette now. */
  isDark(): boolean;
  /** The scale an export draws a PNG at now. */
  pngScale(): number;
  /**
   * What of `drawn` is otherwise now (src/export/recheck.ts), for the
   * diagram whose text is `source` now; and whether a file it includes
   * was read with the unsaved changes of an editor.
   */
  recheck(drawn: DrawnFrom, source: string | null): Promise<{ changes: InputChange[]; unsaved: boolean }>;
  /** Whether the check is to stop: it was cancelled. */
  cancelled(): boolean;
}

/** The state `reasons` call for: `unmanaged` apart, then the most pressing of the rest, or `current` when there are none. */
export function stateOf(reasons: readonly FreshnessReason[]): FreshnessState {
  if (reasons.some((reason) => reason.state === 'unmanaged')) {
    return 'unmanaged';
  }
  return STATES.find((state) => reasons.some((reason) => reason.state === state)) ?? 'current';
}

const FORMATS = ['svg', 'png'] as const;

/** A diagram as it is exported now: the file, and the key it is recorded under. */
interface Planned {
  block: PlantUmlBlock;
  name: string;
  format: 'svg' | 'png';
  output: string;
  key: ArtifactKey;
}

/** What a manifest says the image was drawn from, for looking at again. */
function drawnFrom(manifest: InputManifest): DrawnFrom {
  return {
    source: manifest.input.source,
    context: manifest.context,
    requests: manifest.resources.requests,
    files: manifest.resources.files,
  };
}

/**
 * What an image whose file holds what its record says was drawn from,
 * compared with what it would be drawn from now: the renderer, the
 * palette, a PNG's scale and its inputs; and whether its inputs can tell.
 */
async function lookAgain(
  deps: FreshnessDeps,
  planned: Planned,
  record: ArtifactRecord,
  renderer: () => Promise<RendererIdentity | null>
): Promise<{ reasons: FreshnessReason[]; compared: boolean; unsaved: boolean }> {
  const manifest = record.input;
  if (manifest === undefined) {
    return { reasons: [{ state: 'unknown', why: 'no-inputs' }], compared: false, unsaved: false };
  }
  const reasons: FreshnessReason[] = [];
  const identity = await renderer();
  if (identity === null) {
    reasons.push({ state: 'unknown', why: 'renderer-unknown' });
  } else if (
    manifest.renderer.engine !== identity.engine ||
    manifest.renderer.build !== identity.build ||
    manifest.renderer.contract !== RENDER_CONTRACT ||
    (planned.format === 'png' && manifest.renderer.raster !== identity.raster)
  ) {
    reasons.push({ state: 'stale', why: 'renderer' });
  }
  const palette: Palette = deps.isDark() ? 'dark' : 'light';
  if (manifest.options.palette.asked !== palette) {
    reasons.push({ state: 'stale', why: 'palette', was: manifest.options.palette.asked, now: palette });
  }
  // An SVG is drawn at no scale: only a PNG is drawn otherwise at another.
  const scale = deps.pngScale();
  if (planned.format === 'png' && manifest.options.pngScale !== scale) {
    reasons.push({ state: 'stale', why: 'scale', was: manifest.options.pngScale, now: scale });
  }
  const { changes, unsaved } = await deps.recheck(drawnFrom(manifest), planned.block.raw);
  reasons.push(...changes.map((change): FreshnessReason => ({ state: 'stale', why: 'input', change })));
  // What the image was drawn from may be what it would be drawn from now,
  // and the image another: a file it asked for was not delivered, or its
  // text draws differently another time. Unknown, rather than current —
  // and, a change found besides, what changed is said too.
  if (manifest.completeness === 'unknown') {
    reasons.push({ state: 'unknown', why: 'incomplete' });
  }
  if (manifest.replay.class !== 'stable-inputs') {
    reasons.push({ state: 'unknown', why: 'replay', replay: manifest.replay.class, reasons: manifest.replay.reasons });
  }
  return { reasons, compared: true, unsaved };
}

/** A link target: an absolute URI, or a path from the root of a drive or a site. */
const ABSOLUTE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/\\])/;

/**
 * `path` as the file it names: each run of `%XX` escapes decoded as UTF-8,
 * and a `%` that starts none left as it is, as a Markdown renderer leaves a
 * link to be read (markdown-it keeps an escape and escapes a lone `%`).
 * Null when an escape decodes to no UTF-8.
 */
function decodePercent(path: string): string | null {
  try {
    return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => decodeURIComponent(run));
  } catch {
    return null;
  }
}

/**
 * Checks the images and marked links of the document at `document`, whose
 * text is `text` and diagrams `blocks`, exported to `directory`: the
 * diagrams of a Markdown document when `markdown`, else of a PlantUML file,
 * which has no links. 'cancelled' once {@link FreshnessDeps.cancelled}
 * says so, between images.
 */
export async function checkFreshness(
  deps: FreshnessDeps,
  document: string,
  text: string,
  blocks: readonly PlantUmlBlock[],
  directory: string,
  markdown: boolean
): Promise<FreshnessReport | 'cancelled'> {
  const named = blocks.filter((block) => block.name !== null);
  const valid = named.filter((block) => block.name !== null && isValidBlockName(block.name));
  const planned: Planned[] = valid.flatMap((block) =>
    FORMATS.flatMap((format): Planned[] => {
      const name = block.name ?? '';
      const key = artifactKey(document, block, name, format);
      return key === null ? [] : [{ block, name, format, output: deps.resolve(document, `${directory}/${name}.${format}`), key }];
    })
  );
  // Diagrams exported to the same file, told apart regardless of case as
  // the export tells them apart: each of them is in conflict, whichever
  // the file holds now.
  const parties = new Map<string, Planned[]>();
  for (const each of planned) {
    const file = each.output.toLowerCase();
    parties.set(file, [...(parties.get(file) ?? []), each]);
  }

  const records = deps.recordsOf(document);
  const cited = new Set<ArtifactRecord>();
  const there = new Map<string, boolean>();
  let identity: Promise<RendererIdentity | null> | undefined;
  const renderer = (): Promise<RendererIdentity | null> => (identity ??= deps.rendererIdentity());
  const rows: FreshnessRow[] = [];
  for (const each of planned) {
    if (deps.cancelled()) {
      return 'cancelled';
    }
    const read = await deps.readOutput(each.output, FRESHNESS_LIMITS.bytes);
    there.set(each.output, read.kind !== 'none');
    const dirty = deps.isDirty(each.output);
    const owner = deps.ownerOf(each.output);
    const own = owner !== null && sameKey(owner.key, each.key) ? owner : null;
    const elsewhere = records.filter((record) => sameKey(record.key, each.key) && record.output !== each.output);
    // Never exported as this format, or not since its record went.
    if (read.kind === 'none' && !dirty && own === null && elsewhere.length === 0) {
      continue;
    }
    const others = (parties.get(each.output.toLowerCase()) ?? []).filter((other) => other !== each);
    // Its export where it goes now is the record of it; one elsewhere is
    // the record of it only while there is none here, and the file is its
    // alone. Any other is listed apart.
    const citing = own !== null ? [own] : others.length === 0 ? elsewhere : [];
    for (const record of citing) {
      cited.add(record);
    }

    const reasons: FreshnessReason[] = [];
    let compared = false;
    let unsaved = false;
    if (others.length > 0) {
      reasons.push({ state: 'conflict', why: 'shared', with: others.map((other) => other.name) });
    } else if (dirty) {
      reasons.push({ state: 'conflict', why: 'dirty' });
    } else if (read.kind === 'not-file' || read.kind === 'link') {
      reasons.push({ state: 'unsupported', why: read.kind });
    } else if (read.kind === 'too-large') {
      reasons.push({ state: 'unknown', why: 'too-large' });
    } else if (read.kind === 'failed') {
      reasons.push({ state: 'unknown', why: 'unreadable', message: read.message });
    } else if (read.kind === 'none') {
      if (own !== null) {
        reasons.push({ state: 'missing', why: 'deleted' });
      }
    } else if (owner === null) {
      reasons.push(
        deps.wroteBefore(each.output, document, read.bytes)
          ? { state: 'unknown', why: 'earlier-version' }
          : { state: 'unmanaged', why: 'unrecorded' }
      );
    } else if (own === null) {
      reasons.push({ state: 'conflict', why: 'owner', owner: owner.key });
    } else if (sha256(read.bytes) !== own.sha256) {
      reasons.push({ state: 'conflict', why: 'edited' });
    } else {
      const looked = await lookAgain(deps, each, own, renderer);
      reasons.push(...looked.reasons);
      ({ compared, unsaved } = looked);
    }
    if (own === null) {
      reasons.push(...citing.map((record): FreshnessReason => ({ state: 'stale', why: 'elsewhere', output: record.output })));
    }
    rows.push({
      name: each.name,
      line: each.block.openLine,
      format: each.format,
      output: each.output,
      state: stateOf(reasons),
      reasons,
      compared,
      unsaved,
    });
  }

  const references: ReferenceProblem[] = [];
  if (markdown) {
    const lines = splitLines(text);
    for (const each of planned.filter((candidate) => candidate.format === 'svg')) {
      const reference = managedReferenceOf(lines, each.block);
      if (reference === null) {
        continue;
      }
      const path = decodePercent(reference.target.slice(0, -EXPORT_FRAGMENT.length));
      const problem: ReferenceProblem['problem'] | null =
        path === null || path === '' || ABSOLUTE.test(path)
          ? 'invalid'
          : deps.resolve(document, path) !== each.output
            ? 'elsewhere'
            : reference.alt !== each.name
              ? 'name'
              : there.get(each.output) === true
                ? null
                : 'no-image';
      if (problem !== null) {
        references.push({ name: each.name, line: reference.line, alt: reference.alt, target: reference.target, problem });
      }
    }
  }

  return {
    rows,
    references,
    orphans: records.filter((record) => !cited.has(record)),
    unnamed: blocks.length - named.length,
    invalid: named.length - valid.length,
  };
}
