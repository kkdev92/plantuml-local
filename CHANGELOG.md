# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Local `!include`.** `!include`, `!include_once` and `!include_many` read
  files of the workspace, in the Markdown preview, the `.puml` preview, the
  Problems panel and the export alike. A path is looked for next to the file
  it is written in, and a bare name then in the folders of the new setting
  `plantumlLocal.includePaths`. Only UTF-8 files ending in `.puml`,
  `.plantuml`, `.pu`, `.iuml`, `.wsd`, `.inc` or `.txt` are read, from the
  document's workspace folder, through no symbolic link or junction, in a
  trusted workspace. A repeated `!include` of a file is skipped, as the
  engine does, although PlantUML's migration notes say it may be included
  again; `!include_many` includes it again. An include that is refused says
  why in the preview and in the Problems panel (`PLLOCAL-INC001`).
- **Included files are followed.** A diagram is drawn again when a file it
  includes is edited, saved, or changed, created or deleted on disk — at once
  with the update mode `onChange`, once the file is saved with `onSave` and
  only on request with `manual`, marked as not updated until then. Its
  problems are checked again at once. A change made outside VS Code to a file
  in a folder that `files.watcherExclude` leaves out with a pattern ending in
  `/**` is not noticed: *Clear Render Cache and Re-render* draws it.
- **Included themes count for the palette.** A `!theme`, or the Azure icons,
  that a diagram gets from a file it includes now decides the palette as one
  written in the diagram does: when it turns the choice, the diagram is drawn
  once more in the other palette. The `.puml` preview says when it shows a
  diagram in the palette other than the one asked for, and why.
- **Going to an included file, and completing its path.** Ctrl+Click on the
  path of a local `!include`, or *Go to Definition*, opens the file the
  diagram reads: the one the preview draws, next to the including file or in
  a search folder. A path the engine works out from a variable, a function or
  a defined name is not followed. After `!include ` the path completes with
  the folders and the files it can lead to, a search folder's names marked
  with the folder. Neither is offered in Restricted Mode.

### Changed

- Untrusted and virtual workspaces are supported in part: there, no file is
  read for an `!include`, and `plantumlLocal.includePaths` is not used in
  Restricted Mode.

## [0.12.1] - 2026-10-04

### Changed

- A new `plantumlLocal.logLevel` applies to the next entry the renderer or the
  Markdown preview writes. It used to wait for a reload.
- `plantumlLocal.exportDirectory` starting with a backslash is refused, as one
  starting with `/` is. It used to be read as the folder of that name next to
  the document.
- `@kkdev92/vscode-ext-kit` `^7.0.0` → `^7.1.0`. Its log filter and its check
  for relative paths take over from this extension's own.

### Fixed

- `plantumlLocal.exportDirectory` set to only spaces is refused, as an empty
  one is. It used to create a folder named with those spaces next to the
  document and write the files there.

## [0.12.0] - 2026-10-03

### Added

- **`.puml` files open as PlantUML.** Files ending in `.puml`, `.plantuml`,
  `.pu`, `.iuml` or `.wsd` get the language PlantUML and the same colouring
  as ```` ```plantuml ```` blocks, with `'` and `/' … '/` for the comment
  commands.
- **A preview for `.puml` files.** *Open Diagram Preview to the Side*, also
  the button in the editor's title bar, shows the diagram under the cursor in
  a panel kept to that file; a file with several diagrams lists them in the
  panel. The panel draws the diagram again as the file changes and when the
  palette changes, and comes back when VS Code restarts. It shows the SVG as
  an image, so nothing in it can run.
- **Zoom in the `.puml` preview.** The diagram is fitted to the panel, never
  past 100%, and can be zoomed with the buttons above it, the keys `-`, `+`,
  `0` and `1`, Ctrl+wheel (Cmd on macOS) or a pinch at the pointer, and moved
  with the wheel, a drag or the arrow keys. Each diagram keeps its zoom and
  position while it is redrawn, while the panel is hidden, and across a
  restart.
