/**
 * VSIX verification.
 *
 * Extracts the packaged VSIX and checks six things:
 *
 * 1. Everything the extension needs at runtime is present
 *    (bundles, engine files, stylesheet, l10n, manifest assets).
 * 2. Nothing else is present: every file is one of those, a licence text
 *    of 3, or one of the two files vsce writes itself — no source, test,
 *    source map, README image or anything else from the repository.
 * 3. Third-party licence notices ship with the bundled code — the MIT and
 *    EPL licences of what we bundle require it.
 * 4. The bundles and the engine are no more than 5% over their recorded
 *    sizes (RECORDED_SIZES).
 * 5. The standard libraries, and what their files declare, are the ones
 *    generated from the pinned commit that assets/stdlib-sources.json
 *    records, which the notices name.
 * 6. The packaged worker actually renders — a Japanese sequence diagram
 *    is rendered from the extracted VSIX, which proves the engine files
 *    and the worker bundle fit together without Java or network access;
 *    so are an Azure sprite, a C4 diagram, a `!theme` and an OpenIconic
 *    icon, whose data ships beside the engine.
 *
 * Usage: node scripts/verify-vsix.mjs [path-to.vsix]
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const extractDir = join(projectRoot, '.vsix-verify-temp');

const REQUIRED = [
  'extension/package.json',
  'extension/package.nls.json',
  'extension/package.nls.ja.json',
  'extension/readme.md',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/THIRD_PARTY_NOTICES.md',
  'extension/dist/extension.js',
  'extension/dist/worker.js',
  'extension/dist/engine/plantuml.js',
  'extension/dist/engine/viz-global.cjs',
  'extension/dist/engine/themes.cjs',
  'extension/dist/engine/openiconic.cjs',
  'extension/dist/engine/style-names.json',
  'extension/dist/engine/package.json',
  'extension/language-configuration.json',
  'extension/dist/syntaxes/plantuml.tmLanguage.json',
  'extension/dist/syntaxes/markdown-plantuml.tmLanguage.json',
  'extension/dist/syntaxes/markdown-plantuml-fallback.tmLanguage.json',
  'extension/dist/syntaxes/plantuml-data.tmLanguage.json',
  'extension/dist/syntaxes/plantuml-json.tmLanguage.json',
  'extension/dist/stdlib/azure.json',
  'extension/dist/stdlib/c4.json',
  'extension/dist/declarations/azure.json',
  'extension/dist/declarations/c4.json',
  'extension/media/plantuml.css',
  'extension/media/viewer/viewer.js',
  'extension/media/viewer/zoom.js',
  'extension/media/viewer/viewer.css',
  'extension/media/png/png.js',
  'extension/l10n/bundle.l10n.ja.json',
  'extension/images/icon.png',
];

/** What vsce writes beside extension/, whatever the package holds. */
const PACKAGING = ['extension.vsixmanifest', '[Content_Types].xml'];

/**
 * What the bundles and the engine weighed when last recorded. Every user
 * downloads and loads all of it, and a dependency update can grow it
 * without anyone deciding to, so a file more than 5% over its recorded
 * size fails (check 4). When the growth is meant, record the new size in
 * the same pull request.
 */
const RECORDED_SIZES = {
  'extension/dist/extension.js': 502_347,
  'extension/dist/worker.js': 893_714,
  'extension/dist/engine/plantuml.js': 3_359_666,
  'extension/dist/engine/viz-global.cjs': 1_445_436,
  'extension/dist/engine/themes.cjs': 316_864,
  'extension/dist/engine/openiconic.cjs': 51_251,
};

/** The licence texts in third-party/, each of which ships (check 3). */
function licenceTexts() {
  return readdirSync(join(projectRoot, 'third-party')).filter((f) => f.endsWith('.txt'));
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`✓ ${message}`);
}

function findVsix() {
  const fromArg = process.argv[2];
  if (fromArg !== undefined) {
    return resolve(fromArg);
  }
  const files = readdirSync(projectRoot).filter((f) => f.endsWith('.vsix'));
  if (files.length === 0) {
    throw new Error('No .vsix found. Run `npm run package` first.');
  }
  return join(projectRoot, files[0]);
}

