# Security Policy

## Supported Versions

| Version         | Supported          |
| --------------- | ------------------ |
| Latest release  | :white_check_mark: |
| Older releases  | :x:                |

Fixes ship in a new release rather than as patches to earlier versions.

## Reporting a Vulnerability

1. **Do NOT** create a public GitHub issue.
2. Open a private report:
   <https://github.com/kkdev92/plantuml-local/security/advisories/new>

   That is the **"Report a vulnerability"** button in this repository's Security
   tab; the link goes straight to it. Private reporting is enabled, so the
   advisory stays between us until there is a fix to describe.

Reports are looked at on a best-effort basis; please allow a reasonable disclosure window.

## Security Model

This extension is designed so that **diagram source is rendered locally and is not sent to an external service**. The measures below implement that design.

### Non-goals

State the limits up front, so the guarantees below are read for what they are:

- The render worker is an isolation boundary for JavaScript globals, **not a process- or OS-level security sandbox**. Code running in it has the same OS privileges as the extension host.
- Stubbing browser-style network APIs is not the same as closing every network path available to Node.js. It removes the paths the rendering engine actually uses; it is a hardening measure, not a kernel-level egress block.
- The extension is not a defence against a malicious VS Code extension, a compromised extension host, or a hostile machine.

### No network I/O

