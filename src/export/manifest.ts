import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DiagramRender, IncludeContext, InputOrigin, InputRequest } from '../core/types';
import type { ArtifactKey } from './history';
import { classifyReplay, REPLAY_RULES, scanText, type ReplayClass, type ReplayReason } from './replay';

/**
 * What an exported image was drawn from, recorded with it
 * (src/export/history.ts): the diagram's text and what the engine was given,
 * where its local includes were looked for, each file delivered by the
 * SHA-256 of its text, the files of the bundled libraries read, the
 * renderer, the palette and the scale. No text and no image is kept, only
 * paths and hashes.
 *
 * The manifest is known by a fingerprint: the SHA-256 of its fields as
 * canonical JSON ({@link canonicalJson}), so that the same inputs give the
 * same fingerprint whatever order they were put together in, and nothing
 * that does not change the image — the line the diagram starts on, the
 * document's version, an editor's having a file open — is in it.
 */

/** The name of the shape below; another shape is another schema. */
export const INPUT_SCHEMA = 'plantuml-local-input-v1';

/**
 * What the extension does to a drawing after the engine and the worker
 * have: the background it bakes in, the colour of a dark drawing's links,
 * how the palette is chosen (src/render/palette.ts). Raised whenever one of
 * them draws differently; test/unit/manifest.test.ts holds the drawings
 * they make to this number.
 */
export const RENDER_CONTRACT = 1;

/** The renderer an image was drawn by, as the files that ship make it up. */
export interface RendererIdentity {
  /** The engine's version. */
  engine: string;
  /** The SHA-256 of the worker, the engine and the bundled libraries, as shipped. */
  build: string;
  /** The SHA-256 of what draws a PNG from the SVG. */
  raster: string;
}

/**
 * The files the worker draws with, under the folder the extension's code
 * ships in: the worker itself, and the engine's files it loads. The bundled
 * libraries, in `stdlib/`, are read too.
 */
const RENDERER_FILES = ['worker.js', 'engine/plantuml.js', 'engine/viz-global.cjs', 'engine/themes.cjs', 'engine/openiconic.cjs'];

const shipped = new Map<string, Promise<RendererIdentity | null>>();

/**
 * The renderer shipped in `dist`, the folder the extension's code ships
 * in, with `raster` drawing its PNGs and `engine` the engine's version:
 * hashed when first asked for, as none of it changes while the extension
 * runs. Null when a file cannot be read, and an image is recorded without.
 */
export function shippedRenderer(dist: string, raster: string, engine: string): Promise<RendererIdentity | null> {
  const where = `${dist}\n${raster}\n${engine}`;
  let known = shipped.get(where);
  if (known === undefined) {
    known = identify(dist, raster, engine).catch(() => null);
    shipped.set(where, known);
  }
  return known;
}

async function identify(dist: string, raster: string, engine: string): Promise<RendererIdentity> {
  const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
  const libraries = (await readdir(join(dist, 'stdlib')))
    .filter((name) => name.endsWith('.json'))
    .sort(byCodeUnits)
    .map((name) => `stdlib/${name}`);
  // Each file by its path and the SHA-256 of its bytes, one line each.
  const build = createHash('sha256');
  for (const file of [...RENDERER_FILES, ...libraries]) {
    build.update(`${file}\0${digest(await readFile(join(dist, file)))}\n`);
  }
  return { engine, build: build.digest('hex'), raster: digest(await readFile(raster)) };
}

/** A file delivered for a local include, as recorded. */
export interface ManifestFile {
  file: string;
  sha256: string;
  origin: InputOrigin;
}

export interface InputManifest {
  schema: typeof INPUT_SCHEMA;
  /** The SHA-256 of the diagram's text as the document holds it, and of what the engine was given. */
  input: { source: string; render: string };
  context: IncludeContext;
  resources: {
    /** In the order the engine asked. */
    requests: InputRequest[];
    /** Each file delivered once, in the order of their paths. */
    files: ManifestFile[];
    /** Each file of a bundled library read once, in the order of the library, then the file. */
    libraries: { library: string; key: string; found: boolean }[];
  };
  renderer: { engine: string; build: string; raster: string | null; contract: number };
  options: { format: 'svg' | 'png'; palette: { asked: Palette; drawn: Palette }; pngScale: number | null };
  /**
   * Whether the image holds all the diagram does: `known-loss` when the
   * engine drew it without some of its notation (a formula, an embedded
   * diagram, an image), `unknown` when it was drawn though a file it asked
   * for was not delivered.
   */
  completeness: 'complete' | 'known-loss' | 'unknown';
  replay: { class: ReplayClass; rules: number; reasons: ReplayReason[] };
  fingerprint: string;
}

export type Palette = 'light' | 'dark';