function extract(vsixPath) {
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  // A VSIX is a zip archive. On Windows use the System32 bsdtar by
  // absolute path (a GNU tar earlier in PATH — e.g. from Git Bash —
  // cannot read zip), on POSIX use unzip (GNU tar cannot read zip
  // either). Relative paths avoid bsdtar misparsing `C:\…` as a remote.
  const localCopy = join(extractDir, 'package.vsix.zip');
  copyFileSync(vsixPath, localCopy);
  // Spawned with an argv array rather than a shell string, so the archiver's path
  // is an argument instead of a word to be parsed. `SystemRoot` is a trusted value
  // — anyone who can set it can already run anything — but as argv there is no
  // quoting to get right and no shell to get it wrong.
  const [command, args] =
    process.platform === 'win32'
      ? [
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'),
          ['-xf', 'package.vsix.zip'],
        ]
      : ['unzip', ['-q', 'package.vsix.zip']];
  execFileSync(command, args, { cwd: extractDir, stdio: 'inherit' });
  rmSync(localCopy);
}

function checkFiles() {
  for (const file of REQUIRED) {
    if (existsSync(join(extractDir, file))) {
      ok(`present: ${file}`);
    } else {
      fail(`missing: ${file}`);
    }
  }
  const expected = new Set([
    ...REQUIRED,
    ...PACKAGING,
    ...licenceTexts().map((f) => `extension/third-party/${f}`),
  ]);
  const shipped = readdirSync(extractDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(extractDir, join(entry.parentPath, entry.name)).split(sep).join('/'));
  const extra = shipped.filter((file) => !expected.has(file));
  for (const file of extra) {
    fail(`must not ship: ${file}`);
  }
  if (extra.length === 0) {
    ok(`nothing else: ${shipped.length} files, all listed`);
  }
}

/**
 * Every licence text in third-party/ must reach the VSIX, and
 * THIRD_PARTY_NOTICES.md must reference it. Adding a bundled dependency
 * without its notice fails the build here rather than after publishing.
 */
function checkThirdPartyNotices() {
  const licences = licenceTexts();

  if (licences.length === 0) {
    fail('third-party/ contains no licence texts');
    return;
  }

  const notices = readFileSync(join(extractDir, 'extension/THIRD_PARTY_NOTICES.md'), 'utf8');

  for (const file of licences) {
    if (!existsSync(join(extractDir, 'extension/third-party', file))) {
      fail(`missing from VSIX: third-party/${file}`);
    } else if (!notices.includes(file)) {
      fail(`THIRD_PARTY_NOTICES.md does not reference third-party/${file}`);
    }
  }
  ok(`third-party licence texts ship and are referenced (${String(licences.length)} files)`);
}

/**
 * Each standard library in the VSIX is the asset generated from the pinned
 * commit, and so is what its files declare: each has the hash
 * assets/stdlib-sources.json records for it, and every library recorded
 * ships. The record stays in the repository; the packaged notices name the
 * commit.
 */
function checkStdlibProvenance() {
  const record = JSON.parse(readFileSync(join(projectRoot, 'assets/stdlib-sources.json'), 'utf8'));
  for (const [folder, field] of [
    ['stdlib', 'asset'],
    ['declarations', 'declarations'],
  ]) {
    const shippedDir = join(extractDir, 'extension/dist', folder);
    const recorded = Object.keys(record.libraries).map((name) => `${name}.json`);
    const shipped = existsSync(shippedDir) ? readdirSync(shippedDir) : [];
    for (const file of shipped.filter((name) => !recorded.includes(name))) {
      fail(`dist/${folder}/${file} is not recorded in assets/stdlib-sources.json`);
    }
    for (const [name, library] of Object.entries(record.libraries)) {
      const path = join(shippedDir, `${name}.json`);
      if (!existsSync(path)) {
        continue; // reported by checkFiles
      }
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
      const expected = library[field].sha256;
      if (hash === expected) {
        ok(`${folder}: ${name}.json is the one generated from ${record.commit}`);
      } else {
        fail(`dist/${folder}/${name}.json has sha256 ${hash}, not the ${expected} generated from ${record.commit}`);
      }
    }
  }
  const notices = readFileSync(join(extractDir, 'extension/THIRD_PARTY_NOTICES.md'), 'utf8');
  if (notices.includes(record.commit)) {
    ok('THIRD_PARTY_NOTICES.md names the commit the libraries are generated from');
  } else {
    fail(`THIRD_PARTY_NOTICES.md does not name ${record.commit}, the commit the libraries are generated from`);
  }
}

