# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**Breaking: VS Code 1.144 or later is now required**, up from 1.138, in step
with `@types/vscode` moving to `~1.144.0`. The two have to move together —
`vsce` refuses to package an extension whose `@types/vscode` outruns its
`engines.vscode`. The new floor on its own changes nothing the extension
does. Installations on an older VS Code keep 0.17.x and stop receiving
updates.

### Added

- **Completion offers what a diagram defines, with parameter hints for the
  calls.** The procedures, functions and macros a diagram defines before the
  cursor (`!procedure`, `!function`, `!define`, `!definelong`) and its
  variables are offered, with what the files it includes define there —
  files of the workspace, read as the preview reads them, and the bundled C4
  and Azure libraries. Each shows its parameters, where it is defined and
  what defines it, and in its details how it is declared, its line and the
  comment above it; picking one writes the call with a placeholder for each
  parameter up to the last that has no default. The parameter hints, on `(`
  and `,`, show each definition of the name called with its parameters as
  declared, and the one the cursor is in, by place or by name. Nothing is run
  to find them: a definition under `!if` is marked conditional, several of
  one name and number of parameters ambiguous, and those an include that is
  not read may change, unresolved. The Language Status says what is offered,
  and the output which includes were not read and why. Since 0.17.0 the list
  has held a diagram's own words, no longer those of open include files; the
  names those files define are offered again, from the files the diagram
  includes, open or not.
- **Go to Definition leads to what a diagram defines and declares.** *Go to
  Definition*, Ctrl+Click and *Peek Definition* on a call or a variable lead
  to its definition — in the diagram, in a file of the workspace it includes,
  with its unsaved changes, or in a file of the bundled C4 and Azure
  libraries — picked by the arguments given, as the engine picks it; on a
  participant, a class or another element a line declares with its keyword,
  to each line that declares it in the same diagram, never in another. Where
  several definitions may hold, each is listed; where an include that is not
  read may replace the definition, none is. The path of an include of a
  bundled library, and a definition in one, open the library's file
  read-only, as the extension bundles it.
- **Find All References lists where a diagram uses what it defines and
  declares.** *Find All References*, *Go to References* and *Peek References*
  on a call, a variable or the name a definition declares list each call and
  use that Go to Definition leads from to the same definition — in the
  diagram and in the files of the workspace it includes, with their unsaved
  changes — and on a participant or another element a line declares, each
  line of the diagram that names it before its label. Another diagram, the
  files of the bundled libraries and the files that include the one searched
  are not searched. The definition is listed unless the command leaves it
  out. A use that an include that is not read may define again is not
  listed, and the Language Status says the list is partial, as it does when
  the list stops at 5,000 places. The completion, the parameter hints, Go to
  Definition and Find All References read a PlantUML file with no start line,
  one that only other files include, whole, as its preview draws it.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.138.0` to `^1.144.0`, with
  `@types/vscode` at `~1.144.0` to match.

## [0.17.1] - 2026-10-28

### Fixed

- **`!include <azure/all>` works.** It includes every category of the Azure
  icons at once, and failed with a syntax error at its first line instead:
  the extension gave the engine the file with the `@startuml` and `@enduml`
  lines it is written between, which PlantUML's standard library leaves out
  of what it hands the engine, and without the list of categories the file
  reads with `%load_json`. The file now reaches the engine without those
  lines, and the list ships with the library.
- **The words on the `.puml` preview's Copy SVG button are translated.** They
  were English whatever the display language, while the button's tooltip and
  the words on the other buttons were translated.

## [0.17.0] - 2026-10-28

### Added

- **The C4 library ships with the extension.** `!include <C4/C4_Context>`,
  `<C4/C4_Container>`, `<C4/C4_Component>`, `<C4/C4_Dynamic>`,
  `<C4/C4_Deployment>` and `<C4/C4_Sequence>` — C4-PlantUML 2.14.0, as
  PlantUML's standard library carries it — render offline in the previews and
  in exports, with the `C4` definitions they share. The library's themes are
  not bundled; an include of a file of the library that is not bundled fails
  with a message that lists the files that are, and the message for a library
  that is not bundled at all now names both bundled libraries. C4's colours
  are made for a white page, so a C4 diagram that picks no theme is drawn in
  the light palette, as one with the Azure icons is.
- **An image the bundled engine does not draw is now said.** The engine draws
  only an image written into the diagram as a PNG (`data:image/png;base64,…`);
  one from a file or a URL, or inline data of another kind, it draws as the
  text `[img TBD…]`. An image named with `<img:…>`, or given to C4 with
  `img:` (as in `$sprite="img:…"`), now gets a warning on its line in the
  Problems panel, a note above the drawing in the Markdown and `.puml`
  previews, and a note in an export's notice.
- **Completion offers the aliases and the snippets of the diagram at the
  cursor.** In a ` ```plantuml ` block or a `.puml` file, the list offers each
  alias the diagram declares with the name it shows (`A` with `Order desk`
  for `participant "Order desk" as A`). On a line of its own, a sequence
  diagram offers snippets of `alt`, `opt`, `loop`, `par`, `ref` and `note`,
  and an activity diagram of `if`, `while`, `repeat` and `fork`, with their
  parts to tab through; each draws as inserted. A `@startuml` diagram is
  taken for one or the other by lines that only that type reads, such as
  `participant` or `start`; where its lines do not tell, no snippet is
  offered.