- The rendering engine (`@plantuml/core`), the Graphviz WebAssembly and all runtime assets ship inside the VSIX and are loaded from disk.
- **Network APIs are disabled inside the render worker**: `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource` are replaced with throwing stubs before the engine loads (`src/worker/network-guard.ts`). The engine files contain a small number of network call sites — one `XMLHttpRequest` in `plantuml.js` (the browser build's URL-include loader), plus the `fetch`/`XMLHttpRequest` fallbacks Emscripten emits in `viz-global.cjs` for loading a WebAssembly binary that is in practice embedded in the file. With the guard in place, reaching any of them fails the render instead of making a request.
- Neither bundle contains a rendering-service URL; `scripts/verify-vsix.mjs` checks every package for `plantuml.com/plantuml` / `kroki.io` references and CI runs it on each build.
- There is no telemetry of any kind.

### Rendering is isolated in a worker thread

The engine requires `window` / `document` globals. They are created inside a `worker_threads` worker, never on the extension host's `globalThis`, so no other extension's environment detection is affected, and a crashing render cannot take the extension host down. As noted under non-goals, this isolates globals and contains hung renders — it is not a security sandbox.

### The preview receives only sanitised, static SVG

The Markdown preview webview runs none of this extension's code — no `previewScripts` are contributed. Before an SVG leaves the worker it is parsed as `image/svg+xml` and stripped of:

- script-bearing elements (`<script>`, `<foreignObject>`, `<iframe>`, `<embed>`, `<object>`)
- event handler attributes (`on*`) — on every element including the root `<svg>`
- `href` / `xlink:href` / `src` values that are not in-document fragment references (`#…`) — this covers `javascript:` and `data:` URIs, and the `<a href>` / `<image href>` output of PlantUML's `[[url]]` hyperlink and `<img:url>` creole syntax
- processing instructions and comments. The engine appends a `plantuml-src` processing instruction to every SVG, holding the diagram source compressed but not encrypted: comments, preprocessor variables and the names of elements hidden with `hide` all decode back out of it. PlantUML's command line leaves it out with `-nometadata`; the browser engine this extension bundles has no such option
- `data-*` attributes, in which the engine records element names — aliases and elements hidden with `hide` among them — and the source line each element came from. Nothing draws them

The export commands write this same sanitised SVG, which matters most there: an exported file is shared with people who never see the Markdown. What the diagram itself draws — labels, names, notes — is of course still in the file; this removes what the engine adds on top of the drawing, and is not a way to anonymise a diagram.

Error messages and user source shown in error boxes are HTML-escaped.

#### The one exception: rasterised sprites

PlantUML draws `sprite` definitions — the mechanism behind icon sets such as Azure-PlantUML — by rasterising them and emitting the result as an inline PNG on an `<image>`. Stripping that link leaves an image element with no image, so the icon renders as blank space. The sanitiser therefore keeps a link value that meets **all** of the following:

- the element is `<image>`, and the attribute is `href` or `xlink:href` — never `<a href>`, so no navigation path is opened, and never `src`
- the value matches `data:image/png;base64,` followed only by base64 characters, so it cannot carry a second URI or break out of the attribute
- the payload begins with the PNG signature, so a `data:` URI merely *labelled* `image/png` does not qualify

`data:text/html`, `data:image/svg+xml`, `javascript:` and remote URLs remain blocked. The reasoning for allowing this much: a PNG cannot carry script the way an SVG can; the bytes are inline rather than fetched, so the network-egress concern behind the general rule does not apply; and the Markdown preview's default Content-Security-Policy already permits `img-src … data:` while confining scripts to a nonce.

#### The `.puml` preview panel

The preview of a `.puml` file is a webview of this extension's own, and runs one script, `media/viewer/viewer.js`. It receives the same sanitised SVG and shows it through an `<img>` holding a Blob URL, so the SVG is treated as an image: nothing in it can run, even something the sanitiser missed. The panel's Content-Security-Policy is `default-src 'none'` with scripts allowed by nonce only and images from the panel's own source, `data:` and `blob:`; it may load files from `media/viewer` only, and has forms disabled. The page acts only on messages carrying its own origin, which is how VS Code's frame around it delivers the extension's messages. The messages it sends back are untrusted input: only a ready notice and a choice among the file's diagrams are acted on. So is the state it keeps for a restart — the file's URI and the diagram's name, which the extension reads, and each diagram's zoom, which only the page does: a panel whose state does not hold a URI that opens is closed rather than restored, and a restored panel's options are set again rather than taken from the saved session.

#### The PNG panel

*Export Diagram as PNG* draws the PNG in a webview of this extension's own, since the extension host has no canvas. The page runs one script, `media/png/png.js`. It receives the same sanitised SVG and reads it as an image from a Blob URL, so nothing in it can run; it draws that image onto a canvas and sends the PNG back as bytes. The panel's Content-Security-Policy is `default-src 'none'` with scripts allowed by nonce only and images from the panel's own source, `data:` and `blob:`; it may load files from `media/png` only, and has forms disabled. It keeps its page while hidden behind another tab, so the PNG still comes back, and it is closed once it does, or after 30 seconds without it. The page acts only on messages carrying its own origin. What it sends back is untrusted input: only a ready notice, the PNG's bytes and an error are acted on, and the bytes are written only when they begin with the PNG signature and a header of the size that was asked for, and come to no more than 64 MiB.

### Remote references are rejected up front

`!include https://…` and `!theme … from https://…` never reach the engine; the block renders an explanatory message instead. Includes of a file are not supported by the browser build of the engine and fail harmlessly.

### The standard library is served from the package

`!include <azure/…>` resolves against a copy of the library baked into the VSIX. Left to itself the engine reacts to an unknown library by appending `<script src="azure.min.js">` to its document and waiting, which would mean either a network request or a render that hangs until the timeout. The worker pre-populates the globals the engine reads (`window.PLANTUML_STDLIB` and friends) so that path never runs, and makes any `<script>` the engine still creates report failure immediately — so `!include <aws/…>`, which is not bundled, produces a prompt error instead of a stalled render. The `!theme` library and the OpenIconic icons are served the same way: the worker loads the copies in the VSIX and marks them loaded, so the engine never asks for `themes.js` or `openiconic.js`. Emoji are not bundled, and a diagram using one fails at once with a message.

### Untrusted and virtual workspaces

The extension declares support for untrusted and virtual workspaces: it reads no workspace files, spawns no processes, and executes nothing from the workspace. The only input it processes is the text of ` ```plantuml ` fences, inside a worker, with the output sanitised as above.

Exporting is the one path that writes anything: the export commands write SVG and PNG files, and *Export All Diagrams and Update References* also edits the Markdown buffer. All of them refuse to run in an untrusted workspace, enforced by a runtime `workspace.isTrusted` check rather than by hiding the commands — a hidden command can still be invoked programmatically. Rendering and the preview are unaffected. The destination comes from `plantumlLocal.exportDirectory`, which must be a relative path without `..`, and file names come from the block's own name, restricted to letters, digits, hyphens and underscores; neither can be made to point outside the document's folder.

### Supply chain notes

- `@plantuml/core` is required at a range that starts no lower than 1.2026.6, the first MIT-licensed release (see `package.json`), and its engine files are copied into the package (no CDN at build or run time): `plantuml.js`, `viz-global.cjs` and the OpenIconic icons verbatim, and the `!theme` library rebuilt without the themes this extension does not ship. `package-lock.json` records the exact version each build used.
- Copyright and licence notices for every third-party component shipped in the VSIX are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with full licence texts under `third-party/`.
- happy-dom ships a self-signed TLS certificate (private key included) for HTTPS emulation in its fetch stack. This extension never uses that stack; the build replaces the certificate module with an empty stub, and `verify-vsix` fails the build if key material reappears in the bundle.

### Denial-of-service containment

Rendering pathological input is CPU-bound inside the worker, and renders are serialised, so a hung render would wedge the queue. Each render has a 30-second ceiling; on timeout the request fails, the worker is terminated and a fresh one serves the next request. The preview and the extension host stay responsive throughout.

## Known Limitations

- The engine itself is a large compiled artifact (TeaVM output); we treat it as trusted upstream code and constrain its version range.
- A hostile document can still waste CPU in 30-second increments (one worker thread at a time); it cannot block the editor.
- Text metrics in the worker are approximated, so rendered layout can differ slightly from a browser rendering of the same diagram. This is a fidelity limitation, not a security one, but it is worth knowing when comparing output against plantuml.com.
