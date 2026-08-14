import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const engineDir = join(outDir, 'engine');
const stdlibDir = join(outDir, 'stdlib');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * The rendering engine is not bundled; it is copied verbatim into
 * dist/engine/. plantuml.js is a 7 MB ES module imported at runtime, and
 * viz-global.js is UMD — because @plantuml/core declares "type": "module",
 * it must be renamed to .cjs so Node parses it as CommonJS.
 */
function copyEngine() {
  mkdirSync(engineDir, { recursive: true });

  const files = [
    ['@plantuml/core/plantuml.js', 'plantuml.js'],
    ['@plantuml/core/viz-global.js', 'viz-global.cjs'],
  ];

  for (const [specifier, name] of files) {
    const from = require.resolve(specifier);
    const to = join(engineDir, name);
    // 8.5 MB combined — skip the copy when the size already matches.
    if (statSync(to, { throwIfNoEntry: false })?.size !== statSync(from).size) {
      copyFileSync(from, to);
    }
  }

  // Mark plantuml.js as ESM so Node loads it directly instead of trying
  // CommonJS first and reparsing (which logs MODULE_TYPELESS_PACKAGE_JSON).
  // viz-global.cjs is unaffected: the .cjs extension always wins.
  writeFileSync(join(engineDir, 'package.json'), '{ "type": "module" }\n');
}

/**
 * The bundled PlantUML standard library (assets/stdlib/*.json) is data,
 * not code: the worker reads it at runtime, so it is copied rather than
 * bundled. Regenerate it with `npm run generate:stdlib`.
 */
function copyStdlib() {
  mkdirSync(stdlibDir, { recursive: true });

  const from = join(root, 'assets', 'stdlib');
  for (const name of readdirSync(from).filter((f) => f.endsWith('.json'))) {
    const source = join(from, name);
    const target = join(stdlibDir, name);
    if (statSync(target, { throwIfNoEntry: false })?.size !== statSync(source).size) {
      copyFileSync(source, target);
    }
  }
}

/**
 * happy-dom ships a self-signed TLS certificate (including its private
 * key) for emulating HTTPS fetches. This extension never fetches
 * anything, but bundling the key trips vsce's secret scanner and ships
 * dead weight. Resolve that one module to an empty stub instead.
 */
const happyDomCertStub = {
  name: 'happy-dom-cert-stub',
  setup(build) {
    build.onResolve({ filter: /[/\\]FetchHTTPSCertificate(\.js)?$/ }, () => ({
      path: 'happy-dom-cert-stub',
      namespace: 'happy-dom-cert-stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'happy-dom-cert-stub' }, () => ({
      contents: 'export default { cert: "", key: "" };',
      loader: 'js',
    }));
  },
};

/** @type {esbuild.BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  // vscode is provided by the extension host at runtime.
  external: ['vscode'],
  plugins: [happyDomCertStub],
  logLevel: 'info',
};

copyEngine();
copyStdlib();

const builds = [
  { ...shared, entryPoints: [join(root, 'src/extension.ts')], outfile: join(outDir, 'extension.js') },
  { ...shared, entryPoints: [join(root, 'src/worker/index.ts')], outfile: join(outDir, 'worker.js') },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
  console.log('Watching for changes...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
