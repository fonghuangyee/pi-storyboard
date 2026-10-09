# pi-storyboard

A presentation-only Pi extension that turns eligible collapsed tool activity into compact, source-ordered storyboards while leaving tools, messages, and detailed views under Pi's control.

## Features

- Groups compatible `read`, `grep`/`find`, `ls`, `write`, `edit`, `bash`/`powershell`, custom, MCP, and subagent rows.
- Preserves assistant source order and native thinking/commentary. Eligible tool scenes with absent or empty source thinking get a fixed `Thinking...` presentation label—not generated reasoning; consecutive settled tool-only responses can share one label when active-path ownership and boundaries are proven.
- Shows compact running and failed states, a wrapped failure diagnostic, and one sanitized, bounded successful-result excerpt by default. Excerpts may contain file or command output; disable them in settings if preferred. Full details remain available through Pi's native expansion.
- Displays recognized web-search status as plain text only when its exact tool association is proven; otherwise it stays standalone. Collapsed compaction summaries show a concise token count, with Pi's native preview available when expanded.
- Offers configurable trimming, metadata visibility, result-summary visibility, symbols, and colors.

## Install

For a local checkout:

```bash
pi -e ./src/index.ts
```

As a Pi package:

```bash
pi install ./path/to/pi-storyboard
```

## Settings

In interactive TUI mode, run `/storyboard-settings` to open the global settings page (`/storyboard-settings global` is also accepted). The command edits only `~/.pi/agent/pi-storyboard.json`; `project` is not a supported command argument. Trusted project settings in `.pi/pi-storyboard.json` can still override global values.

Configure independent file/path, command, and custom-tool-argument trimming (`none`, `middle`, or `end`), optional tool metadata, successful-result excerpts, per-kind dots, symbols, and theme color tokens. Result excerpts are enabled by default. Saving reloads Pi so the settings take effect.

## Compatibility

Pi core packages are optional peer dependencies and are not bundled. The extension feature-detects the native transcript components and falls back to Pi's renderer when required shapes are unavailable. Expanded tool mode always restores Pi's complete native rendering.

For the implementation contract, safety rules, compatibility notes, and maintainer workflow, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
