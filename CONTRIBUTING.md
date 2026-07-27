# Contributing to PlantUML Local

Thanks for taking the time to contribute! This document covers the development setup, project layout and expectations for changes.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## Getting Started

### Prerequisites

- Node.js ≥ 20
- VS Code ≥ 1.96
- No Java, no Graphviz, no Docker — the whole point of this project.

### Development Setup

```bash
git clone https://github.com/kkdev92/plantuml-local
cd plantuml-local
npm install
npm run bundle
```

Open the folder in VS Code and press `F5`. An Extension Development Host starts with `sample.md` open; hit `Ctrl+Shift+V` to see the preview. `npm run bundle:watch` rebuilds on save.

## Project Structure

```text
src/
├── core/            constants and shared types (message protocol, log surface)
├── preview/         markdown-it plugin: fence dispatch + cache-and-refresh cycle
│                    (dependency-injected, no `vscode` import — unit-testable)
├── render/          extension-host side of the worker (request/response, restart)
├── worker/          render worker: DOM shims, engine loading, serial queue,
│                    SVG sanitiser, approximate text metrics
└── extension.ts     wiring only: vscode + @kkdev92/vscode-ext-kit + the above
scripts/
├── build.mjs        esbuild bundling + engine copy + happy-dom cert stub
└── verify-vsix.mjs  VSIX content check + packaged-worker render smoke test
test/
├── unit/            vitest against src/ (no build needed)
└── integration/     vitest against dist/ (real engine, stubbed `vscode`)
```

Two architectural constraints worth knowing before you change things:

1. **Rendering cannot move into the preview webview.** Its CSP has no
   `wasm-unsafe-eval`, and Graphviz is WASM. That is why the worker exists.
2. **Renders must stay serialised.** The engine keeps shared internal state;
   parallel renders overwrite each other (documented upstream). Everything
   goes through `src/worker/queue.ts`.

## Development Workflow

```bash
npm run lint          # eslint (type-checked rules)
npm run typecheck     # tsc --noEmit
npm run test:unit     # fast, no build required
npm test              # bundle + unit + integration (renders real diagrams)
npm run package       # build the VSIX
npm run verify:vsix   # unpack the VSIX and render from the packaged worker
```

All of these must pass before a PR is merged; CI runs the same steps on Linux, macOS and Windows.

### Making Changes

- Keep `src/preview/plugin.ts` free of `vscode` imports — everything host-specific arrives through its `PluginDeps`. This is what keeps the render cycle unit-testable.
- User-facing strings go through `vscode.l10n` (`t()` from the kit) with English defaults; add Japanese to `l10n/bundle.l10n.ja.json` and manifest strings to `package.nls*.json`.
- New behaviour needs a test. Pure logic → `test/unit/`; anything that depends on the real engine or the built bundles → `test/integration/`.

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

### Pull Requests

- One logical change per PR.
- Describe what changed and why; link related issues.
- Update README / CHANGELOG when behaviour changes.

## Reporting Issues

Use the issue templates. For rendering problems, include the smallest PlantUML source that reproduces the issue and the output of *Output → PlantUML Local* at `logLevel: debug`.

For security reports, **do not open a public issue** — see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