- **Export from `.puml` files.** *Export Diagram as SVG* and *Export All
  Diagrams as SVG* work in a PlantUML file too, writing each of its diagrams
  to a file of its own: the one under the cursor, or every named one. A
  diagram is named by an id on its start line, `@startuml(id=orders-api)`,
  and the only diagram of a file may go by the file's name instead.
- **Export as PNG.** *Export Diagram as PNG* writes the diagram under the
  cursor as a PNG, for where an SVG does not go, such as a slide or a chat.
  It is drawn at `plantumlLocal.exportPngScale` times the diagram's own size
  (1, 2 or 4; 2 by default) on the background of its palette, in a panel that
  opens beside the editor for the time the drawing takes. A PNG larger than
  8192 pixels a side or 16 million in all is refused, and the message names
  the largest scale it would fit at. The PNG button of the `.puml` preview
  does the same for the diagram it shows.
- **Suggestions while typing a diagram**, in ```` ```plantuml ```` blocks
  and `.puml` files: the start line of each diagram type the bundled engine
  draws and the end line of the open one after `@`, the preprocessor
  directives after `!`, the bundled themes after `!theme` and the OpenIconic
  names after `<&`.
- **Diagram templates.** `puml-sequence`, `puml-class`, `puml-activity`,
  `puml-state`, `puml-component` and `puml-usecase` are suggested where a
  diagram can start: as a whole ```` ```plantuml ```` block in the text of a
  Markdown document, as the bare diagram in an empty block or between the
  diagrams of a `.puml` file. Each draws as it is, with its names to tab
  through. *Insert Diagram Template* inserts one at the cursor from the
  command palette, inside the quote or list item the cursor is in, and offers
  a new block after a block that holds a diagram.
- **Folding in `.puml` files.** Each diagram folds from its start line, and
  so do block comments, multi-line notes and texts, `{ … }` bodies,
  preprocessor sections, sequence groups and activity blocks. A file with
  none of these folds by indentation, and `editor.foldingStrategy` set to
  `indentation` for `[plantuml]` folds every PlantUML file that way.
- **An outline of `.puml` files.** The Outline view, the breadcrumbs and Go
  to Symbol in Editor list each diagram and what it declares with a keyword
  (participants, classes, interfaces, enums, components, nodes, packages,
  namespaces, states and use cases), by alias with the name the diagram
  shows beside it, under the `{ … }` body that declares them. A name that
  only appears in a relation, or that a procedure creates, is left out.
- **Draw diagrams again on save, or on request.**
  `plantumlLocal.preview.updateMode` set to `onSave` draws a changed diagram
  again when its file is saved, and `manual` only with *Clear Render Cache
  and Re-render*, instead of as you type. Until then the Markdown preview and
  the `.puml` preview keep the diagram they show, with a note that it is not
  updated.
- **Export a folder.** *Export All Diagrams in Folder as SVG*, also on a
  folder's right-click menu in the Explorer, exports the named diagrams of
  every Markdown and PlantUML file under a folder, each into its own export
  directory, after asking with the list of documents. Version-control and
  build folders and links are not followed, a folder of more than 500
  documents or 2,000 named diagrams is refused rather than exported in part,
  and cancelling writes nothing. A diagram headed for the same file as
  another, in one document or several, is now reported instead of written
  over it. *Export All Diagrams in Folder as PNG* does the same with PNGs,
  drawn one after another in a single panel.
- **Reveal what an export wrote.** The message an export ends with offers
  *Reveal in Explorer View*, which selects the file it wrote, or the first of
  them, in the Explorer.
- **Name a diagram from the editor.** On the opening line of a block with no
  usable name, or on the start line of such a diagram in a `.puml` file, the
  light bulb offers *Name this diagram for export…*, which asks for a name and
  writes it on that line (as `(id=…)` after `@startuml`, `@startmindmap` and
  the rest) in one edit. Nothing is written if the document changed in the
  meantime.
