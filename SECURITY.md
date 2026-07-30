# Security Policy

## Supported Versions

| Version         | Supported          |
| --------------- | ------------------ |
| Latest release  | :white_check_mark: |
| Older releases  | :x:                |

Fixes ship in a new release rather than as patches to earlier versions.

## Reporting a Vulnerability

1. **Do NOT** create a public GitHub issue.
2. Use GitHub's **"Report a vulnerability"** feature in the Security tab of this repository.

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

### Remote references are rejected up front

`!include https://…` and `!theme … from https://…` never reach the engine; the block renders an explanatory message instead. Local-file includes are not supported by the browser build of the engine and fail harmlessly.

### Untrusted and virtual workspaces

The extension declares support for untrusted and virtual workspaces: it reads no workspace files, spawns no processes, and executes nothing from the workspace. The only input it processes is the text of ` ```plantuml ` fences, inside a worker, with the output sanitised as above.

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
