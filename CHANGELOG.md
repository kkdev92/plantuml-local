# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Sprites render.** PlantUML rasterises `sprite` definitions through a Canvas
  2D context, which Node does not have, so any diagram using one previously
  failed with `TypeError: f.createImageData is not a function`. The worker now
  provides a software raster canvas and encodes the result as a PNG using the
  built-in `zlib` — no native dependency.
- **The Azure icon set is bundled.** `!include <azure/AzureCommon>` and the rest
  of [Azure-PlantUML](https://github.com/plantuml-stdlib/Azure-PlantUML) resolve
  from a copy inside the VSIX, so existing Azure diagrams render unchanged and
  still without any network access. Other libraries report that they are
  unavailable rather than being fetched.

### Changed

- **The extension icon is 43 KB instead of 1.35 MB.** It was a 1024×1024 PNG,
  the second-largest file in the VSIX and far larger than anything that renders
  it, whose artwork filled only 61% × 41% of its canvas. Now 256×256 and cropped
  to the artwork. The package drops from 3.77 MB to 2.41 MB even with the Azure
  library added.
- The preview cache is now bounded by total size (16 MB) as well as entry count.
  200 entries was a poor memory bound once sprites existed: a plain diagram is a
  few KB while an icon-heavy one is 100-150 KB.
- The render worker shuts down after five minutes idle and restarts on the next
  render. It holds the engine, the Graphviz WebAssembly and any sprite library a
  diagram pulled in — around 280 MB after heavy icon use, of which about 90 MB
  comes back on shutdown — none of it useful to someone who has moved on.
- The SVG sanitiser now permits an inline `data:image/png` on `<image>` — the
  form a rasterised sprite arrives in — provided it is base64 with no other
  characters and begins with the PNG signature. `<a href>`, `src`,
  `data:text/html`, `data:image/svg+xml` and `javascript:` stay blocked. See
  [SECURITY.md](SECURITY.md) for the reasoning.
- The canvas context is created per canvas element rather than shared, so one
  sprite's pixels can no longer overwrite another's.

## [0.4.0] - 2026-08-08

Rebuilt on `@kkdev92/vscode-ext-kit` 3.x. Rendering, sanitisation, the worker
queue and the markdown-it plugin are untouched — what changed is how the
extension starts and stops. Diagrams render exactly as they did.

### Breaking

- **VS Code 1.125 or later is now required**, up from 1.101. The framework's
  minimum cascades here. Installations on older versions keep 0.3.0 and stop
  receiving updates.
- **`plantumlLocal.logLevel` is a floor, not the only filter.** The output
  channel is a `LogOutputChannel` now, and VS Code decides what one of those
  shows — an extension cannot raise its own channel's level. The setting can
  still make the log quieter. To see `debug`, run _Developer: Set Log Level_ and
  pick **PlantUML Local**; that is a per-channel level and it persists across
  restarts. In exchange the channel gains per-level colouring and the panel's
  own filter.
- **The output channel is named "PlantUML Local"** — unchanged in text, but it
  is a log channel rather than a plain one, so it appears with the log channels
  in the Output dropdown.

### Changed

- Activation is one declaration, validated before VS Code is touched: a
  duplicate id or a missing dependency now fails at import rather than
  half-registering at runtime. The render worker and the debounced preview
  refresh are owned by the framework and released on its single cleanup path,
  in reverse order, within a shutdown budget.
- `extendMarkdownIt` is declared rather than assembled by hand. `activate` is
  asynchronous as a result — VS Code awaits it before reading the contribution,
  which is what `markdown-language-features` has always done.

## [0.3.0] - 2026-07-31

### Changed

- **The minimum supported VS Code version is now 1.101** (from 1.96). VS Code
  1.101 is the first release whose extension host runs Node 22 — it moved to
  Electron 35, which bundles Node 22.15, while 1.96 through 1.100 shipped
  Node 20. `engines.node` has declared `>=22.0.0` since 0.2.0, so until now
  that requirement was not actually satisfied by the oldest supported host.
  The bundle target moves from `node20` to `node22` accordingly.

  VS Code 1.101 was released in June 2025. Installations older than that keep
  working on 0.2.1; they simply stop receiving updates.

## [0.2.1] - 2026-07-31

### Added

- `THIRD_PARTY_NOTICES.md` and `third-party/`, collecting the copyright and
  licence texts of every component bundled in the VSIX (PlantUML, Viz.js,
  Graphviz, Expat, happy-dom and its dependencies, and the extension kit).
  `verify-vsix` now fails the build if a licence text is missing from the
  package or unreferenced by the notices file.

### Changed

- Documentation only: README and `SECURITY.md` now describe the local-rendering
  and network behaviour as design and implementation rather than as absolute
  guarantees, add a `Known Limitations` section, and state explicitly that the
  render worker is an isolation boundary rather than a security sandbox. No
  behaviour changes.
- `SECURITY.md` supported-versions table now tracks the latest release instead
  of naming `0.1.x`.
- Development now uses TypeScript 6.0 (from 5.9). Build tooling only — esbuild
  does the transpiling, so the shipped bundles are unaffected.

## [0.2.0] - 2026-07-28

### Changed

- Migrated to `@kkdev92/vscode-ext-kit` 1.1.0 (from 0.4.0), which is a
  ground-up redesign and not backwards compatible with 0.x.
  - The output channel is now a native `LogOutputChannel`: timestamps, level
    colours, the Output panel's level dropdown and
    `Developer: Set Log Level` all work. **`plantumlLocal.logLevel` is now
    applied on top of the panel's own level selector** — raising the setting
    alone no longer guarantees that `trace`/`debug` lines are visible.
  - Settings are read through a validated schema, so a hand-edited
    `settings.json` falls back to the declared default instead of reaching
    the renderer as an unchecked value.
  - `plantumlLocal.theme` changes are now observed per key rather than by
    filtering whole-configuration events.
- Development now requires Node.js 22 or newer, matching the kit and
  replacing Node 20 (end of life 2026-04-30). The shipped bundle still
  targets the Node 20 runtime of the VS Code 1.96 extension host, so the
  supported VS Code range is unchanged.

## [0.1.0] - 2026-07-27

First public release.

### Added

- Render ```` ```plantuml ```` fenced code blocks as inline SVG in the built-in
  Markdown preview, powered by [`@plantuml/core`](https://www.npmjs.com/package/@plantuml/core)
  (PlantUML compiled to JavaScript/WebAssembly). No Java, no PlantUML server,
  no network access.
- Rendering runs in a worker thread on the extension host; only sanitised SVG
  is injected into the preview.
- Serialised rendering queue — many diagrams per page render correctly, and one
  failing diagram never blocks the others.
- Syntax errors appear inline at the failing diagram; the rest of the page is
  unaffected.
- Dark-mode rendering that follows the VS Code colour theme, with a
  `plantumlLocal.theme` setting (`auto` / `light` / `dark`) to pin the palette.
- `PlantUML Local: Clear Render Cache and Re-render` command.
- `plantumlLocal.logLevel` setting for the output channel.
- Localised UI (English, Japanese).

### Security

- SVG output is sanitised in the worker (scripts, event handlers and non-fragment
  links are removed) before it reaches the preview.
- URL-based `!include` / `!theme` directives are rejected with an inline message.
- happy-dom's bundled self-signed TLS certificate (unused fetch machinery) is
  stripped from the worker bundle at build time.

[Unreleased]: https://github.com/kkdev92/plantuml-local/compare/v0.3.0...HEAD
[0.4.0]: https://github.com/kkdev92/plantuml-local/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kkdev92/plantuml-local/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kkdev92/plantuml-local/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kkdev92/plantuml-local/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kkdev92/plantuml-local/releases/tag/v0.1.0