function checkSizes() {
  for (const [file, recorded] of Object.entries(RECORDED_SIZES)) {
    const size = statSync(join(extractDir, file), { throwIfNoEntry: false })?.size;
    if (size === undefined) {
      continue; // reported by checkFiles
    }
    const change = `${size > recorded ? '+' : ''}${(((size - recorded) / recorded) * 100).toFixed(1)}%`;
    if (size > recorded * 1.05) {
      fail(`${file} is ${String(size)} bytes, ${change} over the ${String(recorded)} recorded`);
    } else {
      ok(`size: ${file} ${String(size)} bytes (${change} against the ${String(recorded)} recorded)`);
    }
  }
}

/**
 * The Marketplace rejects an extension whose README or CHANGELOG renders
 * an SVG image, unless it comes from one of its trusted badge providers.
 * The rejection is asynchronous — `vsce publish` reports success and the
 * version silently never appears — so it has to be caught here.
 *
 * vsce makes this easy to do by accident: it rewrites relative Markdown
 * links with a regex over the raw file, so an example inside a fenced
 * code block, or even in backticks, becomes a real `<img>` in the
 * package. What matters is the packaged text, which is what this reads.
 */
function checkNoOwnSvgImages() {
  const files = ['extension/readme.md', 'extension/changelog.md'];
  let found = false;

  for (const file of files) {
    const path = join(extractDir, file);
    if (!existsSync(path)) {
      continue;
    }
    for (const [, alt, target] of readFileSync(path, 'utf8').matchAll(
      /!\[([^\]]*)\]\(([^)\s]+)/g
    )) {
      // Badges are the exception the Marketplace allows; ours all live on
      // hosts whose path says badge. Anything pointing back at this
      // repository's own files is not one.
      const isOwnContent = /\/raw\//.test(target) || !/^\w+:\/\//.test(target);
      if (isOwnContent && /\.svg(\?|#|$)/i.test(target)) {
        fail(`${file} renders an SVG image the Marketplace will reject: ![${alt}](${target})`);
        found = true;
      }
    }
  }
  if (!found) {
    ok('no repository-hosted SVG images in the packaged README or CHANGELOG');
  }
}

function checkNoSecrets() {
  const worker = readFileSync(join(extractDir, 'extension/dist/worker.js'), 'utf8');
  if (worker.includes('BEGIN PRIVATE KEY') || worker.includes('BEGIN CERTIFICATE')) {
    fail('worker.js still contains certificate material (happy-dom stub not applied)');
  } else {
    ok('no certificate material in worker.js');
  }
}

function checkNoExternalRenderers() {
  const worker = readFileSync(join(extractDir, 'extension/dist/worker.js'), 'utf8');
  const extension = readFileSync(join(extractDir, 'extension/dist/extension.js'), 'utf8');
  const pattern = /https?:\/\/[^"'`\s]*(plantuml\.com\/plantuml|kroki\.io)/i;
  if (pattern.test(worker) || pattern.test(extension)) {
    fail('bundle references an external rendering service');
  } else {
    ok('no external rendering service URLs in bundles');
  }
}

function renderOn(worker, id, source) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      rejectPromise(new Error('render timed out after 60s'));
    }, 60_000);
    const onMessage = (message) => {
      if (message.id !== id) {
        return;
      }
      clearTimeout(timer);
      worker.off('message', onMessage);
      if (message.error !== undefined) {
        rejectPromise(new Error(message.error));
      } else {
        resolvePromise(message.svg);
      }
    };
    worker.on('message', onMessage);
    worker.postMessage({ id, source, dark: false });
  });
}

