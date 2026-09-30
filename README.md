# pi-storyboard

A presentation-only Pi extension that turns collapsed tool activity into compact, source-ordered storyboards while preserving Pi's native tools and detailed views.

## Features

- Groups compatible `read`, `grep`/`find`, `ls`, `write`, `edit`, `bash`/`powershell`, custom, MCP, and subagent rows.
- Keeps tool calls in assistant source order and shows clear thinking/action branches.
- Shows compact running and failed states while hiding successful output, file contents, diffs, and images; failures expose one bounded, wrapped diagnostic on its own line.
- Renders a validated web-search completion status as wrapped plain-text detail under its exactly matched `web_search` row, or standalone when association is ambiguous; collapsed compaction summaries show a concise pre-compaction token count, while Pi retains the expanded native preview.
- Includes a `/storyboard-preview` gallery for the grouped-tool and turn-storyboard presentations.
- Includes `/storyboard-settings [global|project]` for interactive trimming, symbol, and color configuration.

## Install

For a local checkout:

```bash
pi -e ./src/index.ts
```

As a Pi package:

```bash
pi install ./path/to/pi-storyboard
```

## Preview

In interactive TUI mode, run:

```text
/storyboard-preview
```

Use `Turn storyboard` for the fixed storyboard reference or `Transcript replay` to inspect a small native-component transcript fixture. Press `Tab` to enter the preview, use `↑`/`↓` or PageUp/PageDown to browse, and press `Esc` to close.

## Settings

In interactive TUI mode, run `/storyboard-settings` to choose global or trusted project settings, or pass `global` or `project` directly. The page configures independent file/path, command, and custom-tool-argument trim modes (`none`, `middle`, or `end`), one `Show tool metadata` switch for timing and optional argument metadata, per-kind dots, thinking/branch symbols, and theme color tokens. Saving reloads the extension automatically. Settings are stored in `~/.pi/agent/pi-storyboard.json` or the trusted project’s `.pi/pi-storyboard.json`.

## Compatibility

Pi's core packages are optional peer dependencies and are not bundled. The extension is feature-detected and fails back to Pi's native transcript when the required component shape is unavailable. Expanded tool mode always restores Pi's complete native rendering.

For the implementation contract, architecture, safety invariants, compatibility notes, and maintainer workflow, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