- **Problems panel.** The diagrams of open Markdown files are checked, with or
  without a preview, and their problems are listed on the line they are on:
  the engine's errors and warnings, what the bundled engine cannot do
  (including files, libraries other than azure, themes from a folder, URLs,
  emoji), what it would drop without a word (a second diagram, the pages
  after `newpage`, `!includesub`) and a missing `@enduml`. The preview and
  the checks share renders, so a diagram both need is drawn once.
  `plantumlLocal.diagnostics.enabled` turns them off.
- **` ```puml ` blocks are diagrams too.** The preview draws them, the
  editor colours them and the export commands find them, like
  ` ```plantuml ` blocks. A document that used ` ```puml ` to show PlantUML
  source as code now shows the diagram instead.

### Changed

- **A block with two diagrams, or with `newpage`, says so instead of
  showing part of it.** The engine draws only the first diagram of a block
  and only the first page of a diagram, and dropped the rest without a word.
  The preview now explains that each diagram or page needs a block of its
  own, and export refuses the block rather than writing part of it.
- **Export asks before replacing a file that holds something else.** A file
  already at the target was overwritten without a word, even one put there by
  hand. The export commands now leave a file that already holds the diagram as
  it is, replace one they wrote from the same document if it has not changed
  since, and ask before replacing any other: once for all of them, with the
  choice of keeping those files and writing the rest. What they wrote is kept
  in the workspace's state on this machine, as each file, its document and a
  SHA-256 of the contents. A file that changes while the export runs, such as
  while its question is open, is left as it is and reported. Each file is
  written under a temporary name beside the target and renamed over it, so an
  export that fails part way no longer leaves half an image.
- `plantumlLocal.exportDirectory` and `plantumlLocal.exportTheme` can be set
  per folder, and are read for the document being exported.
- Block names are limited to 128 characters, and the bulk export commands
  report a block whose name cannot be a file name as failed, instead of
  counting it with the unnamed blocks.
- `markdown-it` 14.3.2 ships with the extension, with its dependencies
  linkify-it, mdurl, punycode.js, uc.micro and entities 4.5.0 (beside the
  entities 7.0.1 that happy-dom already brought). The export commands use it
  to find the diagram blocks of a document the way VS Code's preview does.
  Their licences are listed in `THIRD_PARTY_NOTICES.md`.
- `@plantuml/core` is pinned to 1.2026.8, the engine already shipped, rather
  than `^1.2026.8`, so an install cannot pick up an engine the tests did not
  run against.

### Fixed

- **The message after exporting a diagram names the file as the Explorer
  does**, `docs/images/orders.svg`, rather than by its encoded URI,
  `file:///c%3A/…/orders.svg`.
- **Diagrams with the Azure icons can be read in a dark editor.** Their boxes
  are white in either palette, and the dark palette made their text white as
  well. Such a diagram, unless it picks a theme, is now drawn in the light
  palette, in the preview and in exports.
- **Diagrams no longer fail along with one that takes too long.** When a
  diagram hit the 30-second limit, the diagrams waiting behind it — usually
  the rest of the document — failed with "Rendering timed out" too, and stayed
  failed until edited. The restarted renderer now draws them.
- **A preview with very many diagrams settles.** With more diagrams in the
  open previews than the render cache holds — 200, or 16 MB of SVG — each
  refresh drew the ones it had evicted again, evicting others, so the
  preview never finished and kept the renderer busy. The diagrams a preview
  shows now stay cached, for the last eight documents previewed.
- **The messages that refuse a diagram name or an empty export directory say
  why.** A name must be ASCII letters, digits, hyphens and underscores, and
  not a Windows device name such as `CON`, which the message did not say. An
  empty `plantumlLocal.exportDirectory` was reported as a path with `..`.
- **A diagram missing its `@enduml` line is drawn.** The engine failed on it
  with `java.lang.IndexOutOfBoundsException`. The preview now draws it as if
  the block ended with the line, with a note saying so, and export writes it.
