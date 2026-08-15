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

Error messages and user source shown in error boxes are HTML-escaped.

#### The one exception: rasterised sprites

PlantUML draws `sprite` definitions — the mechanism behind icon sets such as Azure-PlantUML — by rasterising them and emitting the result as an inline PNG on an `<image>`. Stripping that link leaves an image element with no image, so the icon renders as blank space. The sanitiser therefore keeps a link value that meets **all** of the following:

- the element is `<image>`, and the attribute is `href` or `xlink:href` — never `<a href>`, so no navigation path is opened, and never `src`
- the value matches `data:image/png;base64,` followed only by base64 characters, so it cannot carry a second URI or break out of the attribute
- the payload begins with the PNG signature, so a `data:` URI merely *labelled* `image/png` does not qualify

`data:text/html`, `data:image/svg+xml`, `javascript:` and remote URLs remain blocked. The reasoning for allowing this much: a PNG cannot carry script the way an SVG can; the bytes are inline rather than fetched, so the network-egress concern behind the general rule does not apply; and the Markdown preview's default Content-Security-Policy already permits `img-src … data:` while confining scripts to a nonce.

### Remote references are rejected up front

`!include https://…` and `!theme … from https://…` never reach the engine; the block renders an explanatory message instead. Includes of a file are not supported by the browser build of the engine and fail harmlessly.

### The standard library is served from the package

`!include <azure/…>` resolves against a copy of the library baked into the VSIX. Left to itself the engine reacts to an unknown library by appending `<script src="azure.min.js">` to its document and waiting, which would mean either a network request or a render that hangs until the timeout. The worker pre-populates the globals the engine reads (`window.PLANTUML_STDLIB` and friends) so that path never runs, and makes any `<script>` the engine still creates report failure immediately — so `!include <aws/…>`, which is not bundled, produces a prompt error instead of a stalled render.

### Untrusted and virtual workspaces

The extension declares support for untrusted and virtual workspaces: it reads no workspace files, spawns no processes, and executes nothing from the workspace. The only input it processes is the text of ` ```plantuml ` fences, inside a worker, with the output sanitised as above.

Exporting is the one path that writes anything: the export commands write SVG files, and *Export All Diagrams and Update References* also edits the Markdown buffer. All three refuse to run in an untrusted workspace, enforced by a runtime `workspace.isTrusted` check rather than by hiding the commands — a hidden command can still be invoked programmatically. Rendering and the preview are unaffected. The destination comes from `plantumlLocal.exportDirectory`, which must be a relative path without `..`, and file names come from the block's own name, restricted to letters, digits, hyphens and underscores; neither can be made to point outside the document's folder.

### Supply chain notes

- `@plantuml/core` is required at `^1.2026.6` — 1.2026.6 is the first MIT-licensed release — and its two engine files are copied verbatim into the package (no CDN at build or run time). `package-lock.json` records the exact version each build used.
- Copyright and licence notices for every third-party component shipped in the VSIX are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with full licence texts under `third-party/`.
- happy-dom ships a self-signed TLS certificate (private key included) for HTTPS emulation in its fetch stack. This extension never uses that stack; the build replaces the certificate module with an empty stub, and `verify-vsix` fails the build if key material reappears in the bundle.

### Denial-of-service containment

Rendering pathological input is CPU-bound inside the worker, and renders are serialised, so a hung render would wedge the queue. Each render has a 30-second ceiling; on timeout the request fails, the worker is terminated and a fresh one serves the next request. The preview and the extension host stay responsive throughout.

## Known Limitations

- The engine itself is a large compiled artifact (TeaVM output); we treat it as trusted upstream code and constrain its version range.
- A hostile document can still waste CPU in 30-second increments (one worker thread at a time); it cannot block the editor.
- Text metrics in the worker are approximated, so rendered layout can differ slightly from a browser rendering of the same diagram. This is a fidelity limitation, not a security one, but it is worth knowing when comparing output against plantuml.com.
