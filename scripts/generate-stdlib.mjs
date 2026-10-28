/**
 * Regenerates the bundled PlantUML standard-library data.
 *
 * `@plantuml/core` deliberately ships without the sprite libraries ("load
 * them from the project site if you need them"), and this extension will
 * not fetch anything at render time. So the libraries are baked into the
 * package instead: this script pulls them from PlantUML's own standard
 * library once and writes assets/stdlib/<library>.json, which is
 * committed.
 *
 * The source is plantuml/plantuml-stdlib rather than each library's
 * upstream, because that repository is what `!include <…>` resolves
 * against in real PlantUML — directory names differ between the two (the
 * GCP upstream ships `AIAndMachineLearning`, the standard library
 * `AI_and_Machine_Learning`), and diagrams are written against the
 * latter. It is a large repository, so only the libraries below are
 * fetched, at one pinned commit, using a blobless sparse checkout.
 *
 * Pinning makes a regeneration give the same assets until the pin is moved
 * on purpose. assets/stdlib-sources.json records where each asset came
 * from: the commit, the SHA-256 of every file read and that of the asset
 * written. The unit tests hold the committed assets to that record, and
 * scripts/verify-vsix.mjs the packaged copies.
 *
 * The engine reads libraries from `window.PLANTUML_STDLIB[library][key]`
 * where `key` is the include path, lower-cased and without the `.puml`
 * extension (`<azure/Compute/AzureFunction>` -> `compute/azurefunction`),
 * and the JSON files `%load_json('<azure/all.json>')` names from
 * `window.PLANTUML_STDLIB_JSON[library][key]`, keyed the same way without
 * `.json`. As in the bundles the standard library builds for the engine,
 * the `.puml` files are stored without the lines that are only `@startuml`
 * or `@enduml`, and the JSON files parsed. See src/worker/stdlib.ts for the
 * runtime side.
 *
 * Usage: node scripts/generate-stdlib.mjs
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'stdlib');
const sourcesFile = join(root, 'assets', 'stdlib-sources.json');
const tempDir = join(root, '.stdlib-temp');

const SOURCE = 'https://github.com/plantuml/plantuml-stdlib.git';

/**
 * The plantuml-stdlib commit every library is read from, in full: the one
 * that brought in C4-PlantUML v2.14.0. Changes upstream reach the package
 * only when this moves.
 */
const COMMIT = 'a31ac1a87cbdaa3339d1a551dc971c85f8359d5d';

/**
 * Libraries to bundle, with the upstream each is generated from — that is
 * where the licence comes from, and what THIRD_PARTY_NOTICES.md credits.
 * `name` is the library as the engine looks it up, lower-cased;
 * `directory` is its folder under stdlib/ upstream. A library with `files`
 * bundles those files of its folder and nothing else; one without bundles
 * every `.puml` and `.json` in its folder.
 *
 * The other cloud icon sets are deliberately absent. Both `awslib20` and
 * `gcp` state in their READMEs that "the icons provided in this package
 * are made available to you under the terms of the CC-BY-ND 2.0 license"
 * with only the macros under MIT, and this extension ships nothing but
 * MIT / BSD / EPL. Azure-PlantUML has no such split — it is MIT
 * throughout, as is C4-PlantUML. `awslib20` would also add roughly 4 MB to
 * a 2.4 MB package.
 *
 * Diagrams can still use those icons by pasting the sprite definitions
 * into the source, which renders the same way.
 */
const LIBRARIES = [
  {
    name: 'azure',
    directory: 'azure',
    upstream: 'plantuml-stdlib/Azure-PlantUML',
    license: 'MIT',
  },
  {
    name: 'c4',
    directory: 'C4',
    upstream: 'plantuml-stdlib/C4-PlantUML',
    license: 'MIT',
    // The six kinds of diagram and the definitions they all include; not
    // the themes, the README or the examples.
    files: ['C4', 'C4_Context', 'C4_Container', 'C4_Component', 'C4_Dynamic', 'C4_Deployment', 'C4_Sequence'],
  },
];

/** Directories of demo diagrams; they pull in libraries we do not bundle. */
const SKIP_DIRECTORIES = new Set(['_examples_']);

/** The byte-order mark one C4 file starts with. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Lines the standard library leaves out of every `.puml` file it bundles
 * for the engine, which reads one in an included file as a syntax error.
 * `azure/all` is written between them.
 */
const MARKERS = new Set(['@startuml', '@enduml']);

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

function gitOutput(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fetchLibraries(directories) {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  // Blobless + sparse, and only the pinned commit: the full repository is
  // hundreds of megabytes, and the libraries we want are a fraction of one
  // percent of it. Files are checked out as committed whatever git is set
  // to do with line endings here, so what is hashed is upstream's bytes.
  git(['init', '--quiet'], tempDir);
  git(['config', 'core.autocrlf', 'false'], tempDir);
  git(['remote', 'add', 'origin', SOURCE], tempDir);
  git(['sparse-checkout', 'set', '--cone', ...directories.map((d) => `stdlib/${d}`)], tempDir);
  git(['fetch', '--quiet', '--depth', '1', '--filter=blob:none', 'origin', COMMIT], tempDir);
  git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], tempDir);

  const head = gitOutput(['rev-parse', 'HEAD'], tempDir).trim();
  if (head !== COMMIT) {
    throw new Error(`Checked out ${head}, not the pinned ${COMMIT}`);
  }
}

