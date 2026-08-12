/**
 * VSIX verification.
 *
 * Extracts the packaged VSIX and checks four things:
 *
 * 1. Everything the extension needs at runtime is present
 *    (bundles, engine files, stylesheet, l10n, manifest assets).
 * 2. Nothing that must not ship is present
 *    (sources, tests, node_modules, source maps, private keys).
 * 3. Third-party licence notices ship with the bundled code — the MIT and
 *    EPL licences of what we bundle require it.
 * 4. The packaged worker actually renders — a Japanese sequence diagram
 *    is rendered from the extracted VSIX, which proves the engine files
 *    and the worker bundle fit together without Java or network access.
 *
 * Usage: node scripts/verify-vsix.mjs [path-to.vsix]
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  'extension/dist/engine/package.json',
  'extension/media/plantuml.css',
  'extension/l10n/bundle.l10n.ja.json',
  'extension/images/icon.png',
];

const FORBIDDEN = [
  'extension/src',
  'extension/test',
  'extension/scripts',
  'extension/node_modules',
  'extension/sample.md',
  'extension/dist/extension.js.map',
  'extension/dist/worker.js.map',
];

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
  for (const file of FORBIDDEN) {
    if (existsSync(join(extractDir, file))) {
      fail(`must not ship: ${file}`);
    } else {
      ok(`absent:  ${file}`);
    }
  }
}

/**
 * Every licence text in third-party/ must reach the VSIX, and
 * THIRD_PARTY_NOTICES.md must reference it. Adding a bundled dependency
 * without its notice fails the build here rather than after publishing.
 */
function checkThirdPartyNotices() {
  const sourceDir = join(projectRoot, 'third-party');
  const licences = readdirSync(sourceDir).filter((f) => f.endsWith('.txt'));

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

async function renderSmoke() {
  const workerPath = join(extractDir, 'extension/dist/worker.js');
  const worker = new Worker(workerPath);

  try {
    const svg = await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        rejectPromise(new Error('render timed out after 60s'));
      }, 60_000);
      worker.once('error', (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      });
      worker.once('message', (message) => {
        clearTimeout(timer);
        if (message.error !== undefined) {
          rejectPromise(new Error(message.error));
        } else {
          resolvePromise(message.svg);
        }
      });
      worker.postMessage({
        id: 1,
        // CJK fixture text: proves full-width metrics and UTF-8 survive packaging.
        source: '@startuml\nactor "利用者" as U\nU -> B : 追加\n@enduml',
        dark: false,
      });
    });

    if (typeof svg === 'string' && svg.includes('<svg') && svg.includes('利用者')) {
      ok(`packaged worker renders (SVG ${String(svg.length)} bytes, CJK intact)`);
    } else {
      fail('packaged worker returned unexpected output');
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
checkNoSecrets();
checkNoExternalRenderers();
await renderSmoke();
rmSync(extractDir, { recursive: true, force: true });

if (process.exitCode === 1) {
  console.error('\nVSIX verification FAILED');
} else {
  console.log('\nVSIX verification passed');
}