/**
 * `value` as JSON written one way only: the keys of each object in the
 * order of their UTF-16 code units, strings escaped as JSON.stringify
 * escapes them, nothing else normalised. Arrays keep their order. Throws
 * for what JSON cannot say as it is — undefined, NaN, an infinity, a
 * function, a BigInt, an object other than a plain one — and for a cycle,
 * rather than leaving it out or writing null in its place as
 * JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  const open = new Set<object>();
  const write = (item: unknown): string => {
    if (item === null) {
      return 'null';
    }
    if (typeof item === 'boolean' || typeof item === 'string') {
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) {
        throw new TypeError(`${String(item)} has no canonical JSON`);
      }
      return JSON.stringify(item);
    }
    if (typeof item !== 'object') {
      throw new TypeError(`a ${typeof item} has no canonical JSON`);
    }
    if (open.has(item)) {
      throw new TypeError('a cycle has no canonical JSON');
    }
    open.add(item);
    try {
      if (Array.isArray(item)) {
        // Array.from visits a hole as undefined, which throws.
        return `[${Array.from(item as unknown[], write).join(',')}]`;
      }
      const prototype: unknown = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('only a plain object has canonical JSON');
      }
      const fields = item as Record<string, unknown>;
      return `{${Object.keys(fields)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${write(fields[key])}`)
        .join(',')}}`;
    } finally {
      open.delete(item);
    }
  };
  return write(value);
}

/** The SHA-256 of `text` as UTF-8, in hex. */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The fingerprint of `manifest` recorded for the diagram `key` names: of
 * everything that went into drawing the image, but not of where a file's
 * text came from, nor of what is worked out from the rest (completeness,
 * replay).
 */
export function inputFingerprint(manifest: Omit<InputManifest, 'fingerprint'>, key: ArtifactKey): string {
  return sha256(
    canonicalJson({
      schema: manifest.schema,
      key: { ...key },
      input: manifest.input,
      context: manifest.context,
      resources: {
        requests: manifest.resources.requests,
        files: manifest.resources.files.map(({ file, sha256: hash }) => ({ file, sha256: hash })),
        libraries: manifest.resources.libraries,
      },
      renderer: manifest.renderer,
      options: manifest.options,
    })
  );
}

/** What a manifest is made from: a drawing taken for an export, and what it was taken for. */
export interface ManifestSource {
  key: ArtifactKey;
  /** The diagram's text as the document holds it. */
  source: string;
  /** What the engine was given. */
  render: string;
  /** The drawing taken, drawn with the reads of the export. */
  drawn: DiagramRender;
  /** Whether the dark palette was asked for, and whether it was drawn in. */
  dark: { asked: boolean; drawn: boolean };
  format: 'svg' | 'png';
  /** The scale a PNG was drawn at; null for an SVG. */
  pngScale: number | null;
  renderer: RendererIdentity;
  /** How many kinds of notation the engine drew it without. */
  losses: number;
}

const paletteOf = (dark: boolean): Palette => (dark ? 'dark' : 'light');

/** Compares by UTF-16 code units, as the default sort does. */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The manifest of a drawing; null when it was not drawn with the reads of
 * an export, which alone say what it was drawn from.
 */
export function inputManifest(made: ManifestSource): InputManifest | null {
  const inputs = made.drawn.inputs;
  if (inputs === undefined) {
    return null;
  }
  const libraries = [
    ...new Map(
      (made.drawn.log?.libraries ?? []).map(({ library, key, found }) => [`${library}\n${key}`, { library, key, found }])
    ).values(),
  ].sort((a, b) => byCodeUnits(a.library, b.library) || byCodeUnits(a.key, b.key));
  const files = inputs.files
    .map(({ file, sha256: hash, origin }) => ({ file, sha256: hash, origin }))
    .sort((a, b) => byCodeUnits(a.file, b.file));
  const unread =
    inputs.requests.some(({ outcome }) => outcome !== 'read') || libraries.some(({ found }) => !found);
  const replay = classifyReplay(scanText(made.render), inputs.files, libraries);
  const manifest: Omit<InputManifest, 'fingerprint'> = {
    schema: INPUT_SCHEMA,
    input: { source: sha256(made.source), render: sha256(made.render) },
    context: inputs.context,
    resources: {
      requests: inputs.requests.map((request) => ({ ...request, looked: [...request.looked] })),
      files,
      libraries,
    },
    renderer: {
      engine: made.renderer.engine,
      build: made.renderer.build,
      raster: made.format === 'png' ? made.renderer.raster : null,
      contract: RENDER_CONTRACT,
    },
    options: {
      format: made.format,
      palette: { asked: paletteOf(made.dark.asked), drawn: paletteOf(made.dark.drawn) },
      pngScale: made.format === 'png' ? made.pngScale : null,
    },
    completeness: unread ? 'unknown' : made.losses > 0 ? 'known-loss' : 'complete',
    replay: { class: replay.class, rules: REPLAY_RULES, reasons: replay.reasons },
  };
  return { ...manifest, fingerprint: inputFingerprint(manifest, made.key) };
}

/** Whether `value` is an object with exactly the fields `fields`. */
function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