- **The `.puml` preview zooms to an area, and scrolls to an edge.** *Zoom to
  Area* (`Z`) has the next drag mark an area rather than move the diagram, and
  zooms to fit that area in the panel; Esc leaves it without zooming. `Home`
  and `End` scroll to the top and the bottom of the diagram, with Shift to its
  left and right edges, and `C` to its centre. The panel's context menu has
  these too.

### Changed

- **The words suggested in a diagram are that diagram's own.** VS Code's word
  suggestions come from every open document of the language: the names of
  other diagrams and of open include files in a `.puml` file, the prose of
  the document in a Markdown block. In a diagram, the words now come from
  that diagram alone, leaving out those of comments, quoted text and notes.
  They follow `editor.wordBasedSuggestions`: none with `off`. With its
  default, `offWithInlineSuggestions`, VS Code lists no words in a PlantUML
  file while inline suggestions are on there, which an extension cannot
  tell; so a `.puml` file gets the diagram's words only beside its aliases
  or snippets, and the rest is left to VS Code.
- **The `.puml` preview tells a screen reader what a drawing comes to, not
  each drawing.** Its status line and zoom were live regions, so a screen
  reader heard "Rendering diagram…" and the zoom each time the diagram was
  drawn again — at every pause in typing. It now hears, once drawing settles,
  that the diagram was rendered or why not, and only when that changes; the
  zoom when a button, a key or the wheel changes it; and what came of a copy.
  The image and the drawing area, which had no name, are named after the
  diagram: the title it draws, else its name, else its place in the file.

### Fixed

- **The focus shows on the `.puml` preview's pressed Fit button.** The focus
  ring of the preview's buttons and list was drawn inside them, in the colour
  that the default themes give a pressed button's background, so *Fit to
  Window* — pressed while the diagram is fitted — showed no focus at all; and
  in a high contrast theme the ring only recoloured the border. It is now
  drawn around the control, 2 px out, as VS Code draws it around its own
  buttons.
- **The `.puml` preview keeps its view while the panel resizes.** A PNG
  export opens a panel beside the editor for a moment, and VS Code lays the
  editors out again around it, so the preview took several sizes within
  half a second; a zoomed-in view could end up moved to one side, and stay
  there. The point at the centre of the view is now kept however quickly
  the panel resizes, and a view scrolled to an edge comes back to it.
- **A diagram fitted to the `.puml` preview fits inside it.** At some panel
  sizes, *Fit to Window* left the diagram a fraction of a pixel larger than
  the panel, which then showed a scroll bar and scrolled by a hair. The
  diagram is now fitted to the panel's size rounded down.
- **A drag in the `.puml` preview ends when the button is let go outside
  the panel.** The page did not hear the button come up outside the panel,
  so the diagram went on following the pointer once it came back, with no
  button down, until the next click. The drag now ends there.
- **The `.puml` preview's zoom buttons are one stop for Tab.** They are
  marked as a toolbar, whose buttons are moved between with the arrow keys,
  but each was a stop for Tab and the arrow keys scrolled the diagram. Tab
  now stops once on the zoom buttons, at the one used last; there the left
  and right arrow keys move between them, round from either end, and Tab
  goes on to PNG. The up and down arrow keys, `Home` and `End` still move
  the diagram.
