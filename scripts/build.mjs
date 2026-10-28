import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import * as esbuild from 'esbuild';
import { noticesProblems } from './notices.mjs';

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

  // Copied rather than bundled, so checkLicences does not see these.
  const core = dirname(require.resolve('@plantuml/core/package.json'));
  for (const name of readdirSync(engineDir)) {
    const problem = licenceProblem(core, join(engineDir, name));
    if (problem !== undefined) {
      throw new Error(`${problem}, a licence this extension does not ship`);
    }
  }
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
 * happy-dom 20.14.6 and later carry the Public Suffix List, about 170 KB
 * of data, under a licence this extension does not ship (MPL-2.0). Only
 * its cookie code reads the list, and only for a cookie that names a
 * Domain; the worker never sets a cookie. Resolve the list to an empty
 * one, and fail the build if anything else starts importing it.
 */
const happyDomPublicSuffixStub = {
  name: 'happy-dom-public-suffix-stub',
  setup(build) {
    build.onResolve({ filter: /[/\\]PublicSuffixList(\.js)?$/ }, (args) => {
      if (!/[/\\]cookie[/\\]urilities[/\\]CookieDomainUtility\.js$/.test(args.importer)) {
        return { errors: [{ text: `Unexpected importer of happy-dom's PublicSuffixList: ${args.importer}` }] };
      }
      return { path: 'happy-dom-public-suffix-stub', namespace: 'happy-dom-public-suffix-stub' };
    });
    build.onLoad({ filter: /.*/, namespace: 'happy-dom-public-suffix-stub' }, () => ({
      contents: 'export default { exact: new Set(), wildcard: new Set(), exception: new Set() };',
      loader: 'js',
    }));
  },
};

/**
 * The licences of what this extension ships, as a package declares them
 * (THIRD_PARTY_NOTICES.md). Graphviz, the EPL-1.0 part, comes inside
 * @plantuml/core, which declares MIT.
 */
const SHIPPED_LICENCES = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause'];

/**
 * A notice of another licence. A package can bring in a file under
 * another licence and still declare its own — happy-dom did, with the
 * Public Suffix List — so what ships is read, not only what is declared.
 * Notices wrap, so the words may be split by line breaks and comment
 * markers.
 */
const OTHER_LICENCE_NOTICE = new RegExp(
  [
    'Mozilla Public License',
    'GNU (Affero |Lesser |Library )?General Public License',
    'Apache License',
    'Creative Commons',
    'Common Development and Distribution License',
    'European Union Public Licence',
    'Server Side Public License',
    'Business Source License',
  ]
    .map((words) => words.replaceAll(' ', String.raw`[\s/*#]+`))
    .concat(String.raw`SPDX-License-Identifier:\s*(?!(${SHIPPED_LICENCES.join('|')})\b)\S+`)
    .join('|'),
  'i'
);

/**
 * Why a file of a package must not ship, or undefined: the package
 * declares a licence this extension does not ship, or the file carries a
 * notice of one.
 */
function licenceProblem(packageDir, file) {
  const { license } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  if (!SHIPPED_LICENCES.includes(license)) {
    return `${packageDir} declares ${JSON.stringify(license)}`;
  }
  const notice = OTHER_LICENCE_NOTICE.exec(readFileSync(file, 'utf8'))?.[0];
  return notice === undefined ? undefined : `${file} carries a notice: ${notice.replace(/[\s/*#]+/g, ' ')}`;
}

/** The folder of the npm package a file of node_modules belongs to. */
const PACKAGE_DIR = /^(?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+/;

/**
 * Fails a bundle that takes code from node_modules under a licence this
 * extension does not ship. A file tree-shaken out entirely does not count.
 */
const checkLicences = {
  name: 'check-licences',
  setup(build) {
    build.onEnd((result) => {
      const problems = new Set();
      for (const { inputs } of Object.values(result.metafile?.outputs ?? {})) {
        for (const [file, { bytesInOutput }] of Object.entries(inputs)) {
          const packageDir = PACKAGE_DIR.exec(file)?.[0];
          const problem = packageDir && bytesInOutput > 0 ? licenceProblem(packageDir, file) : undefined;
          if (problem !== undefined) {
            problems.add(problem);
          }
        }
      }
      return { errors: [...problems].map((problem) => ({ text: `${problem}, a licence this extension does not ship` })) };
    });
  },
};

/**
 * The npm packages that ship, each with the set of its versions that do:
 * those whose code reaches a bundle, counted as checkLicences counts them,
 * and @plantuml/core, whose files copyEngine copies.
 */
function shippedPackages(results) {
  const shipped = new Map();
  const add = (packageDir) => {
    const { name, version } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    shipped.set(name, (shipped.get(name) ?? new Set()).add(version));
  };
  for (const { metafile } of results) {
    for (const { inputs } of Object.values(metafile?.outputs ?? {})) {
      for (const [file, { bytesInOutput }] of Object.entries(inputs)) {
        const packageDir = PACKAGE_DIR.exec(file)?.[0];
        if (packageDir && bytesInOutput > 0) {
          add(packageDir);
        }
      }
    }
  }
  add(dirname(require.resolve('@plantuml/core/package.json')));
  return shipped;
}

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
  plugins: [happyDomCertStub, happyDomPublicSuffixStub, checkLicences],
  // checkLicences reads the inputs that reach each bundle off the metafile.
  metafile: true,
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
  const results = await Promise.all(builds.map((options) => esbuild.build(options)));
  // The notices name every npm package that ships, at the versions that do:
  // a dependency update that changes what ships stops here until they
  // follow. Watch mode rebuilds one bundle at a time and skips this.
  const problems = noticesProblems(readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8'), shippedPackages(results));
  if (problems.length > 0) {
    throw new Error(
      `${problems.join('\n')}\nBring THIRD_PARTY_NOTICES.md and third-party/ along with the dependency (CONTRIBUTING.md, Pull Requests).`
    );
  }
}
