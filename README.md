# pi-storyboard

A presentation-only Pi extension that turns eligible collapsed tool activity into compact, source-ordered storyboards while leaving tools, messages, and detailed views under Pi's control.

## Features

- Groups compatible `read`, `grep`/`find`, `ls`, `write`, `edit`, `bash`/`powershell`, custom, MCP, and subagent rows.
- Preserves assistant source order and native thinking/commentary. Eligible tool scenes with absent or empty source thinking get a fixed `Thinking...` presentation label—not generated reasoning; consecutive settled tool-only responses can share one label when active-path ownership and boundaries are proven.
- Shows compact running and failed states, a wrapped failure diagnostic, and one sanitized, bounded successful-result excerpt by default. Excerpts may contain file or command output; disable them in settings if preferred. Full details remain available through Pi's native expansion.
- Gives default text-only custom messages and plain transcript status rows a full-text Storyboard view. Collapsed skill invocations appear as one configurable-color `◉ Skill loaded: name` row (yellow/amber by default) using the standard master-node symbol. Recognized web-search statuses and collapsed compaction summaries retain their specialized layouts.
- Offers configurable trimming, metadata visibility, result-summary visibility, symbols, and colors.

## Install

From npm (after the first release is published):

```bash
pi install npm:pi-storyboard
```

Or install a local checkout:

```bash
pi install ./path/to/pi-storyboard
```

To try a checkout without installing: `pi -e ./src/index.ts`.

## Keyboard shortcut

Press **Option+O** on macOS (Pi key ID `alt+o`) to switch between Storyboard and Pi’s native view. Storyboard starts on for each session. Pi’s **Ctrl+O** still controls native compact/detail rendering; changing views does not reset it. If your macOS terminal types a character instead, enable **Option as Meta**.

## Settings

In interactive TUI mode, run `/storyboard-settings` to open the global settings page (`/storyboard-settings global` is also accepted). The command edits only `~/.pi/agent/pi-storyboard.json`; `project` is not a supported command argument. Trusted project settings in `.pi/pi-storyboard.json` can still override global values.

Configure independent file/path, command, and custom-tool-argument trimming (`none`, `middle`, or `end`), optional tool metadata, successful-result excerpts, per-kind dots, symbols, and theme color tokens, including **Skill invocation color** (default: `warning`). Result excerpts are enabled by default. Saving reloads Pi so the settings take effect.

## Compatibility

Automated compatibility checks target Pi **1.6.0**; live interactive release verification remains pending. Plain-text cache-warming notices use the general Storyboard view when safely recognized in the transcript.

Pi core packages are optional peer dependencies and are not bundled. The extension feature-detects the native transcript components and falls back to Pi's renderer when required shapes are unavailable. Expanded tool mode always restores Pi's complete native rendering. Expanded skills also use Pi's native view; clicking a collapsed skill block or using Pi's configured expansion action preserves access to the full instructions. Opaque, interactive, custom-rendered, Markdown-transformed, multimedia, and incompatible content also stays native; this extension does not guarantee zero native previews. The input editor, footer, menus, dialogs, and Pi's built-in settings are unchanged.

For the implementation contract, safety rules, compatibility notes, and maintainer workflow, see [development documentation](https://github.com/fonghuangyee/pi-storyboard/blob/main/docs/ARCHITECTURE.md).
