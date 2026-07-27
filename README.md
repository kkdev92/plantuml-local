# PlantUML Local

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/kkdev92/plantuml-local/actions/workflows/ci.yml/badge.svg)](https://github.com/kkdev92/plantuml-local/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/kkdev92.plantuml-local)](https://marketplace.visualstudio.com/items?itemName=kkdev92.plantuml-local)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

Render ```` ```plantuml ```` code blocks in the built-in Markdown preview — no Java, no server, no network.
Your diagram source never leaves your machine.
*Built for design docs you can't send anywhere — write, preview, done.*

> **Status:** Active (best-effort maintenance)

![Rendered use-case and sequence diagrams](images/demo.png)

---

## Table of Contents

- [Why PlantUML Local](#why-plantuml-local)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Configuration](#configuration)
- [How It Works](#how-it-works)
- [Platform Requirements](#platform-requirements)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Support & Maintenance Policy](#support--maintenance-policy)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Why PlantUML Local

Previewing PlantUML in VS Code usually means installing Java or sending your diagrams to a server.
PlantUML Local keeps it simple: **write → preview → rendered on your machine**.

Every existing option requires one of the two (verified by unpacking each VSIX):

| Extension | Rendering method |
| --- | --- |
| `jebbs.plantuml` | Local Java (`plantuml.jar`) or a PlantUML server |
| `myml.vscode-markdown-plantuml-preview` | Sends your source to `www.plantuml.com` |

The widely used `markdown-it-plantuml` plugin encodes your diagram into a URL and lets the public PlantUML server render it — your source goes out on every preview. That's a hard no for internal design documents.

This extension bundles [`@plantuml/core`](https://www.npmjs.com/package/@plantuml/core) — the official PlantUML engine compiled to JavaScript and WebAssembly — so everything renders locally.

---

## Features

- **Built-in Preview**: Diagrams appear in the same Markdown preview you already use (`Ctrl+Shift+V`)
- **Fully Offline**: No Java, no PlantUML server, no network access — nothing to install besides the extension
- **Fault-Tolerant**: A syntax error shows up inline at the broken diagram; the rest of the page stays intact
- **Multi-Diagram Pages**: Any number of diagrams per page; renders are serialised so results never mix
- **Dark-Mode Aware**: Diagrams re-render to match your colour theme, or pin the palette via settings
- **CJK-Ready**: Full-width text (Japanese and more) renders correctly
- **Non-Intrusive**: All other fenced code blocks (` ```js `, ` ```mermaid `, …) are left untouched
- **Secure by Design**: Rendering is isolated in a worker; only sanitised SVG reaches the preview

---

## Installation

### Install from VS Code Marketplace (recommended)

- Open the Extensions view (`Ctrl+Shift+X`)
- Search for **PlantUML Local**
- Click **Install**

You can also open the Marketplace page directly:

- <https://marketplace.visualstudio.com/items?itemName=kkdev92.plantuml-local>

### Build from Source (for contributors)

> If you just want to use PlantUML Local, installing from the Marketplace is the easiest option.

```bash
git clone https://github.com/kkdev92/plantuml-local.git
cd plantuml-local
npm install
npm run install-local
```

---

## Quick Start

1. Open any Markdown file
2. Add a fenced code block with the `plantuml` language:

   ````markdown
   ```plantuml
   @startuml
   Alice -> Bob : Hello
   @enduml
   ```
   ````

3. Open the preview (`Ctrl+Shift+V`)
4. The block renders as a diagram — edit and save, and it follows

See [sample.md](sample.md) for a tour of diagram types, including error handling.

---

## Usage

Sequence, use-case, class, state, activity, component diagrams and everything else the PlantUML engine supports will render.

The first diagram after startup takes ~0.4 s (WebAssembly initialisation); subsequent renders take tens of milliseconds. If a diagram looks stale, run `PlantUML Local: Clear Render Cache and Re-render` from the Command Palette.

---

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `plantumlLocal.theme` | `auto` | Diagram palette. `auto` follows the VS Code theme; `light` / `dark` pin it |
| `plantumlLocal.logLevel` | `info` | Log level for the *PlantUML Local* output channel |

---

## How It Works

Rendering inside the preview webview — the way Mermaid extensions work — is impossible for PlantUML: use-case, class and state layouts come from Graphviz, which ships as WebAssembly, and the preview's Content-Security-Policy has no `wasm-unsafe-eval`:

```text
default-src 'none'; … script-src 'nonce-${nonce}'; …
```

So the engine runs in a **worker thread on the extension host** (no CSP there), and only the finished, sanitised SVG is injected into the preview. The preview runs no scripts on this extension's behalf — which is also why no network access can happen there.

markdown-it's `fence` rule is synchronous while rendering is not; they meet through a cache: the first pass shows a placeholder and starts rendering, completion triggers one debounced preview refresh, and the second pass serves the SVG from cache.

---

## Platform Requirements

- VS Code 1.96 or later
- Windows / macOS / Linux, x64 or ARM64

That's it — no Java runtime, no Graphviz install, no external tools.

---

## Security

This extension is built around one promise: **diagram source never leaves the machine**.

- **No Network I/O**: The engine and all assets ship inside the VSIX and load from disk; there is no telemetry
- **Fail-Closed Networking**: `fetch` / `XMLHttpRequest` / `WebSocket` are stubbed to throw inside the render worker — a network attempt fails the render instead of making a request
- **Worker Isolation**: The engine's browser shims live in a worker thread, never on the extension host globals; hung renders are killed after 30 s and the worker restarts
- **SVG Sanitisation**: Scripts, event handlers and non-fragment links are stripped before SVG reaches the preview
- **Remote Includes Refused**: `!include https://…` / `!theme … from https://…` render an explanatory message instead
- **Untrusted Workspaces Supported**: No workspace files are read, no processes are spawned

CI verifies each package: `verify-vsix` unpacks the VSIX, checks for leaked secrets and rendering-service URLs, and renders a diagram from the packaged worker.

For security concerns, please see [SECURITY.md](SECURITY.md).

---

## Troubleshooting

- **Stuck on "Rendering diagram…"**: Check *Output → PlantUML Local* for worker errors, then run `PlantUML Local: Clear Render Cache and Re-render`
- **A red syntax-error box appears**: The message comes from the PlantUML engine and names the offending line — only that diagram is affected
- **Colours look wrong after switching themes**: Backgrounds follow the palette the diagram was *rendered* with. If you pinned `plantumlLocal.theme`, that palette wins by design
- **Boxes slightly wider/narrower than plantuml.com**: Text metrics are approximate (Node has no Canvas); layout is otherwise identical

---

## Contributing

Contributions are welcome — thank you for helping make PlantUML Local better 🙌
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

If you're planning a larger change, opening an issue first is appreciated (it helps align direction and avoids duplicate work). Note that features requiring Java, a server or network access are out of scope by design.

---

## Support & Maintenance Policy

PlantUML Local is a personal hobby project maintained in spare time.
I'll do my best to review issues and PRs, but responses and releases may be a bit slow sometimes — thank you for your patience.

Helpful things when reporting bugs:

- OS / VS Code version
- The smallest PlantUML source that reproduces the issue
- Output from *Output → PlantUML Local* at `logLevel: debug`

Security-related reports should follow [SECURITY.md](SECURITY.md).
Really appreciate you using PlantUML Local 💛

---

## License

MIT License - see [LICENSE](LICENSE) for details.

The bundled engine `@plantuml/core` is MIT for versions ≥ 1.2026.6 (earlier versions are GPL-3.0-or-later; npm shows only the latest version's licence, so this extension pins `^1.2026.6`).

---

## Acknowledgments

- Diagram rendering powered by [PlantUML](https://plantuml.com/) and its [`@plantuml/core`](https://www.npmjs.com/package/@plantuml/core) TeaVM build — this extension is a third-party project, not affiliated with or endorsed by the PlantUML project
- Graphviz layout by [Viz.js](https://github.com/mdaines/viz-js) (bundled inside `@plantuml/core`)
- DOM for the engine by [happy-dom](https://github.com/capricorn86/happy-dom)
- Extension utilities by [@kkdev92/vscode-ext-kit](https://github.com/kkdev92/vscode-ext-kit)