const SHA256 = /^[0-9a-f]{64}$/;
const isHash = (value: unknown): boolean => typeof value === 'string' && SHA256.test(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): boolean => Array.isArray(value) && value.every(isString);
const isPalette = (value: unknown): boolean => value === 'light' || value === 'dark';
const isLine = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const UNAVAILABLE: ReadonlySet<unknown> = new Set(['untrusted', 'untitled', 'not-on-disk', 'outside-workspace', 'setting']);
const KINDS: ReadonlySet<unknown> = new Set([null, 'include', 'includesub', 'theme']);

/** Whether `value` says where local includes were looked for, as a manifest records it. */
export function isIncludeContext(value: unknown): value is IncludeContext {
  if (value === null) {
    return true;
  }
  if (hasFields(value, ['unavailable'])) {
    return UNAVAILABLE.has(value['unavailable']);
  }
  return (
    hasFields(value, ['root', 'folder', 'searchFolders']) &&
    isString(value['root']) &&
    isString(value['folder']) &&
    isStrings(value['searchFolders'])
  );
}

function isRequest(value: unknown): boolean {
  return (
    hasFields(value, ['path', 'from', 'kind', 'outcome', 'file', 'looked']) &&
    isString(value['path']) &&
    (value['from'] === null || isString(value['from'])) &&
    KINDS.has(value['kind']) &&
    isString(value['outcome']) &&
    (value['file'] === null || isString(value['file'])) &&
    isStrings(value['looked'])
  );
}

function isResources(value: unknown): boolean {
  return (
    hasFields(value, ['requests', 'files', 'libraries']) &&
    Array.isArray(value['requests']) &&
    value['requests'].every(isRequest) &&
    Array.isArray(value['files']) &&
    value['files'].every(
      (file: unknown) =>
        hasFields(file, ['file', 'sha256', 'origin']) &&
        isString(file['file']) &&
        isHash(file['sha256']) &&
        (file['origin'] === 'disk' || file['origin'] === 'editor')
    ) &&
    Array.isArray(value['libraries']) &&
    value['libraries'].every(
      (library: unknown) =>
        hasFields(library, ['library', 'key', 'found']) &&
        isString(library['library']) &&
        isString(library['key']) &&
        typeof library['found'] === 'boolean'
    )
  );
}

function isReplay(value: unknown): boolean {
  return (
    hasFields(value, ['class', 'rules', 'reasons']) &&
    (value['class'] === 'stable-inputs' || value['class'] === 'volatile' || value['class'] === 'unclassified') &&
    isLine(value['rules']) &&
    Array.isArray(value['reasons']) &&
    value['reasons'].every(
      (reason: unknown) =>
        hasFields(reason, ['replay', 'what', 'line', 'file']) &&
        (reason['replay'] === 'volatile' || reason['replay'] === 'unclassified') &&
        isString(reason['what']) &&
        isLine(reason['line']) &&
        (reason['file'] === null || isString(reason['file']))
    )
  );
}

/**
 * Whether `value` is a manifest as this version writes one, recorded for
 * the diagram `key` names: every field of the shape, and nothing else, and
 * a fingerprint that is the fingerprint of the rest.
 */
export function isInputManifest(value: unknown, key: ArtifactKey): value is InputManifest {
  if (
    !hasFields(value, ['schema', 'input', 'context', 'resources', 'renderer', 'options', 'completeness', 'replay', 'fingerprint']) ||
    value['schema'] !== INPUT_SCHEMA
  ) {
    return false;
  }
  const { input, context, resources, renderer, options, completeness, replay, fingerprint } = value;
  const shaped =
    hasFields(input, ['source', 'render']) &&
    isHash(input['source']) &&
    isHash(input['render']) &&
    isIncludeContext(context) &&
    isResources(resources) &&
    hasFields(renderer, ['engine', 'build', 'raster', 'contract']) &&
    isString(renderer['engine']) &&
    isHash(renderer['build']) &&
    (renderer['raster'] === null || isHash(renderer['raster'])) &&
    isLine(renderer['contract']) &&
    hasFields(options, ['format', 'palette', 'pngScale']) &&
    (options['format'] === 'svg' || options['format'] === 'png') &&
    hasFields(options['palette'], ['asked', 'drawn']) &&
    isPalette(options['palette']['asked']) &&
    isPalette(options['palette']['drawn']) &&
    (options['pngScale'] === null || (typeof options['pngScale'] === 'number' && Number.isFinite(options['pngScale']))) &&
    (completeness === 'complete' || completeness === 'known-loss' || completeness === 'unknown') &&
    isReplay(replay) &&
    isHash(fingerprint);
  if (!shaped) {
    return false;
  }
  try {
    return inputFingerprint(value as unknown as InputManifest, key) === fingerprint;
  } catch {
    // What the state gives back is JSON, which has no canonical form only
    // when it is not JSON: no manifest of this version's.
    return false;
  }
}