- **Export finds the same diagram blocks as the preview.** The export
  commands scanned the document on their own, so they missed blocks in a
  block quote or deeper in a list, and took a block written inside an HTML
  comment, which the preview does not draw. They now parse the document as
  VS Code's preview does.
- **References go inside block quotes and list items.** *Export All Diagrams
  and Update References* writes the reference of a block in a quote or a list
  item inside that quote or item, keeping the quote's `>` on the lines it
  adds, and recognises a reference an earlier version put at the start of
  the line. It no longer writes one after a fence that is never closed, where
  the line would have become part of the code.
- **An edit during the export no longer gets references planned against
  it.** If the document changes while *Export All Diagrams and Update
  References* runs, the files are written but the references are left alone,
  with a message saying so.
- **The export commands no longer guess the document when no Markdown editor
  has focus.** With the preview focused there is no active text editor, and
  the commands took the first visible Markdown editor instead — which could be
  a different file from the one being previewed. They now use the only open
  Markdown document, or ask which one when several are open. *Export Diagram
  as SVG* also takes the only block of a document without needing the cursor
  inside it.
- **A URL that is not the argument of a directive no longer stops a
  diagram.** The check that refuses `!include https://…` and
  `!theme … from https://…` matched any line holding a `!` followed by a
  word and a URL, so a title such as `title Hello!world https://example.com`,
  a label with an exclamation mark and a link, or a commented-out remote
  include showed the "URL-based external references" message instead of
  the diagram. Only the directives that read a URL are refused now, and
  comments are skipped as the engine skips them.
- **Editing a diagram no longer makes the preview flicker.** Every change to
  a block's source replaced its diagram with the "Rendering diagram…"
  placeholder until the new render finished. The preview now keeps showing
  the diagram that was there until the new one is ready; the placeholder
  appears only the first time a block renders.

## [0.11.1] - 2026-09-30

### Security

- **Exported SVGs no longer carry the diagram source.** PlantUML embeds the
  whole source of a diagram in the SVG it draws — a `plantuml-src` processing
  instruction, compressed but not encrypted — and tags elements with their
  names in `data-*` attributes. Comments, preprocessor variables, aliases and
  elements hidden with `hide` could all be read back out of an exported file,
  though the picture shows none of them. Both are now removed before an SVG
  reaches the preview or a file, and the drawing is unchanged. SVGs exported
  with earlier versions still contain them; export again to replace them.

### Fixed

- **Export no longer saves PlantUML's error drawing as the diagram.** The
  engine answers a syntax error, an include it cannot resolve or an empty
  diagram with a drawing of the error in place of the diagram, and the export
  commands wrote that drawing out as the block's SVG — *Export All Diagrams
  and Update References* then linked it from the document. Such a block now
  fails with PlantUML's message and the document line it points to, and no
  file or reference is written for it.

## [0.11.0] - 2026-09-29

### Added

