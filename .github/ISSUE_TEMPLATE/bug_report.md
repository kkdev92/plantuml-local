---
name: Bug Report
about: Report a bug to help improve PlantUML Local
title: '[Bug] '
labels: bug
assignees: ''
---

## Environment

- **OS**: (e.g., Windows 11, macOS 15, Ubuntu 24.04)
- **VS Code Version**: (e.g., 1.130.0)
- **PlantUML Local Version**: (e.g., 0.1.0)

## Description

A clear description of the bug.

## Minimal PlantUML Source

The smallest ` ```plantuml ` block that reproduces the issue:

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

Set `plantumlLocal.logLevel` to `debug`, reproduce, and paste relevant lines from *View → Output → PlantUML Local*.

## Additional Context

Anything else that seems relevant (colour theme, other Markdown extensions, workspace trust state, …).
