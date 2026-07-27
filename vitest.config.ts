import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Fast tests against src/ modules. No build step required.
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        // Tests that exercise the built dist/ bundles: the worker renders
        // real diagrams (WASM Graphviz included) and the extension bundle
        // is loaded with a stubbed `vscode` module. Run `npm run bundle`
        // first — the npm script does this automatically.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        // Thin wiring over vscode + kit; exercised by the integration
        // tests against the built bundle instead.
        'src/extension.ts',
        // Worker entry and engine loading need the real 8.5 MB engine;
        // covered by test/integration/worker.test.ts.
        'src/worker/index.ts',
        'src/worker/engine.ts',
        'src/render/client.ts',
        'src/core/types.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 90,
        statements: 90,
      },
    },
  },
});