- **The `.puml` preview's buttons keep to the right when a narrow panel
  wraps them.** The zoom buttons kept to the right only while they fitted
  on one row; in a narrower panel they wrapped from its left edge, while
  PNG and the Copy buttons stayed at the right. *Zoom to Area*, new among
  the zoom buttons, has them wrap in a wider panel than before. Every row
  of buttons now keeps to the right.

## [0.16.0] - 2026-10-27

### Added

- **The Problems panel lists the diagrams of PlantUML files too.** An open
  `.puml` file is checked as a Markdown file has been: each of its diagrams
  on its own, whether or not a preview is open, with the engine's errors and
  warnings, a file it could not include, and what the bundled engine does not
  render, on the line concerned. A PlantUML file with no `@start…` line holds
  lines to include rather than a diagram, so it is left alone — until its
  preview is open, which draws it as one diagram; then it is checked as one.
  `plantumlLocal.diagnostics.enabled` turns these checks off as well.
- **A quick fix adds the end line a diagram lacks.** The warning that a
  diagram has no `@enduml` (or `@endmindmap`, and so on) line now carries a
  fix, in the editor's light bulb and in the Problems panel, that adds the
  line after the diagram's last line of content: before the closing fence of
  a Markdown block, with its quote marker or list indentation, or before the
  next diagram of a PlantUML file. A block whose fence is not closed, or that
  holds more than one diagram, gets no such fix. The fix reads the document
  again when it runs and does nothing if the diagram has changed since.
- **What the bundled engine leaves out of a diagram is now said.** The
  bundled engine draws a formula in `<math>` or
  `<latex>` tags as blank text, and leaves out a diagram embedded in a note,
  a legend or a class body with `{{ … }}`, both without an error. The
  Problems panel now warns on the line concerned, the Markdown preview and
  the `.puml` preview say so above the drawing, and an export that writes
  such a diagram says so in its notice and in the Output panel. Comment
  lines, the braces of a Salt diagram and `{{` inside a label, which the
  engine draws as text, are left alone.
- **Preview, Export SVG and Export PNG sit above each diagram.** The first
  line of each diagram — the `@start…` line in a `.puml` file, the opening
  fence of a block in Markdown — carries the three actions, which act on that
  diagram wherever the cursor is: the `.puml` preview opens beside the editor
  on it, a Markdown block is selected and VS Code's Markdown preview opened
  beside the editor, and the exports write it as the export commands do,
  under the same conditions. An action left from before an edit finds its
  diagram again by name, and does nothing rather than act on another. A
  block holding several diagrams gets *Preview* only; a `.puml` file with no
  `@start…` line gets nothing. `plantumlLocal.codeLens.enabled` turns the
  actions off, per folder if wanted, besides VS Code's `editor.codeLens`.
- **A diagram can be copied as SVG text.** *Copy Diagram as SVG Text* — in
  the Command Palette, in the editor's right-click menu inside a block, and
  as the *Copy SVG* button of the `.puml` preview — puts on the clipboard the
  SVG that *Export Diagram as SVG* would write: the export palette, the
  background, and a note of what the engine left out. No file is written, so
  the block needs no name, and an untitled document or a restricted
  workspace, where the export stops, can be copied from as far as the
  diagram renders there. A diagram with an error is not copied, and the
  notice points to the Problems panel; SVG text over 32 MiB is refused with
  a pointer to the file export. The PNG *Copy* button and Ctrl+C in the
  preview are as they were.
- **Ten more diagram templates.** `puml-object`, `puml-er`, `puml-deployment`,
  `puml-timing`, `puml-gantt`, `puml-mindmap`, `puml-wbs`, `puml-salt`,
  `puml-json` and `puml-yaml` join the six templates, in the completion where
  a diagram can start and in *Insert Diagram Template*. Each draws as it is
  with the bundled engine, its placeholders at their defaults.
- **A list of a Markdown file's diagrams to go to.** *Go to Diagram in
  Document…* lists the diagram blocks of the Markdown file in the editor —
  named or not, drawn or not, in a block quote or a list item — with their
  line, the kind their start line declares, the heading above them and their
  title or first line, filters on all of that, and moves the cursor to the
  block picked. Edited while the list is open, the file is read again, so a
  pick lands where the block is then. Nothing is drawn for the list, and VS
  Code's outline of the headings is as it was.
