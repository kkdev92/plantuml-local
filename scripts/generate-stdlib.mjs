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
 * fetched, using a blobless sparse checkout.
 *
 * The engine reads libraries from `window.PLANTUML_STDLIB[library][key]`
 * where `key` is the include path, lower-cased and without the `.puml`
 * extension (`<azure/Compute/AzureFunction>` -> `compute/azurefunction`).
 * See src/worker/stdlib.ts for the runtime side.
 *
 * Usage: node scripts/generate-stdlib.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'stdlib');
const tempDir = join(root, '.stdlib-temp');

const SOURCE = 'https://github.com/plantuml/plantuml-stdlib.git';

/**
 * Libraries to bundle, with the upstream each is generated from — that is
 * where the licence comes from, and what THIRD_PARTY_NOTICES.md credits.
 *
 * The other cloud icon sets are deliberately absent. Both `awslib20` and
 * `gcp` state in their READMEs that "the icons provided in this package
 * are made available to you under the terms of the CC-BY-ND 2.0 license"
 * with only the macros under MIT, and this extension ships nothing but
 * MIT / BSD / EPL. Azure-PlantUML has no such split — it is MIT
 * throughout. `awslib20` would also add roughly 4 MB to a 2.4 MB package.
 *
 * Diagrams can still use those icons by pasting the sprite definitions
 * into the source, which renders the same way.
 */
const LIBRARIES = [
  {
    name: 'azure',
    upstream: 'plantuml-stdlib/Azure-PlantUML',
    license: 'MIT',
  },
];

/** Directories of demo diagrams; they pull in libraries we do not bundle. */
const SKIP_DIRECTORIES = new Set(['_examples_']);

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

function fetchLibraries(names) {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  // Blobless + sparse: the full repository is hundreds of megabytes, and
  // the libraries we want are a fraction of one percent of it.
  git(['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', SOURCE, tempDir]);
  git(['sparse-checkout', 'init', '--cone'], tempDir);
  git(['sparse-checkout', 'set', ...names.map((n) => `stdlib/${n}`)], tempDir);
  git(['checkout'], tempDir);
}

function collect(dir, base, entries) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        collect(full, base, entries);
      }
    } else if (entry.name.endsWith('.puml')) {
      const key = relative(base, full).split(sep).join(posix.sep).replace(/\.puml$/i, '').toLowerCase();
      if (key in entries) {
        throw new Error(`Duplicate include key after lower-casing: ${key}`);
      }
      // Stored as one string; the worker splits it into lines on demand,
      // which is the shape the engine requires.
      entries[key] = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
    }
  }
}

mkdirSync(outDir, { recursive: true });

console.log(`Fetching ${LIBRARIES.map((l) => l.name).join(', ')} from plantuml-stdlib...`);
fetchLibraries(LIBRARIES.map((l) => l.name));

for (const library of LIBRARIES) {
  /** @type {Record<string, string>} */
  const entries = {};
  const base = join(tempDir, 'stdlib', library.name);
  collect(base, base, entries);

  const count = Object.keys(entries).length;
  if (count === 0) {
    throw new Error(`No .puml files found for ${library.name}`);
  }

  const out = join(outDir, `${library.name}.json`);
  writeFileSync(
    out,
    JSON.stringify({ library: library.name, upstream: library.upstream, license: library.license, entries })
  );
  console.log(
    `  ${library.name.padEnd(6)} ${String(count).padStart(4)} files -> ${relative(root, out)} ` +
      `(${(statSync(out).size / 1024).toFixed(0)} KB)`
  );
}

rmSync(tempDir, { recursive: true, force: true });
console.log('Done. Commit the regenerated JSON.');
