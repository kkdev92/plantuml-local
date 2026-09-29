import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist');
const engineDir = join(outDir, 'engine');
const stdlibDir = join(outDir, 'stdlib');
const syntaxesDir = join(outDir, 'syntaxes');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * The rendering engine is not bundled; it is copied verbatim into
 * dist/engine/. plantuml.js is a 7 MB ES module imported at runtime, and
 * viz-global.js is UMD — because @plantuml/core declares "type": "module",
 * it must be renamed to .cjs so Node parses it as CommonJS. openiconic.js
 * is a classic script that fills a global table (the `<&icon>` set),
 * renamed for the same reason; the `!theme` table is rebuilt by
 * writeThemes(). The package's emoji.js is left out: its images are not
 * under a licence this extension ships.
 */
function copyEngine() {
  mkdirSync(engineDir, { recursive: true });

  const files = [
    ['@plantuml/core/plantuml.js', 'plantuml.js'],
    ['@plantuml/core/viz-global.js', 'viz-global.cjs'],
    ['@plantuml/core/openiconic.js', 'openiconic.cjs'],
  ];

  for (const [specifier, name] of files) {
    const from = require.resolve(specifier);
    const to = join(engineDir, name);
    // Nearly 9 MB combined — skip the copy when the size already matches.
    if (statSync(to, { throwIfNoEntry: false })?.size !== statSync(from).size) {
      copyFileSync(from, to);
    }
  }

  writeThemes(join(engineDir, 'themes.cjs'));

  // Mark plantuml.js as ESM so Node loads it directly instead of trying
  // CommonJS first and reparsing (which logs MODULE_TYPELESS_PACKAGE_JSON).
  // viz-global.cjs is unaffected: the .cjs extension always wins.
  writeFileSync(join(engineDir, 'package.json'), '{ "type": "module" }\n');
}

/** Licences a theme may declare in its header to ship; none means PlantUML's own. */
const THEME_LICENCES = new Set(['', 'MIT']);

/**
 * The `!theme` library, as the package's themes.js without the themes this
 * extension does not ship. Each theme opens with a header that names its
 * licence; themes.js collects them all, and a few declare licences outside
 * the MIT / BSD / EPL this extension ships. Those are left out, and a
 * diagram asking for one gets the engine's "Cannot load theme" error.
 */
function writeThemes(to) {
  const sandbox = {};
  runInNewContext(readFileSync(require.resolve('@plantuml/core/themes.js'), 'utf8'), sandbox);
  const themes = sandbox.PLANTUML_THEMES ?? {};

  const kept = [];
  const dropped = [];
  for (const name of Object.keys(themes).sort()) {
    const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(themes[name])?.[1] ?? '';
    const licence = /^license:[ \t]*(.*)$/m.exec(header)?.[1]?.trim() ?? '';
    (THEME_LICENCES.has(licence) ? kept : dropped).push(name);
  }
  if (kept.length === 0) {
    throw new Error('themes.js: no theme left to ship — has its format changed?');
  }

  const lines = [
    '// The !theme library of @plantuml/core (themes.js), written by scripts/build.mjs.',
    `// Left out, for the licence their header declares: ${dropped.join(', ') || 'none'}.`,
    '(function () {',
    'var g = globalThis;',
    'g.PLANTUML_THEMES = g.PLANTUML_THEMES || {};',
    ...kept.map((name) => `g.PLANTUML_THEMES[${JSON.stringify(name)}] = ${JSON.stringify(themes[name])};`),
    '})();',
    '',
  ];
  writeFileSync(to, lines.join('\n'));
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

/**
 * The syntax highlighting grammars are TypeScript modules (src/grammar/)
 * so that shared pieces are composed rather than copied. VS Code reads
 * JSON: the bundled module is evaluated here and each grammar it exports
 * is written to dist/syntaxes/, where package.json points.
 */
const writeGrammars = {
  name: 'write-grammars',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }
      const code = result.outputFiles[0].text;
      const { grammars } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
      mkdirSync(syntaxesDir, { recursive: true });
      for (const { file, grammar } of grammars) {
        const text = `${JSON.stringify(grammar, null, production ? undefined : 2)}\n`;
        writeFileSync(join(syntaxesDir, file), text);
        console.log(`  dist/syntaxes/${file}  ${(text.length / 1024).toFixed(1)}kb`);
      }
    });
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
  {
    entryPoints: [join(root, 'src/grammar/index.ts')],
    outfile: join(syntaxesDir, 'grammars.mjs'),
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    // Nothing of this bundle is written: the plugin writes the JSON files.
    write: false,
    plugins: [writeGrammars],
    logLevel: 'warning',
  },
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