/** The object id git has for each file under `directory`, by path from the repository root. */
function committedBlobs(directory) {
  const blobs = new Map();
  for (const record of gitOutput(['ls-files', '--stage', '-z', '--', `stdlib/${directory}`], tempDir).split('\0')) {
    // <mode> <object> <stage>\t<path>
    const tab = record.indexOf('\t');
    if (tab !== -1) {
      blobs.set(record.slice(tab + 1), record.slice(0, tab).split(' ')[1]);
    }
  }
  return blobs;
}

/**
 * Reads one upstream file as the engine is given it — without a
 * byte-order mark, with LF line endings — and records the SHA-256 of its
 * bytes in `sources`, after checking they are the ones committed.
 */
function readSource(full, blobs, sources) {
  const path = relative(tempDir, full).split(sep).join(posix.sep);
  const bytes = readFileSync(full);
  const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (blobs.get(path) !== blob) {
    throw new Error(`${path} is not the file committed upstream`);
  }
  sources[path] = sha256(bytes);
  const text = bytes.toString('utf8');
  return (text.startsWith(BOM) ? text.slice(BOM.length) : text).replace(/\r\n/g, '\n');
}

/**
 * A `.puml` file as the engine includes it: without the {@link MARKERS}
 * lines. Stored as one string; the worker splits it into lines on demand,
 * which is the shape the engine requires.
 */
function readPuml(full, blobs, sources) {
  return readSource(full, blobs, sources)
    .split('\n')
    .filter((line) => !MARKERS.has(line.trim()))
    .join('\n');
}

/** The key the engine looks a file up by: its path in the library, lower-cased and without the extension. */
function keyOf(full, base, extension) {
  return relative(base, full).split(sep).join(posix.sep).slice(0, -extension.length).toLowerCase();
}

function collect(dir, base, blobs, entries, json, sources) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        collect(full, base, blobs, entries, json, sources);
      }
    } else if (entry.name.endsWith('.puml')) {
      const key = keyOf(full, base, '.puml');
      if (key in entries) {
        throw new Error(`Duplicate include key after lower-casing: ${key}`);
      }
      entries[key] = readPuml(full, blobs, sources);
    } else if (entry.name.endsWith('.json')) {
      const key = keyOf(full, base, '.json');
      if (key in json) {
        throw new Error(`Duplicate JSON key after lower-casing: ${key}`);
      }
      json[key] = JSON.parse(readSource(full, blobs, sources));
    }
  }
}

mkdirSync(outDir, { recursive: true });

console.log(`Fetching ${LIBRARIES.map((l) => l.name).join(', ')} from plantuml-stdlib at ${COMMIT}...`);
fetchLibraries(LIBRARIES.map((l) => l.directory));

const record = { source: SOURCE, commit: COMMIT, libraries: {} };

for (const library of LIBRARIES) {
  /** @type {Record<string, string>} */
  const entries = {};
  /** @type {Record<string, unknown>} */
  const json = {};
  /** @type {Record<string, string>} */
  const sources = {};
  const base = join(tempDir, 'stdlib', library.directory);
  const blobs = committedBlobs(library.directory);
  if (library.files === undefined) {
    collect(base, base, blobs, entries, json, sources);
  } else {
    for (const name of library.files) {
      entries[name.toLowerCase()] = readPuml(join(base, `${name}.puml`), blobs, sources);
    }
  }

  const count = Object.keys(entries).length;
  if (count === 0) {
    throw new Error(`No .puml files found for ${library.name}`);
  }
  const jsonCount = Object.keys(json).length;

  const out = join(outDir, `${library.name}.json`);
  const asset = JSON.stringify({
    library: library.name,
    upstream: library.upstream,
    license: library.license,
    entries,
    // Only a library that has JSON files gets the field.
    ...(jsonCount > 0 ? { json } : {}),
  });
  writeFileSync(out, asset);
  record.libraries[library.name] = {
    upstream: library.upstream,
    license: library.license,
    asset: { path: relative(root, out).split(sep).join(posix.sep), sha256: sha256(Buffer.from(asset, 'utf8')) },
    files: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  console.log(
    `  ${library.name.padEnd(6)} ${String(count).padStart(4)} files` +
      `${jsonCount > 0 ? ` + ${String(jsonCount)} JSON` : ''} -> ${relative(root, out)} ` +
      `(${(statSync(out).size / 1024).toFixed(0)} KB)`
  );
}

writeFileSync(sourcesFile, `${JSON.stringify(record, null, 2)}\n`);
console.log(`  sources        -> ${relative(root, sourcesFile)}`);

rmSync(tempDir, { recursive: true, force: true });
console.log('Done. Commit the regenerated JSON.');
