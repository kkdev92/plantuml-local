# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.0] - 2026-09-07

**Breaking: VS Code 1.136 or later is now required**, up from 1.134, in step with
`@types/vscode` moving to `~1.136.0`. The two have to move together — `vsce`
refuses to package an extension whose `@types/vscode` outruns its
`engines.vscode`, and raising only the types would let code compile against an
API the declared floor does not have.

The floor is inherited: `@kkdev92/vscode-ext-kit` 5.0.0 raised its own
`engines.vscode` to `^1.136.0`, and every extension built on it declares at least
the same. Nothing this extension does changed — the same diagrams render the
same way. Installations on an older VS Code keep 0.7.x and stop receiving
updates.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.134.0` to `^1.136.0`, with
  `@types/vscode` at `~1.136.0` to match.
- `@kkdev92/vscode-ext-kit` `^4.1.0` → `^5.0.0`. The only change in that major is
  the VS Code floor; the API it exposes is byte-for-byte what 4.1.1 exposed.
- `happy-dom` `^20.11.15` → `^20.14.0`. It provides the DOM the bundled PlantUML
  engine renders into, so it ships with the extension; the releases in between
  are patches to node lifecycle and custom-element handling.

- `@kkdev92/vscode-ext-kit` `^4.0.0` → `^4.1.0`. The framework's 4.1 is about
  introspection and tooling; its API is additive and the VS Code floor is
  unchanged, so nothing here had to move.

  **The bundle grows by 6,446 bytes (204,121 → 210,567), and the growth is
  accounted for.** Built against both kit versions and compared: all of it is
  framework runtime this extension links — a preflight failure reported as
  data, a shutdown timeout that names what was holding it, `inspect()` on both
  scope kinds, and `defineExtension` refusing a second activation after
  deactivation. This extension activates once per suite, the way a real host
  does, so the last one changes nothing here.

  The extension module now also exports its compiled `plan`, which is what the
  kit's new command line reads off the built bundle: `plan --check` reports the
  compiled plan sound, and `manifest` reports package.json and the plan
  agreeing on 4 commands and 5 settings. The plan is data — nothing callable is
  reachable through it.

- `@kkdev92/vscode-ext-kit` `^3.0.0` → `^4.0.0`. The framework raised its own
  `engines.vscode` to `^1.134.0`, which this extension already declares, so the
  two now agree instead of the extension quietly requiring more than the library
  it is built on.

  **The bundle is byte-identical.** Built both ways and compared: the esbuild
  output is the same file down to the byte. The published 3.0.0 and 4.0.0
  packages differ only in `testing/fakes/fake-filewatcher`, which reaches
  callers through the `./testing` subpath and never enters a bundle, and all
  105 `.d.ts` are identical, so there is no API change either.

### Fixed

- **The Marketplace version badge could render as a broken image.** The host
  serving it, `vsmarketplacebadges.dev`, returns HTTP 500 intermittently. The
  badge now comes from `badgen.net` and reports the same version.

## [0.7.0] - 2026-08-29

### Changed

- **Breaking: VS Code 1.134 or later is now required**, up from 1.125.
  `@types/vscode` moved to `~1.134.0` in the same change, and the two have to
  move together: `vsce` refuses to package an extension whose `@types/vscode`
  is newer than its `engines.vscode`. That is what the grouped dependency
  update ran into — `@types/vscode ~1.134.0 greater than engines.vscode
  ^1.125.0. Either upgrade engines.vscode or use an older @types/vscode
  version`.

  The rule is right: types above the floor let code compile against an API the
  declared minimum does not have. DefinitelyTyped had been stuck at 1.125.0 for
  months against a stable line already past 1.131, and has now caught up to
  1.134.0 — one release behind the current 1.135.

- **The diagram engine moved: `@plantuml/core` 1.2026.6 → 1.2026.7.** This is the
  runtime dependency that renders every diagram, so it is the one bump here that
  can change output. Upstream published no changelog for .7 at the time of this
  release, so it was checked by running it: 122 unit and 44 integration tests,
  the latter rendering real diagrams, plus `verify:vsix`, which renders from the
  packaged extension.

- Other dependencies: `happy-dom` 20.11.2 → 20.11.6, `@types/markdown-it` 14.1.2
  → 14.2.0, `vitest` and `@vitest/coverage-v8` 4.1.10 → 4.1.11, `eslint` 10.7.0
  → 10.9.1, `typescript-eslint` 8.61.0 → 8.68.0. All build-time only.

## [0.6.1] - 2026-08-15

### Fixed

- **0.6.0 never reached the Marketplace**; this release is 0.6.0 plus the fix
  that lets it publish. The README and CHANGELOG showed the inserted image
  reference as an example, and `vsce` rewrites relative Markdown links with a
  regular expression over the raw file — code fences and backticks included —
  so the packaged listing carried a real `<img>` pointing at an `.svg` in this
  repository. The Marketplace rejects SVG images from anywhere but its trusted
  badge providers, and does so *after* upload: `vsce publish` reported success
  and the version silently never appeared. Both examples now describe the
  reference instead of writing it, and `verify-vsix` fails the build if a
  packaged Markdown file ever renders a repository-hosted SVG again.

## [0.6.0] - 2026-08-15

### Added

- **Diagrams can be exported as SVG.** The preview was the only place a
  ` ```plantuml ` block became a diagram, so a document was unreadable anywhere
  that does not render PlantUML itself — GitHub shows the block as source.
  `PlantUML Local: Export Diagram as SVG` writes the block under the cursor and
  `PlantUML Local: Export All Diagrams as SVG` writes every named block, both
  producing the same sanitised SVG the preview receives — plus an `xmlns:xlink`
  declaration the engine omits: injected into the preview as HTML nobody
  notices, but a standalone `.svg` is strict XML, and without the declaration a
  browser shows a broken image for any diagram containing an icon.