- **` ```plantuml ` blocks are highlighted in the editor**, including ones
  inside block quotes and list items, and also when another extension's
  grammar claims every fence first. The grammar follows the parser of the
  bundled engine rather than PlantUML's documentation: every command of every
  diagram type the engine renders has a test case, and CI renders each case
  with the engine, so the grammar is tested on syntax the engine actually
  accepts. The JSON and YAML inside `@startjson` / `@startyaml` are coloured by
  VS Code's own JSON and YAML grammars. Diagram types the bundled engine does
  not render (`@startditaa`, …) are marked invalid, and some older forms it
  accepts only with a warning — a colour in front of an activity, `label on
  first column` in a Gantt chart — are marked deprecated.

### Fixed

- **A diagram no longer depends on the one rendered before it.** For a source
  of ten lines or more, the engine first tries the diagram type that accepted
  the previous diagram, so a source that reads as two types — lines of
  `A -> B : message` are both a sequence and a class diagram — became a class
  diagram when one had just been rendered, in the preview and in exported SVGs
  alike. The worker now clears that after every render.
- **`!theme` works.** The engine reads its themes from a `themes.js` next to
  it, which this extension did not ship, so `!theme cerulean` and the rest were
  ignored and the diagram rendered unthemed. The theme library now ships, all
  but four themes whose licence is not one this extension ships: `mars`,
  `sunlust`, `toy` and `vibrant`, for which the engine reports that it cannot
  load the theme. Most themes paint no background and were made for a page of
  one colour, so a diagram whose theme would be hard to read in the palette in
  use is drawn in the other one: `!theme plain` gets the light palette in a
  dark editor, in the preview and in exports.
- **OpenIconic icons render.** A diagram using one (`<&check>`) failed with
  `Failed to load openiconic.js`; the icons now ship too.
- A diagram using an emoji (`<:smile:>`) still does not render — the emoji
  images are not bundled — but the preview and the export now say so, instead
  of showing `Failed to load emoji.js`.

## [0.10.1] - 2026-09-28

### Changed

- happy-dom, the DOM the diagram engine runs on inside the render worker,
  20.14.3 → 20.14.5: two fixes to how HTML comments are parsed.

### Fixed

- `THIRD_PARTY_NOTICES.md` lists the versions this package actually ships.
  `@plantuml/core`, happy-dom, ws and `@kkdev92/vscode-ext-kit` had fallen
  behind; their licence texts are unchanged.

## [0.10.0] - 2026-09-18

**Breaking: VS Code 1.138 or later is now required**, up from 1.137, in step with
`@types/vscode` moving to `~1.138.0`. The two have to move together — `vsce`
refuses to package an extension whose `@types/vscode` outruns its
`engines.vscode`, and raising only the types would let code compile against an
API the declared floor does not have.

The floor is inherited: `@kkdev92/vscode-ext-kit` 7.0.0 raised its own
`engines.vscode` to `^1.138.0`, and every extension built on it declares at least
the same. Nothing this extension does changed — no command, setting, view or
behaviour is different from 0.9.x. Installations on an older VS Code keep 0.9.x
and stop receiving updates.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.137.0` to `^1.138.0`, with
  `@types/vscode` at `~1.138.0` to match.
- `@kkdev92/vscode-ext-kit` `^6.0.0` → `^7.0.0`. The only change in that major is
  the VS Code floor; the API it exposes is byte-for-byte what 6.1.0 exposed.

## [0.9.0] - 2026-09-14

**Breaking: VS Code 1.137 or later is now required**, up from 1.136, in step with
`@types/vscode` moving to `~1.137.0`. The two have to move together — `vsce`
refuses to package an extension whose `@types/vscode` outruns its
`engines.vscode`, and raising only the types would let code compile against an
API the declared floor does not have.

The floor is inherited: `@kkdev92/vscode-ext-kit` 6.0.0 raised its own
`engines.vscode` to `^1.137.0`, and every extension built on it declares at least
the same. Nothing this extension does changed — no command, setting, view or
behaviour is different from 0.8.x. Installations on an older VS Code keep 0.8.x
and stop receiving updates.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.136.0` to `^1.137.0`, with
  `@types/vscode` at `~1.137.0` to match.
- `@kkdev92/vscode-ext-kit` `^5.0.0` → `^6.0.0`. The only change in that major is
  the VS Code floor; the API it exposes is byte-for-byte what 5.0.0 exposed.

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

[Unreleased]: https://github.com/kkdev92/plantuml-local/compare/v0.12.1...HEAD
[0.12.1]: https://github.com/kkdev92/plantuml-local/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/kkdev92/plantuml-local/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/kkdev92/plantuml-local/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/kkdev92/plantuml-local/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/kkdev92/plantuml-local/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/kkdev92/plantuml-local/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/kkdev92/plantuml-local/compare/v0.8.0...v0.9.0
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
