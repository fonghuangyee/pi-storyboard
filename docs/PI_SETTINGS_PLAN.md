# Pi settings customization plan

> **Status: not currently shipped.** This document describes the proposed presentation-only settings feature. Implemented behavior and compatibility truth belong in [`ARCHITECTURE.md`](ARCHITECTURE.md).

This feature must not change scene ownership, tool eligibility, source order, native fallback, messages, session entries, model behavior, or the complete details available through Pi's native expansion.

## User-facing goals

The first settings version should support:

1. independent middle-trimming switches for file/path values and shell commands;
2. configurable storyboard symbols, including per-tool-kind dots and thinking/rail/branch symbols;
3. configurable lifecycle/status colors and one structural color for the vertical rail and `L`-shaped branch markers.

The defaults must produce the current output:

```json
{
  "pi-storyboard": {
    "trimming": {
      "fileNames": true,
      "commands": true
    },
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
}
```

`toolDots` is optional; an absent kind-specific value falls back to `toolDot`. The exact public key may change if Pi adds a first-class extension-settings namespace, but the extension must use one namespaced object rather than adding unrelated top-level keys.

## Pi settings integration

Pi settings are global at `~/.pi/agent/settings.json` and project-local at `.pi/settings.json`, with project values overriding global values. The project-local object must be ignored when `ctx.isProjectTrusted()` is false.

The current installed Pi API exposes `SettingsManager.create()` publicly but does not expose a `SettingsManager` on `ExtensionContext`. The implementation must not reach through private context/session fields or parse settings files manually. The preferred compatibility bridge is a small read-only adapter around the public `SettingsManager` factory, created once during `session_start` with the current cwd and project-trust state. If Pi provides a public read-only extension-settings accessor before implementation, use that instead. In either case:

- only the `pi-storyboard` namespace is copied into an immutable `PresentationSettings` snapshot;
- no settings setter, `flush()`, or settings write is called;
- the snapshot is discarded at `session_shutdown` and recreated for a new, resumed, forked, or reloaded session;
- direct settings edits take effect at the next session/reload boundary; no polling, timer, watcher, or background task is added;
- the active Pi theme is still read at render time, so changing a theme token updates configured colors without caching ANSI strings;
- an unavailable or incompatible settings API silently uses the current defaults and does not disable storyboard rendering.

## Configuration validation and fallback

`src/presentation-settings.ts` should contain the Pi-independent defaults, types, namespace merge, and validation. It should accept unknown JSON and return a complete immutable snapshot. Invalid fields fall back independently instead of invalidating the whole configuration.

- Trimming values must be booleans.
- Symbols must be single-line, terminal-control-free, bounded display strings. Reject or default values containing ANSI/control sequences, line breaks, or excessive visible width. Do not allow settings to inject raw ANSI styling.
- Color settings must be references to an allowlisted Pi theme color token, not raw ANSI or arbitrary escape sequences. Users who need a particular RGB value should define it in a Pi theme and select that theme token here.
- Unknown group kinds, color names, nulls, malformed nested objects, and invalid strings use the nearest default.
- Settings errors must never become a reason to mutate Pi data or to bypass the existing native fallback rules.

## Trimming semantics

`src/renderer.ts` should classify the main display value before fitting it. `trimming.fileNames` controls path-like values used by Read, List, Write, Edit, Search, and command `cwd` summaries. `trimming.commands` controls only the Bash/PowerShell command value. Timing, error diagnostics, tool names, and result-safety rules remain unchanged.

When enabled, the affected value keeps the current middle-truncation behavior so both a useful prefix and filename/command tail can survive. When disabled, the value still has to satisfy Pi's one-line width contract; it uses ordinary width-bounded end truncation rather than allowing overflow or wrapping. Successful result output, write content, edit text/diffs, image data, and full command output remain excluded regardless of either switch.

## Symbol and color rendering

The settings snapshot should be passed into the renderers as data; it must not enter `storyboard.ts` ownership or `session-projection.ts` matching logic.

- `renderer.ts` uses the resolved per-kind dot and the status color for running, complete, and failed tool rows.
- `storyboard-renderer.ts` uses the configured thinking root/step symbols, hidden-thinking symbol, placeholder label, rail, branch, and last-branch symbols.
- `colors.status` controls scene/action status markers while preserving the existing running > failed > complete > note state model.
- `colors.thinking` keeps thinking lifecycle separate from tool outcome: active thinking uses `active`, settled thinking uses `settled`, and a failed tool must not recolor an otherwise settled thinking marker as an error.
- `colors.structure` applies to `│`, `├─`, and `╰─`, including continuation prefixes. The compact dot remains a status marker, not a structural line.
- Layout prefixes and mouse regions must measure the configured symbols with `visibleWidth()` instead of assuming the widths of `◉`, `○`, `│`, `├─`, or `╰─`. Every configured variant must retain the existing width and mouse-coordinate guarantees.
- The presentation-only `Thinking...` label may change text, but it remains presentation-only and keeps Pi's thinking text style; it never becomes a message, session entry, or inferred reasoning block.

## Planned module changes

- `src/index.ts`: load the read-only settings snapshot at the session lifecycle boundary and provide it to the patch; continue to invalidate only session projection state on transcript events.
- `src/presentation-settings.ts`: own defaults, trusted project/global namespace merging, allowlists, symbol sanitization, and immutable fallback behavior.
- `src/pi-adapter.ts`: thread the snapshot through the existing guarded render path without using settings for ownership decisions; keep all private Pi/TUI inspection and mouse-layout patching here.
- `src/renderer.ts`: add field-aware file/command trimming and configurable per-kind dots while preserving all safety and width checks.
- `src/storyboard-renderer.ts`: replace hard-coded markers/colors with resolved settings and recalculate prefix widths, rails, closure, placeholders, and mouse translations.
- `src/tui-preview.ts`: add a settings gallery showing defaults, custom symbols, per-kind dots, trimming modes, and color mappings.
- `src/storyboard.ts`, `src/grouping.ts`, and `src/session-projection.ts`: do not use presentation settings for semantic grouping, ownership, or active-path validation.

## Verification plan

Add focused tests before implementation is considered complete:

- a new settings test suite for defaults, global/project precedence, untrusted project settings, per-field invalid fallback, control-character rejection, color-token validation, and immutable snapshots;
- renderer cases proving file-name and command trimming are independent, disabled trimming remains width-safe at widths 1–200, and generic/error/detail safety is unchanged;
- storyboard-renderer cases for every configurable marker, per-kind dots, custom marker widths, custom status/thinking/structure colors, long thinking summaries, commentary suffixes, closure, and narrow terminals;
- adapter cases proving settings are threaded without mutating Pi objects, are refreshed across session reload/replacement, keep native expansion/fallback behavior unchanged, and preserve mouse translation;
- preview tests for the configured/default fixture gallery;
- manual verification of global versus project settings, project trust, `/reload`, live theme changes, expanded rows, streaming rows, Unicode symbols, and coexistence with another transcript patcher.

Acceptance for this future feature requires that an absent or malformed setting produces the current presentation, valid settings affect only collapsed storyboard output, every line remains within the terminal width, and all existing ownership/privacy/native-fallback tests continue to pass. The implementation must update `docs/ARCHITECTURE.md`, the marketplace-facing README settings section, preview fixtures, and the compatibility/test matrices together, then run `npm run check` and `npm run package:check`.
