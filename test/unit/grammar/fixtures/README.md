# Grammar test fixtures

These are grammars shipped with VS Code 1.138.0 (the lowest VS Code version
this extension supports), taken from
[microsoft/vscode](https://github.com/microsoft/vscode) at tag `1.138.0`. The
tests use them only to check how the PlantUML grammars behave where VS Code
combines them with its own; none of them is packaged.

| File | From | Origin and licence |
| --- | --- | --- |
| `markdown.tmLanguage.json` | `extensions/markdown-basics/syntaxes/` | Converted from [microsoft/vscode-markdown-tm-grammar](https://github.com/microsoft/vscode-markdown-tm-grammar) (MIT License, Copyright (c) Microsoft 2018), which derives from [textmate/markdown.tmbundle](https://github.com/textmate/markdown.tmbundle) ("Permission to copy, use, modify, sell and distribute this software is granted. This software is provided "as is" without express or implied warranty, and with no claim as to its suitability for any purpose.") |
| `JSON.tmLanguage.json` | `extensions/json/syntaxes/` | Converted from [microsoft/vscode-JSON.tmLanguage](https://github.com/microsoft/vscode-JSON.tmLanguage) (MIT License, Copyright (c) Microsoft Corporation) |
| `yaml.tmLanguage.json`, `yaml-1.0`/`1.1`/`1.2`/`1.3.tmLanguage.json`, `yaml-embedded.tmLanguage.json` | `extensions/yaml/syntaxes/` | From [RedCMD/YAML-Syntax-Highlighter](https://github.com/RedCMD/YAML-Syntax-Highlighter) (MIT License, Copyright 2024 RedCMD) |

`fence-catch-all.tmLanguage.json` is not one of VS Code's grammars. It stands
in for an extension that injects into Markdown a rule taking every fence,
whatever its language: VS Code's own rule for a fence of an
unknown language, `fenced_code_block_unknown` from `markdown.tmLanguage.json`
above, as an injection with the same priority as this extension's.