async function renderSmoke() {
  const workerPath = join(extractDir, 'extension/dist/worker.js');
  const worker = new Worker(workerPath);
  worker.once('error', (error) => {
    fail(`packaged worker crashed: ${error.message}`);
  });

  try {
    // CJK fixture text: proves full-width metrics and UTF-8 survive packaging.
    const svg = await renderOn(worker, 1, '@startuml\nactor "利用者" as U\nU -> B : 追加\n@enduml');
    if (typeof svg === 'string' && svg.includes('<svg') && svg.includes('利用者')) {
      ok(`packaged worker renders (SVG ${String(svg.length)} bytes, CJK intact)`);
    } else {
      fail('packaged worker returned unexpected output');
    }

    // Proves dist/stdlib/ resolves relative to the packaged worker and that a
    // sprite survives rasterisation and sanitisation with its pixels intact.
    const sprite = await renderOn(
      worker,
      2,
      '@startuml\n!include <azure/AzureCommon>\n!include <azure/Compute/AzureFunction>\n' +
        'AzureFunction(fn, "check", "Functions")\n@enduml'
    );
    if (typeof sprite === 'string' && /<image[^>]*href="data:image\/png;base64,iVBORw0KGg/.test(sprite)) {
      ok('packaged worker resolves <azure/…> and embeds the sprite PNG');
    } else {
      fail('packaged worker did not render the bundled Azure sprite');
    }

    // Proves <C4/…> resolves too, with the common definitions it includes
    // (C4_Container includes C4_Context, which includes C4).
    const c4 = await renderOn(
      worker,
      6,
      '@startuml\n!include <C4/C4_Container>\nPerson(user, "Customer")\n' +
        'Container(web, "Storefront", "TypeScript")\nRel(user, web, "Uses")\n@enduml'
    );
    if (typeof c4 === 'string' && !/cannot include/.test(c4) && c4.includes('Storefront') && c4.includes('«container»')) {
      ok('packaged worker resolves <C4/…> and draws a C4 container');
    } else {
      fail('packaged worker did not render the bundled C4 library');
    }

    // Proves the !theme library and the OpenIconic icons load from the
    // packaged engine folder: a theme brings colours of its own, an icon
    // draws a path. The engine's own error text would bring colours too.
    const fills = (text) => new Set([...text.matchAll(/fill="(#[0-9A-Fa-f]{3,8})"/g)].map((m) => m[1]));
    const plain = await renderOn(worker, 3, '@startuml\nAlice -> Bob : done\n@enduml');
    const themed = await renderOn(worker, 4, '@startuml\n!theme cerulean\nAlice -> Bob : done\n@enduml');
    const plainFills = fills(plain);
    if (!/Cannot load theme/.test(themed) && [...fills(themed)].some((f) => !plainFills.has(f))) {
      ok('packaged worker applies a !theme from the bundled library');
    } else {
      fail('packaged worker did not apply !theme cerulean');
    }
    const icon = await renderOn(worker, 5, '@startuml\nAlice -> Bob : <&check> done\n@enduml');
    if (icon.split('<path').length > plain.split('<path').length) {
      ok('packaged worker draws an OpenIconic icon');
    } else {
      fail('packaged worker did not draw <&check>');
    }
  } catch (error) {
    fail(`packaged worker failed to render: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await worker.terminate();
  }
}

const vsixPath = findVsix();
console.log(`Verifying ${vsixPath}`);
extract(vsixPath);
checkFiles();
checkThirdPartyNotices();
checkStdlibProvenance();
checkSizes();
checkNoOwnSvgImages();
checkNoSecrets();
checkNoExternalRenderers();
await renderSmoke();
rmSync(extractDir, { recursive: true, force: true });

if (process.exitCode === 1) {
  console.error('\nVSIX verification FAILED');
} else {
  console.log('\nVSIX verification passed');
}