- **A colour picker on the colours a diagram sets.** A swatch sits beside the
  value of a `skinparam`, the colour at the end of an element's declaration
  and a colour property in a `<style>` block — `#ABC`, `#AABBCC` or a name
  the bundled engine knows — in `.puml` files and Markdown blocks, in block
  quotes and list items too. Clicking it opens VS Code's colour picker, and
  a pick is written back as `#RRGGBB` in place of the token; a pick with an
  alpha is offered nothing, as the token cannot carry it. A gradient, a
  colour with a style modifier or an alpha, and a `#` in a comment, a string
  or a URL get no swatch. The names and the positions are the ones the
  bundled engine was seen to draw. VS Code's own default swatches, which
  marked any hex-like token in a `.puml` file and offered CSS forms a
  diagram cannot take, step back for these. VS Code's
  `editor.colorDecorators` turns the swatches off.

### Changed

- Exporting a diagram of a `.puml` file that the engine rejects now offers
  *Show Problems*, as a Markdown diagram has, when the checks are on; before,
  the Problems panel listed no PlantUML file and *Show Output* was offered.

### Fixed

- A PlantUML file whose lines end with a lone CR — the classic Mac OS line
  ending — is read line by line, as the editor shows it, wherever the
  extension reads a file it has not opened: the folder export, the files a
  diagram includes, the themes read from a folder. The folder export took
  such a file as one line before, so a file holding several named diagrams
  counted as one diagram, only the first was exported, and the summary did
  not mention the others.

## [0.15.1] - 2026-10-24

### Changed

