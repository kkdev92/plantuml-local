# Threat model for PlantUML Local

## Purpose and attack surface

PlantUML Local is a VS Code extension that renders PlantUML diagrams from Markdown
code fences and PlantUML documents locally, without a rendering service. It also
supports workspace-local includes, interactive previews, and SVG/PNG exports.

Treat diagram source, Markdown content, workspace files, file paths, configuration
values, and webview messages as potentially attacker-controlled. A user may open
an untrusted repository containing malicious diagram syntax.

## Security goals and trust boundaries

- Diagram rendering happens in a Node.js worker thread. The worker isolates JS
  globals and is replaced after failures/timeouts, but is **not** an OS sandbox.
- A diagram must not cause executable HTML, script, event handlers, dangerous
  links, or unexpected external resources to reach a preview or exported SVG.
- The host mediates file includes. In trusted workspaces, allowed local includes
  must stay within the active workspace root after path and symlink checks;
  remote references and disallowed file types must not bypass these restrictions.
- Restricted/untrusted and virtual workspaces must not read local include files.
- Export operations must honor workspace trust, safe target paths, and overwrite
  protections; untrusted diagram input must not cause arbitrary local writes.
- The renderer should not initiate unintended network requests. Browser-style
  network APIs are stubbed as a hardening measure, not a kernel-level guarantee
  that all Node.js network access is impossible.
- Excessive work or malformed WASM/diagram inputs should not indefinitely stall
  rendering, poison later requests, or destabilize the extension host.
- Webview message handlers, saved panel state, and PNG validation are untrusted
  input boundaries and must not permit filesystem access or code execution.

## High-value areas to audit

1. `src/worker/sanitize.ts`: SVG namespace tricks, active content, URI schemes,
   sprite PNG data URIs, metadata disclosure, and unsafe exported SVG.
2. `src/includes/`: include recursion, canonical paths, symbolic links/junctions,
   traversal, platform-specific path handling, and trust-state changes.
3. `src/export/`, `src/viewer/`, and `src/preview/`: destination confinement,
   overwrite authorization, Markdown edits, CSP, and webview message validation.
4. `src/worker/`, `src/render/`: malformed input, 30-second render limits,
   queue recovery, worker restarts, and resource exhaustion.
5. Bundled PlantUML / Graphviz runtime, and build/packaging scripts:
   exploitation through realistic untrusted diagram data, rather than merely
   listing theoretical or unreachable dependency advisories.

## Exercising the project

- Runtime: Node.js 24, TypeScript, VS Code extension APIs, a PlantUML browser
  runtime and Graphviz WebAssembly bundled in the compiled output.
- Build context: `/src`; `npm ci` downloads dependencies during the Docker build.
- Tests: `npm run test:unit`, `npm run test:integration`, or `npm test`.
  Integration tests build the distribution bundles and render real diagrams.
- Test suites are under `test/unit/` and `test/integration/`.
- The finished scanner environment has no Internet access; use the installed
  dependencies and compiled output to reproduce issues locally.

## Severity guidance

- **Critical:** demonstrated code execution in the extension host or unintended
  disclosure of sensitive user data to an attacker from realistic diagram input.
- **High:** exploitable active content in rendered or exported SVG, arbitrary
  file read/write outside the intended workspace or other meaningful trust
  boundary bypass with a plausible attacker-controlled input path.
- **Medium:** reproducible availability or integrity flaws with a meaningful
  impact beyond the documented worker recovery and input limits.
- **Low:** well-supported hardening opportunities without a credible security
  boundary breach. Rate other findings by the actual prerequisites and impact.

## Reporting guidance / non-goals

- Provide a minimal malicious `.puml` or Markdown fixture, precise reproduction
  instructions, the relevant trust mode, affected platform, and a proposed fix.
- Verify that payloads work against this project's sanitization and include
  policies; avoid speculative findings based solely on upstream capabilities.
- Reading a permitted file inside a *trusted* workspace is not a vulnerability
  by itself. The worker is not promised to be a separate-process sandbox.
- A malicious VS Code extension, already-compromised extension host, or hostile
  operating system is outside this project's stated security guarantees.
- Do not publish working exploits or private vulnerability details as public
  GitHub issues. See `SECURITY.md` for private disclosure.
