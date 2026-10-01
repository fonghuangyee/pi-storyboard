# Pi settings customization plan

> **Status: implemented.** This document records the implementation contract for the presentation-only settings feature. The authoritative implemented design belongs in [`ARCHITECTURE.md`](ARCHITECTURE.md).

This feature must not change scene ownership, tool eligibility, source order, native fallback, messages, session entries, model behavior, or the complete details available through Pi's native expansion.

## User-facing goals

The first settings version should support:

1. independent `none`/`middle`/`end` trimming modes for file/path values, shell commands, and generic tool arguments;
2. one `showToolMetadata` switch for optional timing and tool-argument metadata;
3. one `showToolResultSummary` switch for a bounded line of successful tool-result text, defaulting to visible;
4. configurable storyboard symbols, including per-tool-kind dots and thinking/rail/branch symbols;
5. configurable lifecycle/status colors and one structural color for the vertical rail and `L`-shaped branch markers;
6. an interactive `/storyboard-settings [global|project]` TUI page that saves the dedicated settings file and reloads Pi.

The defaults must produce the current output:

```json
{
  "trimming": {
    "fileNames": "middle",
    "commands": "middle",
    "tools": "middle"
  },
  "showToolMetadata": true,
  "showToolResultSummary": true,
  "symbols": {
    "toolDot": "●",
    "toolDots": {
      "read": "●",
      "search": "●",
      "list": "●",
      "write": "●",
      "edit": "●",
      "command": "●",
      "tool": "●"
    },
    "thinkingRoot": "◉",
    "thinkingStep": "○",
    "thinkingPlaceholder": "Thinking...",
    "hiddenThinking": "↳",
    "rail": "│",
    "branch": "├─",
    "lastBranch": "╰─"
  },
  "colors": {
    "status": {
      "running": "syntaxKeyword",
      "complete": "success",
      "failed": "error",
      "note": "muted"
    },
    "thinking": {
      "active": "syntaxKeyword",
      "settled": "success"
    },
    "structure": "muted"
  }
}
```

`toolDots` is optional; an absent kind-specific value falls back to `toolDot`. This object is stored as the complete contents of the dedicated `pi-storyboard.json` file, not inside Pi's general `settings.json`.

## Pi settings integration and interactive page

Storyboard settings are dedicated files: global at `~/.pi/agent/pi-storyboard.json` and project-local at `.pi/pi-storyboard.json`, with project values overriding global values. The project-local file is ignored when `ctx.isProjectTrusted()` is false. Pi's general `settings.json` files are not modified.

The current Pi API exposes `SettingsManager.create()` publicly but not a settings manager on `ExtensionContext`. `src/presentation-settings-store.ts` creates the public manager at `session_start` for trust detection, then reads the dedicated files into an immutable `PresentationSettings` snapshot. It never uses private context/session fields for reads.

`/storyboard-settings` is available only in interactive TUI mode. With no argument it asks for `global` or trusted `project` scope; either argument selects that scope directly. The page uses `SettingsList` plus text-input submenus for symbols. It exposes all three trimming switches, the `showToolMetadata` and `showToolResultSummary` switches, the default and per-kind dots, thinking/placeholder/rail/branch symbols, all status/thinking/structure color tokens, reset-to-defaults, and Save and reload. Escape cancels without writing.

On explicit Save, the store validates the complete settings object and atomically replaces only the selected dedicated `pi-storyboard.json` file. This is the sole filesystem write in the extension and never runs in the renderer, lifecycle listeners, or background work. A successful save calls `ctx.reload()`; the new session lifecycle creates the active snapshot. An unavailable, malformed, or incompatible settings API uses the current defaults and does not disable storyboard rendering.

## Configuration validation and fallback

`src/presentation-settings.ts` contains the Pi-independent defaults, types, layered merge, and validation. It accepts unknown JSON and returns a complete immutable snapshot. Invalid fields fall back independently instead of invalidating the whole configuration.

- Trimming values must be `none`, `middle`, or `end`; legacy booleans remain readable for migration.
- `showToolMetadata` and `showToolResultSummary` must be booleans; invalid values fall back independently to the corresponding lower-precedence or built-in value.
- Symbols must be single-line, terminal-control-free, bounded display strings. Reject or default values containing ANSI/control sequences, line breaks, or excessive visible width. Do not allow settings to inject raw ANSI styling.
- Color settings must be references to an allowlisted Pi theme color token, not raw ANSI or arbitrary escape sequences. Users who need a particular RGB value should define it in a Pi theme and select that theme token here.
- Unknown group kinds, color names, nulls, malformed nested objects, and invalid strings use the nearest default; invalid project fields inherit the corresponding validated global field.
- Settings errors must never become a reason to mutate Pi data or to bypass the existing native fallback rules.

## Trimming semantics

`src/renderer.ts` classifies the display segments before fitting them. `trimming.fileNames` controls only path/filename values used by Read, List, Write, Edit, and Search. `trimming.commands` controls only the Bash/PowerShell command value. `trimming.tools` controls only compact JSON arguments for custom, MCP, and subagent tools. Each field accepts `none`, `middle`, or `end`; offsets, limits, search metadata, replacement counts, `cwd`, timing, error diagnostics, and the separate result-summary policy are not trimming targets.