- happy-dom, the DOM the diagram engine runs on inside the render worker,
  21.0.3 → 21.0.4. 21.0.4 fixes a code injection in its compiler for module
  scripts ([GHSA-834v-8h66-3h79](https://github.com/advisories/GHSA-834v-8h66-3h79)),
  which needs happy-dom's JavaScript evaluation turned on; the extension
  leaves it off, so it was not exposed.

## [0.15.0] - 2026-10-23

### Added

- **Copying a diagram to the clipboard from the `.puml` preview.** The Copy
  button beside the PNG button puts on the clipboard the PNG that the PNG
  button would write, in the same palette (`plantumlLocal.exportTheme`, light
  by default) and at the same scale (`plantumlLocal.exportPngScale`), to paste
  into a chat, a slide or a document. Ctrl+C (Cmd+C on macOS) in the panel and
  *Copy* in its context menu do the same; they copied nothing before. The
  panel says when the image is on the clipboard, or why it is not, and a
  diagram the PNG button would not export is not copied either. Copying writes
  no file, so it also works in Restricted Mode.

## [0.14.2] - 2026-10-21

### Security

- **A crafted Markdown document no longer stalls the extension host for
  seconds.** The extension reads Markdown documents with markdown-it to find
  their diagram blocks: for the Problems panel as soon as a document opens and
  again after each edit, and for export, completion and the quick fixes.
  markdown-it 14.3.2 took time that grows with the square of the input on two
  kinds of unfinished text — a link reference definition whose label or title
  is never closed ([GHSA-gfr2-rv44-r23c](https://github.com/advisories/GHSA-gfr2-rv44-r23c)),
  and, with HTML enabled as in VS Code's preview, comments, processing
  instructions, declarations and CDATA sections left open inside a paragraph
  ([GHSA-vfgh-jcmw-g37q](https://github.com/advisories/GHSA-vfgh-jcmw-g37q)).
  The bundled markdown-it moves to 14.3.3, which fixes both.

## [0.14.1] - 2026-10-20

### Changed

- happy-dom, the DOM the diagram engine runs on inside the render worker,
  20.14.5 → 21.0.3. The diagrams it draws are the same.

### Fixed

- After a diagram made Graphviz crash, every diagram Graphviz lays out — class,
  use case, component, deployment, state, object and old-style activity
  diagrams — showed the same crash report, in every document, until the render
  worker was restarted, which happened only after five idle minutes or a
  timeout. The worker is now restarted as soon as Graphviz crashes, and the
  diagrams waiting behind the one that crashed it are drawn by the new one.
  That diagram still shows the report, which is now an error (next item).
- The diagram that makes Graphviz crash is an error, as a syntax error is. The
  engine's crash report was taken for a diagram: the previews showed it with no
  word of explanation, the Problems panel listed nothing, and exporting the
  diagram wrote the report to the image file, which *Export All Diagrams as
  SVG and Update Image Links* then linked from the document. Now both previews
  say what to do, the Problems panel lists it (`PLLOCAL-RUN002`), and its
  export is refused.
- A diagram whose text held a control character (U+0000 to U+001F, other
  than a tab or a line break), U+FFFE or U+FFFF could not be used outside
  the Markdown preview. XML does not allow these characters, and they
  reached the SVG as they were, so an exported SVG was refused by browsers,
  the PNG export failed ("The source image cannot be decoded"), and the
  `.puml` preview showed nothing. Each is now drawn as U+FFFD, the
  replacement character, with room made for it.
- When exporting a diagram in a `.puml` file was refused for a mistake in
  it, the notice offered *Show Problems*, which opened a Problems panel
  without it: the panel lists the diagrams of Markdown files only. It now
  offers *Show Output*, as it does when the Problems checks are turned off.

## [0.14.0] - 2026-10-19

### Added

- **Going to the file of `!includesub` and `!theme … from`, and completing
  their paths.** Ctrl+Click or *Go to Definition* on the path of an
  `!includesub file.puml!PART` opens the file, and on the name or the folder
  of `!theme name from folder`, the theme's file there, as for `!include`.
  After `!includesub ` the path completes as after `!include `; after the
  `from ` of a `!theme`, the folders do.
- **Notifications offer the next step.** A message about something that went
  wrong comes with a button that leads on from it: *Show Problems* for a
  diagram with an error, *Export as SVG* for a PNG that cannot be made (and
  *Open Settings* when a smaller PNG scale would fit), *Show in Explorer* for a
  file in the way, *Show Output* for the reasons a bulk export lists there,
  *Name Diagram…* when blocks without a name were left out and nothing was
  exported, *Choose Folder…* for a folder with too many files, *Open Settings*
  for an export folder that cannot be used, and *Manage Workspace Trust* in
  Restricted Mode. With a button, VS Code shows the whole message rather than
  one line of it.

### Changed

- **Messages are rewritten in English and Japanese** to say what happened and
  what to do, without assuming knowledge of the extension: notifications, the
  notes and error boxes of the previews, the Problems panel and the output
  channel. Export messages point to a setting with *Open Settings* instead of
  naming its ID.
- **Engine errors are explained** in both languages where the engine's own
  English message used to be shown: among them a syntax error, an include that
  failed, a diagram type the bundled engine does not support, a loop stopped
  after too many repetitions, and a diagram with more than 20 included files,
  which the bundled `@plantuml/core` 1.2026.9 stops loading after 20 rounds
  ([plantuml/plantuml#2943](https://github.com/plantuml/plantuml/issues/2943);
  the README lists it under Known Limitations). An error not recognised is
  still shown as written.
- Two commands are renamed: *Export All Diagrams as SVG* is now *Export All
  Diagrams in File as SVG*, and *Export All Diagrams and Update References* is
  now *Export All Diagrams as SVG and Update Image Links*. The extension's
  description and the setting descriptions are rewritten, and the descriptions
  VS Code shows for Restricted Mode and virtual workspaces now have Japanese
  translations too.

### Fixed

- In a narrow `.puml` preview, the toolbar wraps instead of breaking a button's
  label and pushing *100%* out of view.
- A local include that fails is worded the same everywhere. The Problems
  panel, the `.puml` preview and a failed export now say
  `Could not include <path>: <why>`, translated, as the Markdown preview's note
  does, instead of the engine's untranslated `cannot include <path>` with the
  reason after it. The path is the file the engine asked for: for
  `!includesub`, without its section; for `!theme … from`, the theme's file.
- In a dark editor, a diagram whose own colours leave its text hard to read
  is drawn in the light palette, as one with a theme made for a white page
  is. A light background set with `skinparam`, a style or on an element, such
  as `participant Alice #DDEEFF`, kept the dark palette's white text on it.
  A diagram drawn in the dark palette is now looked at once drawn, in the
  preview, the `.puml` preview and a dark export alike, and drawn again in the
  light palette when that reads better. The `.puml` preview says so when its
  colours, rather than its theme, are hard to read.
- Links (`[[…]]`) are drawn in a light blue in the dark palette. The bundled
  engine uses the same link colour in both palettes, which can give low
  contrast against dark backgrounds and note fills.

## [0.13.0] - 2026-10-17

### Added

- **Local `!include`.** `!include`, `!include_once` and `!include_many` read
  files of the workspace, in the Markdown preview, the `.puml` preview, the
  Problems panel and the export alike. A path is looked for next to the file
  it is written in, and a bare name then in the folders of the new setting
  `plantumlLocal.includePaths`. Only UTF-8 files ending in `.puml`,
  `.plantuml`, `.pu`, `.iuml`, `.wsd`, `.inc` or `.txt` are read, from the
  document's workspace folder, through no symbolic link or junction, in a
  trusted workspace. A repeated `!include` of a file is skipped, as the
  bundled engine does; `!include_many` includes it again. An include that is
  refused says why in the preview and in the Problems panel (`PLLOCAL-INC001`).
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
- **Include selectors, sub sections and local themes.** An `!include` can
  choose a diagram by index or id, `!includesub` reads a named section, and
  `!theme name from folder` reads a local theme. Selection and missing-section
  errors come from the engine. Different selections of the same file are
  included separately, and local theme colours take part in palette selection.
- **`@startsalt` wireframes are drawn**, by the new engine. In the editor their
  common commands (`title`, `skinparam`, `scale` …) are coloured and the widget
  lines are left as text; completion offers `@startsalt`.

### Changed

- Untrusted and virtual workspaces are supported in part: there, no file is
  read for an `!include`, and `plantumlLocal.includePaths` is not used in
  Restricted Mode.
- **The diagram engine moved: `@plantuml/core` 1.2026.8 → 1.2026.9**, the
  first release with the file loader that local includes need. It reads its
  input differently, which changes what some blocks show:
  - A block without `@startuml` is drawn as a diagram. It used to show
    *Diagram not supported*.
  - Lines above `@startuml` are left out of the drawing; a note above the
    diagram and a warning in the Problems panel (`PLLOCAL-DOC004`) say so.
    The block used to show *Diagram not supported*.
  - A diagram between `\startuml` and `\enduml` fails with a syntax error,
    where it used to be drawn. Write `@startuml` and `@enduml`.
  - In an activity diagram, `#pink:text;` is an action on its own line, drawn
    with a warning that the colour is ignored; the line after it is no longer
    part of it. The colouring in the editor follows. A colour in front of `if`,
    `elseif`, `while` and `switch` is ignored too, with a warning.
  - A `[[url]]` link is still drawn as text, not as a link: the engine now
    wraps it in a link element, which is removed with the target it holds.
  - Some warnings and errors are worded differently.

### Fixed

- An `!include <azure/…>` of an entry the library does not have is listed in
  the Problems panel in the engine's own words. It used to be explained as a
  local file the bundled engine does not read.

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
  emoji), content it would not render (a second diagram, the pages after
  `newpage`, `!includesub`) and a missing `@enduml`. The preview and
  the checks share renders, so a diagram both need is drawn once.
  `plantumlLocal.diagnostics.enabled` turns them off.
- **` ```puml ` blocks are diagrams too.** The preview draws them, the
  editor colours them and the export commands find them, like
  ` ```plantuml ` blocks. A document that used ` ```puml ` to show PlantUML
  source as code now shows the diagram instead.

### Changed

- **A block with two diagrams, or with `newpage`, says so instead of
  showing part of it.** The engine draws only the first diagram of a block
  and only the first page of a diagram, and the rest was left out without a
  message.
  The preview now explains that each diagram or page needs a block of its
  own, and export refuses the block rather than writing part of it.
- **Export asks before replacing a file that holds something else.** A file
  already at the target was overwritten without asking, even one put there by
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
  grammar claims every fence first. The grammar follows the syntax supported
  by the bundled engine: every command of every
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
  ` ```plantuml ` block became a diagram, so a document's diagrams could not
  be seen anywhere that does not render PlantUML itself — GitHub shows the
  block as source.
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

[Unreleased]: https://github.com/kkdev92/plantuml-local/compare/v0.17.1...HEAD
[0.17.1]: https://github.com/kkdev92/plantuml-local/compare/v0.17.0...v0.17.1
[0.17.0]: https://github.com/kkdev92/plantuml-local/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/kkdev92/plantuml-local/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/kkdev92/plantuml-local/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/kkdev92/plantuml-local/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/kkdev92/plantuml-local/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/kkdev92/plantuml-local/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/kkdev92/plantuml-local/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/kkdev92/plantuml-local/compare/v0.12.1...v0.13.0
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
