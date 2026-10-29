---
name: Bug Report
about: Report a bug to help improve PlantUML Local
title: '[Bug] '
labels: bug
assignees: ''
---

## Environment

- **OS**: (e.g., Windows 11, macOS 15, Ubuntu 24.04)
- **VS Code Version**: (e.g., 1.144.0)
- **PlantUML Local Version**: (e.g., 0.1.0)

## Description

A clear description of the bug.

## Minimal PlantUML Source

The smallest ` ```plantuml ` block, or `.puml` file, that reproduces the issue:

````markdown
```plantuml
@startuml
...
@enduml
```
````

## Expected Behavior

What you expected to happen (e.g., how the diagram renders on plantuml.com or with local Java).

## Actual Behavior

What actually happened (broken layout, error box, stuck on "Rendering diagram…", …).

## Logs

Run **Developer: Set Log Level**, pick *PlantUML Local* and choose Debug, and set `plantumlLocal.logLevel` to `debug` (its default, `info`, holds back the rendering entries at Debug). Reproduce, and paste relevant lines from *View → Output → PlantUML Local*.

## Additional Context

Anything else that seems relevant (colour theme, other Markdown extensions, workspace trust state, …).