- A block can be named in its info string — ` ```plantuml orders-api ` — which
  becomes the file name. That is what ties a block to its SVG across edits; a
  position could not, since inserting a diagram above would repoint every file
  below it. Unnamed blocks are skipped by the bulk command rather than guessed
  at. The syntax already rendered, and GitHub already ignores the extra word.
- `plantumlLocal.exportDirectory` (default `images`) sets the destination,
  relative to the Markdown file rather than to the workspace root. Absolute
  paths and `..` are rejected.
- The commands sit in the editor's right-click menu, gated by context keys:
  *Export Diagram as SVG* appears with the cursor inside a ` ```plantuml `
  block, the bulk commands whenever the file contains one — the menu of a
  Markdown file without diagrams is left alone. They also work while the
  preview pane has focus, where VS Code reports no active text editor: the
  commands fall back to a visible Markdown editor.
- **References write themselves.** `PlantUML Local: Export All Diagrams and
  Update References` exports and then inserts
  a Markdown image reference targeting `images/name.svg#plantuml-local` after
  each block — or rewrites it
  when the block was renamed or the directory changed. Only lines carrying the
  `#plantuml-local` marker are ever touched; a hand-written reference is out of
  bounds by construction, a marked line orphaned by a deleted block is left
  alone rather than guessed about, and running the command twice changes
  nothing. One Undo reverts everything it wrote. It is the only command that
  edits the document; the two plain export commands still never do.
- **Marked images are hidden in the preview** (`plantumlLocal.hideExportedImages`,
  default on), because the block above them already renders there — without
  this the same diagram would appear twice. GitHub ignores the fragment and
  shows the SVG. The hiding happens in this extension's own markdown-it image
  rule rather than CSS, so it does not depend on how the preview rewrites
  image URLs.
- **Exports default to the light palette** (`plantumlLocal.exportTheme`:
  `light` / `dark` / `preview`). Exported files face hosts like GitHub whose
  background this extension does not control; a dark diagram on a white page
  reads as broken. `preview` restores follow-the-editor rendering.
- **Exported SVGs carry their own background** — white, or `#1b1b1b` for dark
  exports, the same backdrops the preview's stylesheet uses. The engine leaves
  most canvases transparent, which the preview papers over with CSS; on
  GitHub's dark theme a transparent light-palette diagram was black text on a
  near-black page.

## [0.5.0] - 2026-08-14

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

[Unreleased]: https://github.com/kkdev92/plantuml-local/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/kkdev92/plantuml-local/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/kkdev92/plantuml-local/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/kkdev92/plantuml-local/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/kkdev92/plantuml-local/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/kkdev92/plantuml-local/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kkdev92/plantuml-local/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/kkdev92/plantuml-local/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/kkdev92/plantuml-local/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kkdev92/plantuml-local/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kkdev92/plantuml-local/releases/tag/v0.1.0