`middle` keeps both a useful prefix and filename/command/argument tail, `end` keeps the beginning and adds an end ellipsis, and `none` preserves the complete target value by wrapping it across lines. Non-target metadata remains complete and wraps instead of being shortened. Failed diagnostics and successful result summaries appear on separate indented lines without a `-` prefix and wrap without applying trim modes; each retained line is capped at 512 Unicode code points. A successful summary selects the last non-empty useful text line, excluding only structural punctuation and common timing footers; it is sanitized, shown by default, and hidden when `showToolResultSummary` is false. It may expose a short excerpt of read-file or command output; complete result blocks, `details`, write arguments/content, edit text/diffs, and image data are never copied. When `showToolMetadata` is false, the renderer hides optional timing and argument metadata suffixes as one group while retaining the primary value, result summary, and diagnostics. Every returned line remains within the terminal width. The previous boolean trimming schema remains readable for migration (`true` maps to `middle`, `false` maps to `none`), while saved settings use the string modes.

## Symbol and color rendering

The settings snapshot should be passed into the renderers as data; it must not enter `storyboard.ts` ownership or `session-projection.ts` matching logic.

- `renderer.ts` uses the resolved per-kind dot and the status color for running, complete, and failed tool rows.
- `storyboard-renderer.ts` uses the configured thinking root/step symbols, hidden-thinking symbol, placeholder label, rail, branch, and last-branch symbols.
- `colors.status` controls scene/action status markers while preserving the existing running > failed > complete > note state model.
- `colors.thinking` keeps thinking lifecycle separate from tool outcome: active thinking uses `active`, settled thinking uses `settled`, and a failed tool must not recolor an otherwise settled thinking marker as an error.
- `colors.structure` applies to `│`, `├─`, and `╰─`, including continuation prefixes. The compact dot remains a status marker, not a structural line.
- Layout prefixes and mouse regions must measure the configured symbols with `visibleWidth()` instead of assuming the widths of `◉`, `○`, `│`, `├─`, or `╰─`. Every configured variant must retain the existing width and mouse-coordinate guarantees.
- The presentation-only `Thinking...` label may change text, but it remains presentation-only and keeps Pi's thinking text style; it never becomes a message, session entry, or inferred reasoning block.

## Implementation map

- `src/index.ts`: registers `/storyboard-settings`, loads the snapshot at the session lifecycle boundary, and provides it to the guarded patch while continuing to invalidate only session projection state on transcript events.
- `src/presentation-settings.ts`: owns defaults, layered settings merging, allowlists, symbol sanitization, and immutable fallback behavior.
- `src/presentation-settings-store.ts`: owns public `SettingsManager` trust detection, dedicated-file reads, trusted scope handling, and atomic settings-file replacement.
- `src/presentation-settings-ui.ts`: owns the interactive TUI page and draft editing; it does not decide semantic ownership.
- `src/pi-adapter.ts`: threads the snapshot through the existing guarded render path without using settings for ownership decisions; all private Pi/TUI inspection and mouse-layout patching remains here.
- `src/renderer.ts`: applies field-aware `none`/`middle`/`end` trimming to file/path, command, and generic-tool-argument values, applies `showToolMetadata` and `showToolResultSummary`, wraps complete metadata, bounded result summaries, and diagnostics, and preserves configurable per-kind dots and width checks.
- `src/storyboard-renderer.ts`: applies resolved markers/colors and recalculates prefix widths, rails, closure, placeholders, and mouse translations.
- `src/tui-preview.ts`: includes a fixed defaults/custom-settings gallery without reading or writing user settings.
- `src/storyboard.ts`, `src/grouping.ts`, and `src/session-projection.ts`: do not use presentation settings for semantic grouping, ownership, or active-path validation.

## Verification status

Implemented and covered by focused tests:

- a new settings test suite for defaults, global/project precedence, untrusted project settings, per-field invalid fallback, control-character rejection, color-token validation, and immutable snapshots;
- renderer cases proving file-name, command, and generic-tool-argument modes are independent, the detail switches hide optional metadata and successful-result summaries, summaries and diagnostics are separate and untrimmed, metadata wraps without shortening, `middle` preserves both target ends, `end` truncates only the target tail, all modes remain width-safe at widths 1–200, and result-safety rules hold;
- storyboard-renderer cases for every configurable marker, per-kind dots, custom marker widths, custom status/thinking/structure colors, long thinking summaries, commentary suffixes, closure, and narrow terminals;
- adapter cases proving settings are threaded without mutating Pi objects, are refreshed across session reload/replacement, keep native expansion/fallback behavior unchanged, and preserve mouse translation;
- preview coverage includes the configured/default fixture gallery;
- manual verification remains required for global versus project settings, project trust, `/storyboard-settings [global|project]`, `/reload`, live theme changes, expanded rows, streaming rows, Unicode symbols, and coexistence with another transcript patcher.

Acceptance is met when absent or malformed settings produce the current presentation, valid settings affect only collapsed storyboard output, only path/filename, command, and generic-tool-argument targets are trimmed, `showToolMetadata` toggles optional metadata and `showToolResultSummary` independently toggles bounded successful-result lines (default on), metadata, result summaries, and diagnostics wrap without shortening, summary/diagnostic lines appear separately without a `-` prefix, every line remains within the terminal width, Save changes only the selected dedicated settings file, and all ownership/privacy/native-fallback tests continue to pass. Any future behavior change must update `docs/ARCHITECTURE.md`, this contract, the marketplace-facing README, preview fixtures, and compatibility/test matrices together, then run `npm run check` and `npm run package:check`.
